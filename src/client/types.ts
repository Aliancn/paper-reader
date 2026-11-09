/** Data shared by the reader shell and the lazily loaded PDF engine. */

export interface PaperMeta {
  readonly id: string
  readonly title: string
  readonly fileName: string
  readonly size: number
  readonly addedAt: number
  lastOpenedAt: number
  pageCount?: number
}

/** One normalized selection rectangle on one PDF page. */
export interface HighlightRect {
  readonly page: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A highlight, optionally carrying a note. */
export interface Annotation {
  readonly id: string
  readonly paperId: string
  readonly kind: 'highlight' | 'note'
  readonly rects: readonly HighlightRect[]
  readonly quote: string
  note?: string
  readonly createdAt: number
  updatedAt?: number
}

/** A selection snapshot taken before the floating menu opens. */
export interface SelectionSnapshot {
  readonly quote: string
  readonly rects: readonly HighlightRect[]
  readonly anchor: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
}

/** The reader asks its host to scroll to one page. */
export interface JumpRequest {
  readonly page: number
  readonly nonce: number
}

/** Persisted MinerU layout parse of one paper. */
export interface ParsedCache {
  readonly id: string
  /** Parser schema version; a mismatch re-parses instead of reusing boxes. */
  readonly version: number
  readonly pages: readonly { readonly page: number; readonly width: number; readonly height: number }[]
  readonly paragraphs: readonly import('./paragraphs.ts').Paragraph[]
  readonly updatedAt: number
}

/** Persisted paragraph translations for one paper and one target language. */
export interface TranslationCache {
  /** `${paperId}::${language}` */
  readonly id: string
  readonly paperId: string
  readonly language: string
  /** Extraction geometry version; a mismatch re-derives every paragraph. */
  readonly version: number
  readonly provider?: string
  /** Source text per paragraph, so a changed PDF never reuses a stale box. */
  readonly sources: Readonly<Record<string, string>>
  readonly translations: Readonly<Record<string, string>>
  readonly complete: boolean
  readonly updatedAt: number
}
