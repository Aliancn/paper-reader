/** Render LaTeX fragments as MathML through KaTeX, without shipping KaTeX's CSS or fonts. */
import katex from 'katex'
import type { ReactNode } from 'react'

type SegmentKind = 'text' | 'inline' | 'display'

interface Segment {
  readonly kind: SegmentKind
  readonly value: string
}

const DELIMITERS: readonly { open: string; close: string; kind: SegmentKind }[] = [
  { open: '$$', close: '$$', kind: 'display' },
  { open: '\\[', close: '\\]', kind: 'display' },
  { open: '\\(', close: '\\)', kind: 'inline' },
  { open: '$', close: '$', kind: 'inline' },
]

/** Split one string into plain text and LaTeX fragments. */
export function splitMath(input: string): Segment[] {
  const segments: Segment[] = []
  let text = ''
  let index = 0
  const flush = (): void => {
    if (text !== '') {
      segments.push({ kind: 'text', value: text })
      text = ''
    }
  }
  while (index < input.length) {
    const rest = input.slice(index)
    let match: { raw: string; body: string; kind: SegmentKind } | undefined
    for (const delimiter of DELIMITERS) {
      if (!rest.startsWith(delimiter.open)) continue
      const end = rest.indexOf(delimiter.close, delimiter.open.length)
      if (end <= delimiter.open.length) continue
      match = {
        raw: rest.slice(0, end + delimiter.close.length),
        body: rest.slice(delimiter.open.length, end),
        kind: delimiter.kind,
      }
      break
    }
    if (match === undefined) {
      text += input[index]
      index += 1
      continue
    }
    flush()
    segments.push({ kind: match.kind, value: match.body })
    index += match.raw.length
  }
  flush()
  return segments
}

function renderTex(tex: string, display: boolean): string | undefined {
  try {
    return katex.renderToString(tex, {
      output: 'mathml',
      displayMode: display,
      throwOnError: false,
      strict: false,
      trust: false,
      maxSize: 24,
    })
  } catch {
    return undefined
  }
}

/** Text with every `$…$` / `$$…$$` / `\(…\)` / `\[…\]` fragment rendered as math. */
export function MathText(props: { readonly text: string }): ReactNode {
  const segments = splitMath(props.text)
  if (!segments.some(segment => segment.kind !== 'text')) return <>{props.text}</>
  return <>{segments.map((segment, index) => {
    if (segment.kind === 'text') return <span key={index}>{segment.value}</span>
    const html = renderTex(segment.value, segment.kind === 'display')
    if (html === undefined) {
      return <span key={index} className="pr-math-error">{segment.kind === 'display' ? `$$${segment.value}$$` : `$${segment.value}$`}</span>
    }
    return <span
      key={index}
      className={segment.kind === 'display' ? 'pr-math pr-math-display' : 'pr-math'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  })}</>
}
