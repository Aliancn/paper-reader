import { inflateRawSync } from 'node:zlib'

/**
 * Host half of the paper reader: one bounded translation route plus the
 * optional MinerU layout parse that produces the paragraph blocks.
 *
 * The configured chat model translates paragraph batches first; the free
 * anonymous `translator` routes only fill segments the model failed to return.
 * Either way the browser never needs provider credentials.
 */

/** Same-origin route the browser half posts to; keep in sync with `translate.ts`. */
const ROUTE = '/paper-reader/translate'
/** MinerU layout parse route; keep in sync with `mineru.ts`. */
const PARSE_ROUTE = '/paper-reader/parse'
const MINERU_ENDPOINT = 'https://mineru.net/api/v4'
const MINERU_MAX_BYTES = 200 * 1024 * 1024
const MINERU_POLL_MS = 3000
const MINERU_TIMEOUT_MS = 300_000
const MINERU_MAX_ZIP_BYTES = 200 * 1024 * 1024
const MAX_BODY_BYTES = 512 * 1024
const MAX_BATCH = 24
/** Smaller batches keep one model answer parseable and inside its output budget. */
const MODEL_BATCH = 10
const MODEL_BATCH_TOTAL_CHARS = 8000
const MAX_TEXT_CHARS = 12_000
const MAX_TOTAL_CHARS = 60_000
const CONCURRENCY = 3
const REQUEST_TIMEOUT_MS = 180_000
const MODEL_TIMEOUT_MS = 120_000
const MODEL_MAX_TOKENS = 4096
/** Free anonymous providers used only as a fallback for missing segments. */
const PROVIDERS = ['bing', 'google']
export const DEFAULT_LANGUAGE = 'zh'
export const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/
export const LANGUAGE_NAMES = {
  zh: 'Simplified Chinese',
  'zh-cn': 'Simplified Chinese',
  'zh-hans': 'Simplified Chinese',
  'zh-sg': 'Simplified Chinese',
  'zh-tw': 'Traditional Chinese',
  'zh-hk': 'Traditional Chinese',
  'zh-hant': 'Traditional Chinese',
  ja: 'Japanese',
  en: 'English',
}
const MODEL_SYSTEM = [
  'You are a careful academic translator. You translate research-paper text exactly as written.',
  'Never answer, summarize, or comment on the source; translate it.',
  'Keep numbers, citations such as [13], section numbers, and proper nouns faithful.',
  'Keep every formula as LaTeX: inline math in $...$, display math in $$...$$ on its own line. Never verbalize or rewrite a formula.',
  'Never merge, split, reorder, or drop a numbered segment.',
].join(' ')

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

function readBodyBytes(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

function parseRequest(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const texts = value.texts
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_BATCH) return undefined
  let total = 0
  const clean = []
  for (const entry of texts) {
    if (typeof entry !== 'string') return undefined
    if (entry.length > MAX_TEXT_CHARS) return undefined
    total += entry.length
    clean.push(entry)
  }
  if (total > MAX_TOTAL_CHARS) return undefined
  const targetLanguage = typeof value.targetLanguage === 'string' && LANGUAGE.test(value.targetLanguage)
    ? value.targetLanguage
    : DEFAULT_LANGUAGE
  const provider = typeof value.provider === 'string' && PROVIDERS.includes(value.provider)
    ? value.provider
    : PROVIDERS[0]
  return { texts: clean, targetLanguage, provider }
}

export function languageName(tag) {
  return LANGUAGE_NAMES[String(tag).toLowerCase()] ?? tag
}

/** Translate one text, resolving a spec for the given provider. */
async function translateOne(translator, text, targetLanguage, provider, signal) {
  const spec = translator.resolve({ text, targetLanguage, provider })
  return translator.translate(spec, signal)
}

/** Run `worker` over `items` with bounded concurrency, keeping per-item failures. */
async function settle(items, signal, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      if (signal.aborted) return
      const index = next
      next += 1
      try {
        results[index] = { ok: true, value: await worker(items[index], index) }
      } catch (error) {
        if (signal.aborted) return
        results[index] = { ok: false, error }
      }
    }
  })
  await Promise.all(runners)
  return results
}

