/** Browser client for the plugin's own Host translation route. */

const ROUTE = 'paper-reader/translate'
const MAX_BATCH = 24

export interface TranslationStatus {
  readonly available: boolean
  readonly maxTextChars: number
  readonly maxBatch: number
  readonly maxTotalChars: number
}

export interface TranslationReply {
  readonly ok: boolean
  readonly translations?: readonly (string | null)[]
  readonly provider?: string
  readonly error?: string
}

function endpoint(): string {
  return new URL(ROUTE, document.baseURI).toString()
}

/** Ask the Host whether its translation service is mounted. */
export async function translationStatus(signal: AbortSignal): Promise<TranslationStatus | undefined> {
  try {
    const response = await fetch(endpoint(), { headers: { accept: 'application/json' }, signal, credentials: 'same-origin' })
    if (!response.ok) return undefined
    const value = await response.json() as Partial<TranslationStatus>
    return {
      available: value.available === true,
      maxTextChars: typeof value.maxTextChars === 'number' ? value.maxTextChars : 4000,
      maxBatch: typeof value.maxBatch === 'number' ? value.maxBatch : MAX_BATCH,
      maxTotalChars: typeof value.maxTotalChars === 'number' ? value.maxTotalChars : 48_000,
    }
  } catch {
    return undefined
  }
}

/** Translate one batch of paragraphs; failures are reported instead of thrown. */
export async function translateTexts(
  texts: readonly string[],
  targetLanguage: string,
  signal: AbortSignal,
): Promise<TranslationReply> {
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ texts, targetLanguage }),
      signal,
      credentials: 'same-origin',
    })
    const value = await response.json().catch(() => undefined) as TranslationReply | undefined
    if (!response.ok || value?.ok !== true) {
      return { ok: false, error: value?.error ?? `http-${response.status}` }
    }
    return value
  } catch (error) {
    if (signal.aborted) return { ok: false, error: 'cancelled' }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Split one long paragraph at sentence boundaries so it fits one request. */
export function splitText(text: string, limit: number): string[] {
  const clean = text.trim()
  if (clean === '' || clean.length <= limit) return clean === '' ? [] : [clean]
  const parts: string[] = []
  let rest = clean
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = -1
    for (const separator of ['. ', '; ', ', ', ' ']) {
      const index = window.lastIndexOf(separator)
      if (index > limit * 0.4) {
        cut = index + separator.length
        break
      }
    }
    if (cut <= 0) cut = limit
    const head = rest.slice(0, cut).trim()
    if (head !== '') parts.push(head)
    rest = rest.slice(cut).trim()
  }
  if (rest !== '') parts.push(rest)
  return parts
}

/** Split paragraphs into batches that respect the Host text limits. */
export function batchParagraphs<T extends { readonly text: string }>(
  entries: readonly T[],
  maxChars: number,
  maxBatch: number,
  maxTotalChars = 48_000,
): T[][] {
  const limit = Math.max(500, Math.min(maxChars, 12_000))
  const count = Math.max(1, Math.min(maxBatch, MAX_BATCH))
  const batches: T[][] = []
  let current: T[] = []
  let chars = 0
  const totalCap = Math.max(limit, Math.min(limit * count, maxTotalChars))
  for (const entry of entries) {
    const size = Math.min(entry.text.length, limit)
    if (current.length > 0 && (current.length >= count || chars + size > totalCap)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(entry)
    chars += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}
