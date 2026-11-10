/**
 * Inline-math protection for model translation, learned from Agentero's
 * motif pipeline (`maskInlineTokens` / `restoreInlineTokens`): a formula the
 * model never sees cannot be rewritten, so every protected span is swapped
 * for an opaque placeholder before the request and restored afterwards, with
 * strict validation of the restoration.
 */

/**
 * Placeholder brackets: mathematical white square brackets, absent from
 * paper prose and left alone by models more reliably than ASCII brackets,
 * which collide with citation markers `[13]` and the `[[n]]` batch numbering.
 */
const PLACEHOLDER = '⟦⟧'

/**
 * Display math and inline math are scanned as one family: display spans are
 * matched first on the whole text, then inline `$...$` is matched only
 * inside the regions a display span leaves open. Scanning inline directly
 * on the whole text lets one match reach across a display formula's dollars
 * and swallow the opening dollar of the formula after it.
 */
function mathSpans(text) {
  const spans = []
  let cursor = 0
  const display = [...text.matchAll(/\$\$[^$]{1,400}\$\$/g)]
  for (const match of display) {
    const region = text.slice(cursor, match.index)
    pushInline(spans, region, cursor)
    spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
    cursor = match.index + match[0].length
  }
  pushInline(spans, text.slice(cursor), cursor)
  return spans
}

/** Inline `$...$` matches within one display-free region. */
function pushInline(spans, region, offset) {
  for (const match of region.matchAll(/\$[^$\n]{1,200}\$/g)) {
    spans.push({ start: offset + match.index, end: offset + match.index + match[0].length, text: match[0] })
  }
}

/** Span patterns outside math that must survive translation byte-exact. */
const MASK_PATTERNS = [
  // LaTeX commands with a braced argument, such as \alpha or \textbf{x}.
  /\\[A-Za-z]+(?:\{[^{}]{0,120}\})?/g,
  // URLs and DOIs, which models tend to translate into prose.
  /https?:\/\/[^\s、，。]+/g,
  /\bdoi:\s*10\.\d{4,9}\/\S+/gi,
  /\b10\.\d{4,9}\/[^\s、，。]+/g,
]

/**
 * Replace every protected span in `text` with a numbered placeholder.
 * Overlapping matches never nest: each span is cut at the previous span's
 * end, and a placeholder string that already occurs in the text is skipped,
 * so restoration is unambiguous.
 */
export function maskInlineTokens(text) {
  const spans = mathSpans(text)
  for (const pattern of [...MASK_PATTERNS, /⟦\s*\d+\s*⟧/g, /\[\[\d+\]\]/g]) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const tokens = []
  let cursor = 0
  let masked = ''
  let index = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    let placeholder = `${PLACEHOLDER[0]}${index}${PLACEHOLDER[1]}`
    while (text.includes(placeholder)) {
      index += 1
      placeholder = `${PLACEHOLDER[0]}${index}${PLACEHOLDER[1]}`
    }
    tokens.push({ placeholder, original: span.text })
    masked += text.slice(cursor, span.start) + placeholder
    cursor = span.end
    index += 1
  }
  return { text: masked + text.slice(cursor), tokens }
}

/**
 * Put the originals back. A placeholder that appears more than once, or a
 * placeholder the model dropped, marks the answer invalid; the caller then
 * repairs it instead of shipping a text with a broken formula.
 */
export function restoreInlineTokens(text, tokens) {
  const originals = new Map(tokens.map(token => [token.placeholder.slice(1, -1), token.original]))
  const counts = new Map()
  let invalid = false
  // One pass, so a literal placeholder inside an original span is never
  // restored twice.
  const out = text.replace(/⟦\s*(\d+)\s*⟧/g, (full, id) => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
    const original = originals.get(id)
    if (original === undefined || counts.get(id) > 1) invalid = true
    return original ?? full
  })
  const missing = [...originals.keys()].filter(id => !counts.has(id)).length
  return { text: out, missing, ...(invalid ? { invalid: true } : {}) }
}