/** Resolve the translation model: a pinned pair wins over the chat default. */
export function translationRoute(ctx, config) {
  if (config?.mode === 'service') return undefined
  if (typeof config?.translation?.provider === 'string' && config.translation.provider !== ''
    && typeof config?.translation?.model === 'string' && config.translation.model !== '') {
    return { provider: config.translation.provider, model: config.translation.model }
  }
  return modelRoute(ctx)
}

/** The chat model route, or undefined when no provider/model pair is configured. */
function modelRoute(ctx) {
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (selection === undefined || selection === null) return undefined
  if (typeof selection.provider !== 'string' || selection.provider === '') return undefined
  if (typeof selection.model !== 'string' || selection.model === '') return undefined
  return { provider: selection.provider, model: selection.model }
}

/** Read one streamed model answer as plain text. */
async function streamText(llm, options) {
  let text = ''
  let failure
  for await (const chunk of llm.stream(options)) {
    if (chunk?.type === 'text-delta') text += chunk.text
    else if (chunk?.type === 'finish') failure = chunk.reason
  }
  if (failure !== undefined && failure.kind !== 'stop') {
    const detail = failure.failure?.message ?? failure.kind
    throw new Error(`model translation failed: ${detail}`)
  }
  return text
}

/** Split a marked-up answer back into one translation per segment. */
function parseSegments(output, count) {
  const results = new Array(count).fill(null)
  const matches = [...String(output).matchAll(/\[\[(\d+)\]\]/g)]
  for (let index = 0; index < matches.length; index += 1) {
    const marker = matches[index]
    const slot = Number(marker[1]) - 1
    const start = marker.index + marker[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index : output.length
    const value = String(output).slice(start, end).trim()
    if (slot >= 0 && slot < count && value !== '') results[slot] = value
  }
  return results
}

/** Translate a batch with the configured chat model, returning one entry per text. */
async function modelTranslate(ctx, route, texts, targetLanguage, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined) return new Array(texts.length).fill(null)
  const numbered = texts.map((text, index) => `[[${index + 1}]] ${text}`).join('\n\n')
  const instruction = [
    `Translate each numbered segment into ${languageName(targetLanguage)}.`,
    'Write every translation on its own, starting with the same [[n]] marker.',
    'Copy any $...$ or $$...$$ math unchanged; translate only the prose around it.',
    'Output nothing else: no preamble, no notes, no source text.',
  ].join('\n')
  const base = {
    provider: route.provider,
    model: route.model,
    system: MODEL_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: `${instruction}\n\n${numbered}` }] }],
    maxTokens: MODEL_MAX_TOKENS,
    // Temperature 0: random sampling can break LaTeX markers mid-formula
    // (same reasoning as pdf2zh's OpenAI translator).
    temperature: 0,
    ...(signal === undefined ? {} : { signal }),
  }
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort(new Error('model translation timed out')) }, MODEL_TIMEOUT_MS)
  const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
  try {
    let output
    try {
      output = await streamText(llm, { ...base, signal: combined, reasoningEffort: 'off' })
    } catch (error) {
      if (combined.aborted) throw error
      // Providers without an `off` effort reject before dispatch; retry plainly.
      output = await streamText(llm, { ...base, signal: combined })
    }
    return parseSegments(output, texts.length)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The route carrier and its trust fence. Declared as hard dependencies: on a
 * cold boot a row may otherwise apply before `webServer` is active, and a
 * route registered on nothing silently disappears.
 */
export const inject = ['webServer', 'connection', 'credentials']

/** Read the ZIP central directory without inflating anything yet. */
function readZipIndex(buffer) {
  let eocd = -1
  const floor = Math.max(0, buffer.length - 66_000)
  for (let offset = buffer.length - 22; offset >= floor; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw new Error('zip: missing end of central directory')
  const count = buffer.readUInt16LE(eocd + 10)
  const start = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  let offset = start
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('zip: bad central directory entry')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    const localName = buffer.readUInt16LE(localOffset + 26)
    const localExtra = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localName + localExtra
    entries.set(name, { method, dataStart, compressedSize })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Inflate one indexed entry on demand; the result ZIP holds large images we never read. */
function readZipEntry(buffer, entry) {
  const raw = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
  return entry.method === 0 ? raw : inflateRawSync(raw)
}

/** Drop MinerU's inline markup (e.g. `<sup>∗</sup>`) but keep its text. */
function plainText(value) {
  return value.replace(/<\/?[A-Za-z][^>]*>/gu, '').replace(/\s+/gu, ' ').trim()
}

/** Join the text of one MinerU layout block, in line then span order. */
function blockText(block) {
  const lines = Array.isArray(block?.lines) ? block.lines : []
  const pieces = []
  for (const line of lines) {
    const spans = Array.isArray(line?.spans) ? line.spans : []
    const text = spans.map(span => (typeof span?.content === 'string' ? span.content : '')).join('').trim()
    if (text !== '') pieces.push(text)
  }
  return plainText(pieces.join(' '))
}

/** Turn one MinerU `layout.json` into page sizes plus normalized paragraph blocks. */
function paragraphsFromLayout(layout) {
  const pages = []
  const paragraphs = []
  const infos = Array.isArray(layout?.pdf_info) ? layout.pdf_info : []
  infos.forEach((info, index) => {
    const size = Array.isArray(info?.page_size) ? info.page_size : []
    const width = Number(size[0])
    const height = Number(size[1])
    if (!(width > 0) || !(height > 0)) return
    const page = Number.isInteger(info?.page_idx) ? info.page_idx + 1 : index + 1
    pages.push({ page, width, height })
    const blocks = Array.isArray(info?.para_blocks)
      ? info.para_blocks
      : Array.isArray(info?.preproc_blocks) ? info.preproc_blocks : []
    let order = 0
    for (const block of blocks) {
      const type = typeof block?.type === 'string' ? block.type : 'text'
      if (type === 'image') continue
      const raw = blockText(block)
      const text = type === 'equation' || type === 'interline_equation' ? `$$${raw}$$` : raw
      if (text.length < 2 || !/[\p{L}]/u.test(text)) continue
      const bbox = Array.isArray(block?.bbox) ? block.bbox.map(Number) : []
      if (bbox.length !== 4 || bbox.some(value => !Number.isFinite(value))) continue
      const [x0, y0, x1, y1] = bbox
      const left = Math.max(0, Math.min(x0, x1))
      const top = Math.max(0, Math.min(y0, y1))
      const right = Math.min(width, Math.max(x0, x1))
      const bottom = Math.min(height, Math.max(y0, y1))
      if (!(right > left) || !(bottom > top)) continue
      paragraphs.push({
        id: `m${page}-${order}`,
        page,
        text,
        x: left / width,
        y: top / height,
        width: (right - left) / width,
        height: (bottom - top) / height,
      })
      order += 1
    }
  })
  return { pages, paragraphs }
}

/** Read `{ code, msg, data }` from the MinerU API. */
async function mineruJson(response) {
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`mineru: unreadable response (${response.status})`)
  }
  if (!response.ok || (typeof payload?.code === 'number' && payload.code !== 0)) {
    const detail = typeof payload?.msg === 'string' ? payload.msg : `HTTP ${response.status}`
    throw new Error(`mineru: ${detail}`)
  }
  return payload
}

/** Upload one PDF, wait for MinerU, and return its layout blocks. */
async function mineruParse(options, bytes, fileName, signal) {
  const { token, endpoint } = options
  const create = await mineruJson(await fetch(`${endpoint}/file-urls/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ enable_formula: false, language: 'en', files: [{ name: fileName, is_ocr: false }] }),
    signal,
  }))
  const batchId = create?.data?.batch_id
  const uploadUrl = create?.data?.file_urls?.[0]
  if (typeof batchId !== 'string' || typeof uploadUrl !== 'string') throw new Error('mineru: no upload target')
  // The presigned URL signs an empty content type: any Content-Type header breaks it.
  const upload = await fetch(uploadUrl, { method: 'PUT', body: bytes, signal })
  if (!upload.ok) throw new Error(`mineru: upload failed (${upload.status})`)
  const deadline = Date.now() + MINERU_TIMEOUT_MS
  let zipUrl
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason ?? new Error('mineru: aborted')
    await new Promise(resolve => setTimeout(resolve, MINERU_POLL_MS))
    const status = await mineruJson(await fetch(`${endpoint}/extract-results/batch/${batchId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    }))
    const entry = status?.data?.extract_result?.[0]
    if (entry === undefined) continue
    if (entry.state === 'done') { zipUrl = entry.full_zip_url; break }
    if (entry.state === 'failed' || entry.state === 'error') {
      throw new Error(`mineru: ${typeof entry.err_msg === 'string' && entry.err_msg !== '' ? entry.err_msg : 'parse failed'}`)
    }
  }
  if (typeof zipUrl !== 'string') throw new Error('mineru: parse timed out')
  const archive = await fetch(zipUrl, { signal })
  if (!archive.ok) throw new Error(`mineru: download failed (${archive.status})`)
  const length = Number(archive.headers.get('content-length') ?? '0')
  if (length > MINERU_MAX_ZIP_BYTES) throw new Error('mineru: result is too large')
  const zip = Buffer.from(await archive.arrayBuffer())
  const entries = readZipIndex(zip)
  const layoutEntry = [...entries.entries()].find(([name]) => /(^|\/)layout\.json$/u.test(name))
  if (layoutEntry === undefined) throw new Error('mineru: layout.json missing')
  const layout = JSON.parse(readZipEntry(zip, layoutEntry[1]).toString('utf8'))
  const parsed = paragraphsFromLayout(layout)
  if (parsed.paragraphs.length === 0) throw new Error('mineru: no text blocks')
  return parsed
}

