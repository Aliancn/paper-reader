/** Browser client for the plugin's MinerU layout route. */
import type { Paragraph } from './paragraphs.ts'

const ROUTE = 'paper-reader/parse'

export interface ParsedPage {
  readonly page: number
  readonly width: number
  readonly height: number
}

export interface ParsedDocument {
  readonly pages: readonly ParsedPage[]
  readonly paragraphs: readonly Paragraph[]
}

export interface ParseReply {
  readonly ok: boolean
  readonly document?: ParsedDocument
  readonly error?: string
}

function endpoint(): string {
  return new URL(ROUTE, document.baseURI).toString()
}

/** Ask the Host whether a MinerU token is configured. */
export async function parseAvailable(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(endpoint(), { headers: { accept: 'application/json' }, signal, credentials: 'same-origin' })
    if (!response.ok) return false
    const value = await response.json() as { available?: unknown }
    return value.available === true
  } catch {
    return false
  }
}

interface RawParagraph {
  readonly id: string
  readonly page: number
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Parse one PDF through MinerU and return its layout paragraph blocks. */
export async function parseWithMineru(
  bytes: ArrayBuffer,
  name: string,
  signal: AbortSignal,
): Promise<ParseReply> {
  try {
    const url = new URL(ROUTE, document.baseURI)
    url.searchParams.set('name', name)
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: bytes,
      signal,
      credentials: 'same-origin',
    })
    const value = await response.json().catch(() => undefined) as
      | { ok?: boolean; pages?: ParsedPage[]; paragraphs?: RawParagraph[]; error?: string }
      | undefined
    if (!response.ok || value?.ok !== true || !Array.isArray(value.paragraphs)) {
      return { ok: false, error: value?.error ?? `http-${response.status}` }
    }
    const paragraphs = value.paragraphs.map(paragraph => ({
      ...paragraph,
      lines: [{ x: paragraph.x, y: paragraph.y, width: paragraph.width, height: paragraph.height }],
    }))
    return { ok: true, document: { pages: value.pages ?? [], paragraphs } }
  } catch (error) {
    if (signal.aborted) return { ok: false, error: 'cancelled' }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
