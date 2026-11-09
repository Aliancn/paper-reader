/** Group PDF.js text items into paragraph boxes used by the hover translation. */

/** Bump when extraction geometry changes, so stored translations are re-derived. */
export const PARAGRAPH_VERSION = 6

/** One positioned text run from `page.getTextContent()`, in unscaled page units. */
export interface PageTextItem {
  readonly str: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Every text run of one page plus that page's unscaled size. */
export interface PageText {
  readonly page: number
  readonly width: number
  readonly height: number
  readonly items: readonly PageTextItem[]
}

/** One normalized line box inside a paragraph. */
export interface ParagraphLine {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One hoverable paragraph, with normalized boxes inside its page. */
export interface Paragraph {
  readonly id: string
  readonly page: number
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** The paragraph's own lines, so the hover highlight hugs the text. */
  readonly lines: readonly ParagraphLine[]
}

interface TextLine {
  readonly text: string
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly baseline: number
  readonly fontSize: number
  /** Column band the line sits in: 0 is the leftmost, one more per gutter. */
  readonly column: number
}

const WHITESPACE = /\s+/gu
const LETTER = /\p{L}/u

function clean(value: string): string {
  return value.replace(/\u00a0/gu, ' ').replace(WHITESPACE, ' ').trim()
}

/** Join wrapped lines, undoing end-of-line hyphenation. */
function joinLines(previous: string, next: string): string {
  if (/\p{L}-$/u.test(previous) && /^\p{Ll}/u.test(next)) return `${previous.slice(0, -1)}${next}`
  if (/[\u3000-\u9fff\uff00-\uffef]$/u.test(previous)) return `${previous}${next}`
  return `${previous} ${next}`
}

/**
 * Cluster runs into raw baselines before any column decision.
 */
function clusterLines(items: readonly PageTextItem[]): { baseline: number; items: PageTextItem[] }[] {
  const sorted = items
    .filter(item => clean(item.str) !== '' && Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((left, right) => left.y - right.y || left.x - right.x)
  const open: { baseline: number; items: PageTextItem[] }[] = []
  for (const item of sorted) {
    const tolerance = Math.max(1.1, Math.min(item.height, 96) * 0.55)
    let target: { baseline: number; items: PageTextItem[] } | undefined
    for (let index = open.length - 1; index >= 0 && index >= open.length - 16; index -= 1) {
      const line = open[index]!
      if (item.y - line.baseline > tolerance * 2.5) break
      if (Math.abs(line.baseline - item.y) <= tolerance) { target = line; break }
    }
    if (target === undefined) {
      target = { baseline: item.y, items: [] }
      open.push(target)
    }
    target.items.push(item)
  }
  return open
}

/**
 * Vertical bands that stay empty for almost every line: the column gutters.
 * A page with a full-width title still has a gutter, because only one line
 * covers it; a single-column page has none. This is independent of how wide
 * the gutter is, so a narrow two-column layout is split correctly too.
 */
function detectGutters(lines: readonly { items: readonly PageTextItem[] }[], pageWidth: number): number[] {
  if (lines.length < 6 || !(pageWidth > 0)) return []
  const bin = Math.max(0.4, pageWidth / 1500)
  const count = Math.ceil(pageWidth / bin) + 1
  const coveredLines = new Uint16Array(count)
  let minX = pageWidth
  let maxX = 0
  for (const line of lines) {
    for (const item of line.items) {
      const left = Math.max(0, item.x)
      const right = Math.min(pageWidth, item.x + item.width)
      if (!(right > left)) continue
      if (left < minX) minX = left
      if (right > maxX) maxX = right
      const from = Math.floor(left / bin)
      const to = Math.min(count, Math.ceil(right / bin))
      for (let index = from; index < to; index += 1) coveredLines[index] += 1
    }
  }
  const span = maxX - minX
  if (!(span > pageWidth * 0.25)) return []
  const threshold = Math.max(1, Math.floor(lines.length * 0.25))
  const minRun = Math.max(2, Math.ceil((pageWidth * 0.005) / bin))
  const first = Math.floor((minX + span * 0.12) / bin)
  const lastIndex = Math.min(count - 1, Math.ceil((maxX - span * 0.12) / bin))
  const flank = Math.max(1, Math.floor(lines.length * 0.4))
  const gutters: number[] = []
  let runStart = -1
  for (let index = first; index <= lastIndex; index += 1) {
    const empty = coveredLines[index]! <= threshold
    if (empty) {
      if (runStart < 0) runStart = index
      continue
    }
    if (runStart >= 0) {
      if (index - runStart >= minRun) {
        let leftFlank = 0
        for (let probe = Math.max(0, runStart - 24); probe < runStart; probe += 1) {
          if (coveredLines[probe]! > leftFlank) leftFlank = coveredLines[probe]!
        }
        let rightFlank = 0
        for (let probe = index; probe < Math.min(count, index + 24); probe += 1) {
          if (coveredLines[probe]! > rightFlank) rightFlank = coveredLines[probe]!
        }
        if (leftFlank >= flank && rightFlank >= flank) gutters.push(((runStart + index) / 2) * bin)
      }
      runStart = -1
    }
  }
  return gutters
}

function columnOf(left: number, right: number, gutters: readonly number[]): number {
  const center = (left + right) / 2
  let column = 0
  for (const gutter of gutters) {
    if (center > gutter) column += 1
    else break
  }
  return column
}

function groupLines(items: readonly PageTextItem[], pageWidth: number): TextLine[] {
  const raw = clusterLines(items)
  const gutters = detectGutters(raw, pageWidth)
  const lines: TextLine[] = []
  for (const line of raw) {
    const ordered = [...line.items].sort((left, right) => left.x - right.x)
    const fontSize = Math.max(...ordered.map(item => Math.min(item.height, 96)), 1)
    // A wide gap on one baseline is a detached caption, not a word space.
    const localGutter = Math.max(fontSize * 1.5, pageWidth * 0.02)
    const segments: PageTextItem[][] = []
    let segment: PageTextItem[] = []
    let cursor: number | undefined
    for (const item of ordered) {
      if (cursor !== undefined && segment.length > 0) {
        const gap = item.x - cursor
        const crossesColumn = gutters.some(gutter => cursor! <= gutter && gutter <= item.x)
        if (gap > localGutter || (crossesColumn && gap > Math.min(fontSize, item.height) * 0.2)) {
          segments.push(segment)
          segment = []
        }
      }
      segment.push(item)
      cursor = Math.max(cursor ?? 0, item.x + item.width)
    }
    if (segment.length > 0) segments.push(segment)
    for (const run of segments) {
      let text = ''
      let runCursor: number | undefined
      for (const item of run) {
        const piece = clean(item.str)
        if (piece === '') continue
        if (text === '') text = piece
        else if (runCursor !== undefined && item.x - runCursor > Math.min(item.height, fontSize) * 0.12) {
          text = `${text} ${piece}`
        } else {
          text = `${text}${piece}`
        }
        runCursor = item.x + item.width
      }
      if (text === '') continue
      const left = Math.min(...run.map(item => item.x))
      const right = Math.max(...run.map(item => item.x + item.width))
      lines.push({
        text,
        left,
        right,
        top: Math.min(...run.map(item => item.y - fontSize)),
        bottom: Math.max(...run.map(item => item.y + fontSize * 0.3)),
        baseline: line.baseline,
        fontSize,
        column: columnOf(left, right, gutters),
      })
    }
  }
  return lines
}

/** Merge lines into paragraph groups: vertical neighbours with aligned columns. */
function groupParagraphs(lines: readonly TextLine[]): TextLine[][] {
  const ordered = [...lines].sort((left, right) => left.column - right.column || left.top - right.top || left.left - right.left)
  const groups: TextLine[][] = []
  for (const line of ordered) {
    let best: { group: TextLine[]; gap: number } | undefined
    for (const group of groups) {
      const last = group[group.length - 1]!
      const gap = line.top - last.bottom
      if (gap < -Math.max(last.fontSize, line.fontSize) * 1.6) continue
      if (gap > Math.max(last.fontSize, line.fontSize) * 0.8) continue
      const sizes = Math.max(last.fontSize, line.fontSize) / Math.max(Math.min(last.fontSize, line.fontSize), 0.1)
      if (sizes > 1.35) continue
      const overlap = Math.min(last.right, line.right) - Math.max(last.left, line.left)
      const narrow = Math.min(last.right - last.left, line.right - line.left)
      if (narrow <= 0 || overlap / narrow < 0.5) continue
      if (best === undefined || gap < best.gap) best = { group, gap }
    }
    if (best === undefined) groups.push([line])
    else best.group.push(line)
  }
  return groups
}

/**
 * Build every paragraph of a document, in page then reading order.
 * Geometry is normalized to the page so the result survives zoom and width changes.
 */
export function buildParagraphs(pages: readonly PageText[]): Paragraph[] {
  const paragraphs: Paragraph[] = []
  for (const page of [...pages].sort((left, right) => left.page - right.page)) {
    if (!(page.width > 0) || !(page.height > 0)) continue
    const groups = groupParagraphs(groupLines(page.items, page.width))
    const blocks = groups
      .map((lines) => {
        const ordered = [...lines].sort((left, right) => left.top - right.top || left.left - right.left)
        let text = ordered[0]?.text ?? ''
        for (let index = 1; index < ordered.length; index += 1) text = joinLines(text, ordered[index]!.text)
        return {
          text: clean(text),
          left: Math.min(...ordered.map(line => line.left)),
          right: Math.max(...ordered.map(line => line.right)),
          top: Math.min(...ordered.map(line => line.top)),
          bottom: Math.max(...ordered.map(line => line.bottom)),
          column: Math.min(...ordered.map(line => line.column)),
          lines: ordered,
        }
      })
      // Page numbers, figure numbers, and stray glyphs carry no prose.
      .filter(block => block.text.length >= 2 && LETTER.test(block.text))
      .sort((left, right) => left.column - right.column || left.top - right.top || left.left - right.left)
    blocks.forEach((block, index) => {
      const width = Math.max(block.right - block.left, 1)
      const height = Math.max(block.bottom - block.top, 1)
      paragraphs.push({
        id: `p${page.page}-${index}`,
        page: page.page,
        text: block.text,
        x: block.left / page.width,
        y: block.top / page.height,
        width: width / page.width,
        height: height / page.height,
        // A slightly tighter band than the merge box, so the hover highlight
        // shows one band per text line instead of one filled block.
        lines: block.lines.map((line) => {
          const top = line.baseline - line.fontSize * 0.95
          const bottom = line.baseline + line.fontSize * 0.15
          return {
            x: line.left / page.width,
            y: top / page.height,
            width: Math.max(line.right - line.left, 1) / page.width,
            height: Math.max(bottom - top, 1) / page.height,
          }
        }),
      })
    })
  }
  return paragraphs
}

/** The paragraph under one normalized page point, if any. */
export function paragraphAt(
  paragraphs: readonly Paragraph[],
  x: number,
  y: number,
): Paragraph | undefined {
  let match: Paragraph | undefined
  for (const paragraph of paragraphs) {
    if (x < paragraph.x - 0.008 || x > paragraph.x + paragraph.width + 0.008) continue
    if (y < paragraph.y - 0.004 || y > paragraph.y + paragraph.height + 0.004) continue
    if (match === undefined || paragraph.height < match.height) match = paragraph
  }
  return match
}