export function apply(ctx, config) {
  const webServer = ctx.webServer
  // `mode: 'service'` opts out of model translation and uses the anonymous routes only.
  // A pinned `translation.provider`/`translation.model` pair wins over the default-model route.
  const handler = async (req, res) => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    const translator = ctx.get('translator')
    const model = translationRoute(ctx, config)
    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        available: translator !== undefined || model !== undefined,
        mode: model === undefined ? 'service' : 'model',
        providers: [...(model === undefined ? [] : ['model']), ...PROVIDERS],
        maxTextChars: typeof translator?.maxTextChars === 'number' ? translator.maxTextChars : 4000,
        maxBatch: model === undefined ? MAX_BATCH : MODEL_BATCH,
        // One model answer carries the whole batch, so keep it inside the output budget.
        maxTotalChars: model === undefined ? MAX_TOTAL_CHARS : MODEL_BATCH_TOTAL_CHARS,
      })
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST')
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    if (translator === undefined && model === undefined) {
      sendJson(res, 503, { ok: false, error: 'translation-unavailable' })
      return
    }
    const type = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase()
    if (type !== 'application/json') {
      sendJson(res, 415, { ok: false, error: 'unsupported-media-type' })
      return
    }
    let body
    try {
      body = await readBody(req)
    } catch (error) {
      sendJson(res, error?.status === 413 ? 413 : 400, { ok: false, error: 'bad-request' })
      return
    }
    const request = parseRequest(body)
    if (request === undefined) {
      sendJson(res, 400, { ok: false, error: 'invalid-request' })
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(new Error('translation timed out')) }, REQUEST_TIMEOUT_MS)
    const onClose = () => { if (!res.writableEnded) controller.abort(new Error('client closed')) }
    res.on('close', onClose)
    try {
      const translations = new Array(request.texts.length).fill(null)
      let provider
      if (model !== undefined) {
        try {
          const segments = await modelTranslate(ctx, model, request.texts, request.targetLanguage, controller.signal)
          if (segments !== undefined) {
            segments.forEach((value, index) => {
              if (typeof value === 'string' && value.trim() !== '') translations[index] = value.trim()
            })
            if (translations.some(value => value !== null)) provider = model.model
          }
        } catch {
          // Keep going: the anonymous routes below fill every missing segment.
        }
      }
      const missing = translations.map((value, index) => (value === null ? index : -1)).filter(index => index >= 0)
      if (missing.length > 0 && translator !== undefined && !controller.signal.aborted) {
        const texts = missing.map(index => request.texts[index])
        const order = [request.provider, ...PROVIDERS.filter(candidate => candidate !== request.provider)]
        let chosen = order[0]
        let results = await settle(texts, controller.signal, text => translateOne(translator, text, request.targetLanguage, chosen, controller.signal))
        // One fallback route for a batch that failed as a whole: the anonymous
        // endpoints differ in reachability and rate limiting.
        if (!results.some(entry => entry?.ok === true)) {
          for (const candidate of order.slice(1)) {
            if (controller.signal.aborted) break
            const retry = await settle(texts, controller.signal, text => translateOne(translator, text, request.targetLanguage, candidate, controller.signal))
            results = retry
            chosen = candidate
            if (retry.some(entry => entry?.ok === true)) break
          }
        }
        const anonymous = results
          .map((entry, index) => (entry?.ok === true && typeof entry.value === 'string' && entry.value.trim() !== ''
            ? { index: missing[index], text: entry.value }
            : undefined))
          .filter(Boolean)
        if (anonymous.length > 0) {
          for (const entry of anonymous) translations[entry.index] = entry.text
          provider = provider === undefined ? chosen : `${provider}+${chosen}`
        }
      }
      const failures = translations
        .map((value, index) => (value === null ? { index, code: 'TRANSLATION_FAILED' } : undefined))
        .filter(Boolean)
      if (!translations.some(value => value !== null)) {
        sendJson(res, 502, { ok: false, error: 'translation-failed' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        provider: provider ?? 'model',
        translations,
        failures,
      })
    } catch {
      if (!res.writableEnded) sendJson(res, 500, { ok: false, error: 'translation-failed' })
    } finally {
      clearTimeout(timeout)
      res.off('close', onClose)
    }
  }

  const mineruEndpoint = typeof config?.mineru?.endpoint === 'string' && config.mineru.endpoint !== ''
    ? config.mineru.endpoint
    : MINERU_ENDPOINT

  /**
   * Resolve the MinerU token per request: an explicit config value first,
   * then the credential store (settings page, credentials file, env), then
   * the process environment. Re-read on every call so a token saved in the
   * settings page takes effect without a restart.
   */
  async function mineruToken() {
    if (typeof config?.mineru?.token === 'string' && config.mineru.token !== '') return config.mineru.token
    try {
      const resolved = await ctx.credentials?.resolve?.('MINERU_TOKEN')
      if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value
    } catch {
      // A Host without a credential provider mounted resolves nothing.
    }
    if (typeof process.env.MINERU_TOKEN === 'string' && process.env.MINERU_TOKEN !== '') return process.env.MINERU_TOKEN
    return undefined
  }

  const parseHandler = async (req, res) => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if (req.method === 'GET') {
      const token = await mineruToken()
      sendJson(res, 200, { ok: true, available: token !== undefined })
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST')
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    const token = await mineruToken()
    if (token === undefined) {
      sendJson(res, 503, { ok: false, error: 'mineru-unavailable' })
      return
    }
    const options = { token, endpoint: mineruEndpoint }
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(new Error('parse timed out')) }, MINERU_TIMEOUT_MS + 60_000)
    const onClose = () => { if (!res.writableEnded) controller.abort(new Error('client closed')) }
    res.on('close', onClose)
    try {
      const requestUrl = new URL(String(req.url), 'http://localhost')
      const rawName = requestUrl.searchParams.get('name') ?? 'paper.pdf'
      const name = rawName.replace(/[\\/:*?"<>|]/gu, ' ').trim().slice(0, 200) || 'paper.pdf'
      const bytes = await readBodyBytes(req, MINERU_MAX_BYTES)
      if (bytes.length === 0) {
        sendJson(res, 400, { ok: false, error: 'empty-file' })
        return
      }
      const parsed = await mineruParse(options, bytes, name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, controller.signal)
      sendJson(res, 200, { ok: true, pages: parsed.pages, paragraphs: parsed.paragraphs })
    } catch (error) {
      if (!res.writableEnded) {
        const message = error instanceof Error ? error.message : 'parse-failed'
        sendJson(res, 502, { ok: false, error: message })
      }
    } finally {
      clearTimeout(timeout)
      res.off('close', onClose)
    }
  }

  ctx.effect(() => {
    const dispose = webServer.register({ kind: 'exact', path: PARSE_ROUTE, handler: parseHandler })
    void mineruToken().then((token) => {
      ctx.logger?.info?.('paper-reader: MinerU parse route ready (available: %s)', token !== undefined)
    })
    return dispose
  }, 'paper-reader: MinerU parse route')

  ctx.effect(() => {
    const dispose = webServer.register({ kind: 'exact', path: ROUTE, handler })
    ctx.logger?.info?.('paper-reader: translation route ready on %s', ROUTE)
    return dispose
  }, 'paper-reader: translation route')
}
