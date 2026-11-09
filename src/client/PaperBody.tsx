/** The sidebar tab body: local PDF library, original-layout reader, annotations, and chat handoff. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { Annotation, JumpRequest, PaperMeta, ParsedCache, SelectionSnapshot, TranslationCache } from './types.ts'
import {
  listAnnotations,
  listPapers,
  putAnnotation,
  readPaperFile,
  readParsed,
  readTranslations,
  removeAnnotation,
  removePaper,
  storePaper,
  touchPaper,
  updatePaperMeta,
  writeParsed,
  writeTranslations,
} from './storage.ts'
import { PARAGRAPH_VERSION, type Paragraph } from './paragraphs.ts'
import { parseAvailable, parseWithMineru } from './mineru.ts'
import { batchParagraphs, splitText, translateTexts, translationStatus } from './translate.ts'
import { askInConversation } from './ask-bridge.tsx'
import { setTabTitle } from './tab-title.ts'
import {
  BackIcon,
  ChatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  FitIcon,
  GlobeIcon,
  HighlightIcon,
  ListIcon,
  MinusIcon,
  Modal,
  NoteIcon,
  PaperIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
  formatBytes,
  localId,
} from './ui.tsx'

const LAST_PAPER_KEY = 'dsh-paper-reader:last'
const MAX_FILE_BYTES = 200 * 1024 * 1024
const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
/** Paragraph translations are cached and displayed in this language. */
const TRANSLATION_LANGUAGE = 'zh'
/** Batch requests kept in flight; the Host translates one batch per request. */
const TRANSLATION_CONCURRENCY = 2

type TranslationPhase = 'idle' | 'waiting' | 'parsing' | 'translating' | 'done' | 'failed' | 'unavailable'
/** Layout-parse schema version; bumping it re-parses stored papers. */
const MINERU_VERSION = 1

type Translate = (key: string, params?: Record<string, unknown>) => string

interface PaperTabInfo {
  readonly tab: {
    readonly id: string
    readonly sessionId?: string
  }
}

export interface PaperBodyProps {
  readonly t: Translate
  readonly locale: string
  readonly useTabInfo: () => PaperTabInfo
  readonly sessionId?: string
}

type ToastState = { readonly kind: 'ok' | 'error'; readonly text: string }
type DialogState =
  | { readonly kind: 'note'; readonly selection: SelectionSnapshot }
  | { readonly kind: 'note-edit'; readonly annotation: Annotation }

function readLastPaper(): string | undefined {
  try { return localStorage.getItem(LAST_PAPER_KEY) ?? undefined } catch { return undefined }
}

function writeLastPaper(id: string | undefined): void {
  try {
    if (id === undefined) localStorage.removeItem(LAST_PAPER_KEY)
    else localStorage.setItem(LAST_PAPER_KEY, id)
  } catch {
    // Local storage is optional; the library itself lives in IndexedDB.
  }
}

function pageOf(annotation: Annotation): number {
  return annotation.rects[0]?.page ?? 1
}

/** Read the visible selection inside the reader, normalized to page surfaces. */
function readSelection(root: HTMLElement): SelectionSnapshot | undefined {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return undefined
  const quote = selection.toString().replace(/\u00a0/gu, ' ').trim()
  if (quote === '') return undefined
  const surfaces = [...root.querySelectorAll<HTMLElement>('[data-paper-surface]')]
  const rects: SelectionSnapshot['rects'][number][] = []
  for (const clientRect of range.getClientRects()) {
    if (clientRect.width < 1 || clientRect.height < 1) continue
    const centerX = clientRect.left + clientRect.width / 2
    const centerY = clientRect.top + clientRect.height / 2
    const surface = surfaces.find((candidate) => {
      const bounds = candidate.getBoundingClientRect()
      return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom
    })
    if (surface === undefined) continue
    const bounds = surface.getBoundingClientRect()
    const left = Math.max(clientRect.left, bounds.left)
    const top = Math.max(clientRect.top, bounds.top)
    const right = Math.min(clientRect.right, bounds.right)
    const bottom = Math.min(clientRect.bottom, bounds.bottom)
    const width = right - left
    const height = bottom - top
    if (width < 1 || height < 1 || bounds.width === 0 || bounds.height === 0) continue
    const page = Number(surface.closest<HTMLElement>('[data-paper-page]')?.dataset.paperPage ?? 1)
    rects.push({
      page,
      x: (left - bounds.left) / bounds.width,
      y: (top - bounds.top) / bounds.height,
      width: width / bounds.width,
      height: height / bounds.height,
    })
  }
  if (rects.length === 0) return undefined
  const union = range.getBoundingClientRect()
  let anchor: SelectionSnapshot['anchor'] = { left: union.left, top: union.top, right: union.right, bottom: union.bottom }
  if (union.width === 0 || union.height === 0) {
    const first = rects[0]!
    const surface = surfaces.find(candidate => Number(candidate.closest<HTMLElement>('[data-paper-page]')?.dataset.paperPage ?? 1) === first.page)
    const bounds = surface?.getBoundingClientRect()
    anchor = bounds === undefined
      ? { left: 0, top: 0, right: 0, bottom: 0 }
      : {
        left: bounds.left + first.x * bounds.width,
        top: bounds.top + first.y * bounds.height,
        right: bounds.left + (first.x + first.width) * bounds.width,
        bottom: bounds.top + (first.y + first.height) * bounds.height,
      }
  }
  return { quote, rects, anchor }
}

/** @param props - framework-bound tab information plus locale-bound copy. */
export function PaperBody(props: PaperBodyProps): ReactNode {
  const { t, locale, useTabInfo, sessionId } = props
  const { tab } = useTabInfo()
  const tabId = String(tab.id)
  const activeSession = String(sessionId ?? tab.sessionId ?? '')
  const root = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number>()
  const flashTimer = useRef<number>()
  const scrollTimer = useRef<number>()
  const openSequence = useRef(0)

  const [papers, setPapers] = useState<PaperMeta[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [paper, setPaper] = useState<PaperMeta>()
  const [bytes, setBytes] = useState<ArrayBuffer>()
  const [paperLoading, setPaperLoading] = useState(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selection, setSelection] = useState<SelectionSnapshot>()
  const [dialog, setDialog] = useState<DialogState>()
  const [notesOpen, setNotesOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [fitWidth, setFitWidth] = useState(true)
  const [zoom, setZoom] = useState(1.25)
  const [jump, setJump] = useState<JumpRequest>()
  const [flashId, setFlashId] = useState<string>()
  const [readerWidth, setReaderWidth] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<ToastState>()
  const [Engine, setEngine] = useState<ComponentType<Record<string, unknown>>>()
  const [engineError, setEngineError] = useState(false)
  const [engineAttempt, setEngineAttempt] = useState(0)
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([])
  const [paragraphSource, setParagraphSource] = useState<'pending' | 'mineru' | 'pdfjs'>('pending')
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translationPhase, setTranslationPhase] = useState<TranslationPhase>('idle')
  const [translationProgress, setTranslationProgress] = useState({ done: 0, total: 0 })
  const [showTranslations, setShowTranslations] = useState(true)
  const [scrolling, setScrolling] = useState(false)
  const [translationAttempt, setTranslationAttempt] = useState(0)
  const translationSequence = useRef(0)
  const translationAbort = useRef<AbortController>()

  function resetTranslation(): void {
    translationSequence.current += 1
    translationAbort.current?.abort()
    translationAbort.current = undefined
    setParagraphs([])
    setTranslations({})
    setTranslationProgress({ done: 0, total: 0 })
    setTranslationPhase('idle')
  }

  const notify = useCallback((kind: 'ok' | 'error', text: string): void => {
    setToast({ kind, text })
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => { setToast(undefined) }, 3600)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current)
    if (scrollTimer.current !== undefined) window.clearTimeout(scrollTimer.current)
  }, [])

  useEffect(() => {
    setTabTitle(tabId, paper?.title ?? t('tab.title'))
  }, [tabId, paper?.title, locale, t])

  useEffect(() => () => { setTabTitle(tabId, undefined) }, [tabId])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const stored = await listPapers()
        if (!active) return
        setPapers(stored)
        // Reopening the last paper parses a PDF and draws canvases; skip it
        // while the pane is hidden so app start stays light.
        const pane = root.current
        const paneVisible = pane !== null && pane.clientWidth > 0 && pane.clientHeight > 0
        const last = paneVisible ? readLastPaper() : undefined
        const target = last === undefined ? undefined : stored.find(candidate => candidate.id === last)
        if (target !== undefined) await openPaper(target)
      } catch {
        if (active) notify('error', t('toast.storageFailed'))
      } finally {
        if (active) setLibraryLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!paper?.pageCount) return
    setPapers(list => list.map(candidate => candidate.id === paper.id ? { ...candidate, pageCount: paper.pageCount } : candidate))
    void updatePaperMeta(paper).catch(() => {})
  }, [paper?.id, paper?.pageCount])

  useEffect(() => {
    if (bytes === undefined || Engine !== undefined) return
    let active = true
    setEngineError(false)
    const load = (require as unknown as { async: (id: string) => Promise<Record<string, unknown>> }).async
    void load('./client.reader.js').then((module) => {
      if (!active) return
      const candidate = module.PdfReader
      if (typeof candidate !== 'function') throw new Error('The reader chunk did not export PdfReader')
      setEngine(() => candidate as ComponentType<Record<string, unknown>>)
    }).catch(() => {
      if (!active) return
      setEngineError(true)
    })
    return () => { active = false }
  }, [bytes, Engine, engineAttempt])

  useEffect(() => {
    const node = scroll.current
    if (node === null || paper === undefined) return
    // Resizing the sidebar fires on every frame; re-rendering every page's
    // canvas that often is what made dragging the splitter stutter.
    let timer: number | undefined
    const apply = (): void => {
      const next = Math.max(120, node.clientWidth - 24)
      setReaderWidth(current => (Math.abs(current - next) < 6 ? current : next))
    }
    const measure = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => { timer = undefined; apply() }, 160)
    }
    apply()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [paper?.id, notesOpen])

  const handleParagraphs = useCallback((next: Paragraph[]): void => {
    setParagraphs(next)
    if (next.length === 0) {
      setTranslationProgress({ done: 0, total: 0 })
      setTranslationPhase('done')
    }
  }, [])

  function persistTranslations(
    paperId: string,
    sources: Record<string, string>,
    values: Record<string, string>,
    complete: boolean,
    provider?: string,
  ): Promise<void> {
    return writeTranslations({
      id: `${paperId}::${TRANSLATION_LANGUAGE}`,
      paperId,
      language: TRANSLATION_LANGUAGE,
      version: PARAGRAPH_VERSION,
      ...(provider === undefined ? {} : { provider }),
      sources: { ...sources },
      translations: { ...values },
      complete,
      updatedAt: Date.now(),
    } satisfies TranslationCache).catch(() => {})
  }

  /** Translate every paragraph once, reusing stored results for this paper. */
  async function runTranslation(
    paperId: string,
    list: readonly Paragraph[],
    sequence: number,
    signal: AbortSignal,
  ): Promise<void> {
    const current = (): boolean => sequence === translationSequence.current && !signal.aborted
    const sources: Record<string, string> = {}
    for (const paragraph of list) sources[paragraph.id] = paragraph.text
    let cache: TranslationCache | undefined
    try {
      cache = await readTranslations(paperId, TRANSLATION_LANGUAGE)
    } catch {
      cache = undefined
    }
    if (!current()) return
    const known: Record<string, string> = {}
    if (cache !== undefined && cache.version === PARAGRAPH_VERSION) {
      for (const paragraph of list) {
        const value = cache.translations[paragraph.id]
        if (cache.sources[paragraph.id] === paragraph.text && typeof value === 'string' && value !== '') {
          known[paragraph.id] = value
        }
      }
    }
    if (Object.keys(known).length > 0) setTranslations({ ...known })
    setTranslationProgress({ done: Object.keys(known).length, total: list.length })
    const missing = list.filter(paragraph => known[paragraph.id] === undefined && paragraph.text.trim() !== '')
    if (missing.length === 0) {
      setTranslationPhase('done')
      if (cache === undefined || !cache.complete) void persistTranslations(paperId, sources, known, true, cache?.provider)
      return
    }
    setTranslationPhase('translating')
    const status = await translationStatus(signal)
    if (!current()) return
    if (status === undefined || !status.available) {
      setTranslationPhase('unavailable')
      return
    }
    const limit = Math.max(500, Math.min(status.maxTextChars, 12_000))
    // A paragraph longer than one request is translated in ordered sentence chunks.
    const chunks = missing.flatMap((paragraph) => {
      const parts = splitText(paragraph.text, limit)
      return parts.map((text, index) => ({ paragraphId: paragraph.id, index, count: parts.length, text }))
    })
    const batches = batchParagraphs(chunks, limit, status.maxBatch, status.maxTotalChars)
    const merged = { ...known }
    const partial = new Map<string, string[]>()
    let provider = cache?.provider
    let failures = 0
    let cursor = 0
    const runBatch = async (): Promise<void> => {
      while (cursor < batches.length) {
        const batch = batches[cursor]!
        cursor += 1
        if (!current()) return
        const reply = await translateTexts(batch.map(entry => entry.text), TRANSLATION_LANGUAGE, signal)
        if (!current()) return
        if (!reply.ok) {
          failures += 1
          if (Object.keys(merged).length === 0 || failures >= 2) return
          continue
        }
        provider = reply.provider ?? provider
        batch.forEach((chunk, index) => {
          const value = reply.translations?.[index]
          if (typeof value !== 'string' || value.trim() === '') return
          const parts = partial.get(chunk.paragraphId) ?? new Array<string>(chunk.count).fill('')
          parts[chunk.index] = value.trim()
          partial.set(chunk.paragraphId, parts)
          if (parts.every(part => part !== '')) merged[chunk.paragraphId] = parts.join(' ')
        })
        setTranslations({ ...merged })
        setTranslationProgress({ done: Object.keys(merged).length, total: list.length })
        void persistTranslations(paperId, sources, merged, false, provider)
      }
    }
    await Promise.all(Array.from({ length: Math.min(TRANSLATION_CONCURRENCY, batches.length) }, runBatch))
    const complete = list.every(paragraph => paragraph.text.trim() === '' || merged[paragraph.id] !== undefined)
    void persistTranslations(paperId, sources, merged, complete, provider)
    setTranslationPhase(complete ? 'done' : 'failed')
  }

  // Paragraph source: a cached or fresh MinerU layout parse, else local PDF.js text.
  useEffect(() => {
    if (paper === undefined || bytes === undefined) return
    const controller = new AbortController()
    let active = true
    setParagraphs([])
    setParagraphSource('pending')
    setTranslationPhase('waiting')
    void (async () => {
      let cached: ParsedCache | undefined
      try {
        cached = await readParsed(paper.id)
      } catch {
        cached = undefined
      }
      if (!active) return
      if (cached !== undefined && cached.version === MINERU_VERSION && cached.paragraphs.length > 0) {
        setParagraphs([...cached.paragraphs])
        setParagraphSource('mineru')
        return
      }
      const available = await parseAvailable(controller.signal)
      if (!active) return
      if (!available) {
        setParagraphSource('pdfjs')
        return
      }
      setTranslationPhase('parsing')
      const reply = await parseWithMineru(
        bytes,
        paper.fileName === '' ? `${paper.title}.pdf` : paper.fileName,
        controller.signal,
      )
      if (!active) return
      if (reply.ok && reply.document !== undefined && reply.document.paragraphs.length > 0) {
        const parsed = reply.document
        setParagraphs([...parsed.paragraphs])
        setParagraphSource('mineru')
        void writeParsed({
          id: paper.id,
          version: MINERU_VERSION,
          pages: parsed.pages,
          paragraphs: parsed.paragraphs,
          updatedAt: Date.now(),
        }).catch(() => {})
        return
      }
      setParagraphSource('pdfjs')
      setTranslationPhase('waiting')
      if (reply.error !== 'cancelled') notify('error', t('toast.mineruFailed'))
    })()
    return () => {
      active = false
      controller.abort()
    }
  }, [paper?.id, bytes])

  useEffect(() => {
    if (paper === undefined || paragraphs.length === 0) return
    const controller = new AbortController()
    translationAbort.current?.abort()
    translationAbort.current = controller
    const sequence = translationSequence.current
    void runTranslation(paper.id, paragraphs, sequence, controller.signal)
    return () => { controller.abort() }
  }, [paper?.id, paragraphs, translationAttempt])

  useEffect(() => {
    if (paper === undefined || bytes === undefined) return
    const node = root.current
    if (node === null) return
    let timer: number | undefined
    const read = (): void => { setSelection(readSelection(node)) }
    const schedule = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(read, 110)
    }
    const onScroll = (): void => {
      setSelection(undefined)
      // Page rendering competes with the scroll frames; hold it until the
      // pointer/trackpad stops moving.
      setScrolling(true)
      if (scrollTimer.current !== undefined) window.clearTimeout(scrollTimer.current)
      scrollTimer.current = window.setTimeout(() => {
        scrollTimer.current = undefined
        setScrolling(false)
      }, 120)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setSelection(undefined) }
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('keydown', onKey)
    node.addEventListener('mouseup', schedule)
    node.addEventListener('keyup', schedule)
    node.addEventListener('scroll', onScroll, { passive: true })
    scroll.current?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('keydown', onKey)
      node.removeEventListener('mouseup', schedule)
      node.removeEventListener('keyup', schedule)
      node.removeEventListener('scroll', onScroll)
      scroll.current?.removeEventListener('scroll', onScroll)
    }
  }, [paper?.id, bytes])

  async function openPaper(meta: PaperMeta): Promise<void> {
    const sequence = ++openSequence.current
    setPaper(meta)
    setPaperLoading(true)
    setBytes(undefined)
    setAnnotations([])
    setSelection(undefined)
    setLibraryOpen(false)
    setCurrentPage(1)
    setNotesOpen(false)
    setEngineError(false)
    resetTranslation()
    try {
      const [blob, stored] = await Promise.all([readPaperFile(meta.id), listAnnotations(meta.id)])
      if (blob === undefined) throw new Error('The stored PDF is missing')
      const buffer = await blob.arrayBuffer()
      if (sequence !== openSequence.current) return
      setBytes(buffer)
      setTranslationPhase('waiting')
      setAnnotations(stored)
      setPaperLoading(false)
      writeLastPaper(meta.id)
      const touched = await touchPaper(meta)
      if (sequence !== openSequence.current) return
      setPaper(touched)
      setPapers(list => [touched, ...list.filter(candidate => candidate.id !== touched.id)])
    } catch {
      if (sequence !== openSequence.current) return
      setPaperLoading(false)
      setPaper(undefined)
      setLibraryOpen(true)
      notify('error', t('toast.readFailed'))
    }
  }

  function closePaper(): void {
    openSequence.current += 1
    setPaper(undefined)
    setBytes(undefined)
    setAnnotations([])
    setPaperLoading(false)
    setLibraryOpen(true)
    setNotesOpen(false)
    setSelection(undefined)
    setCurrentPage(1)
    resetTranslation()
    writeLastPaper(undefined)
  }

  async function handleUpload(file: File | undefined): Promise<void> {
    if (file === undefined) return
    if (file.size > MAX_FILE_BYTES) { notify('error', t('toast.tooLarge')); return }
    const head = await file.slice(0, 1024).text().catch(() => '')
    if (!head.includes('%PDF-')) { notify('error', t('toast.invalidPdf')); return }
    setUploading(true)
    try {
      const title = file.name.replace(/\.pdf$/iu, '').trim() || 'PDF'
      const meta = await storePaper(file, title)
      setPapers(list => [meta, ...list])
      await openPaper(meta)
      notify('ok', t('toast.uploaded'))
    } catch {
      notify('error', t('toast.storageFailed'))
    } finally {
      setUploading(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }

  async function handleDelete(meta: PaperMeta): Promise<void> {
    if (!window.confirm(t('library.deleteConfirm'))) return
    try {
      await removePaper(meta.id)
      setPapers(list => list.filter(candidate => candidate.id !== meta.id))
      if (paper?.id === meta.id) closePaper()
      notify('ok', t('toast.deleted'))
    } catch {
      notify('error', t('toast.storageFailed'))
    }
  }

  const handlePageCount = useCallback((count: number): void => {
    setPaper(previous => previous === undefined || previous.pageCount === count ? previous : { ...previous, pageCount: count })
  }, [])

  const handleVisiblePage = useCallback((page: number): void => { setCurrentPage(page) }, [])

  const handlePdfError = useCallback((message: string): void => {
    notify('error', t('toast.pdfFailed', { message }))
  }, [notify, t])

  function clearBrowserSelection(): void {
    window.getSelection()?.removeAllRanges()
    setSelection(undefined)
  }

  async function createAnnotation(kind: 'highlight' | 'note', selected: SelectionSnapshot, note?: string): Promise<void> {
    if (paper === undefined) return
    const now = Date.now()
    const annotation: Annotation = {
      id: localId(),
      paperId: paper.id,
      kind,
      rects: selected.rects,
      quote: selected.quote,
      ...(note === undefined ? {} : { note }),
      createdAt: now,
    }
    setAnnotations(list => [...list, annotation])
    setDialog(undefined)
    clearBrowserSelection()
    try {
      await putAnnotation(annotation)
      notify('ok', kind === 'note' ? t('toast.noteSaved') : t('toast.highlighted'))
      if (kind === 'note') setNotesOpen(true)
    } catch {
      notify('error', t('toast.storageFailed'))
    }
  }

  async function saveEditedNote(annotation: Annotation, text: string): Promise<void> {
    const next: Annotation = { ...annotation, note: text, updatedAt: Date.now() }
    setAnnotations(list => list.map(candidate => candidate.id === annotation.id ? next : candidate))
    setDialog(undefined)
    try {
      await putAnnotation(next)
      notify('ok', t('toast.noteSaved'))
    } catch {
      notify('error', t('toast.storageFailed'))
    }
  }

  async function deleteAnnotation(annotation: Annotation): Promise<void> {
    setAnnotations(list => list.filter(candidate => candidate.id !== annotation.id))
    if (dialog?.kind === 'note-edit' && dialog.annotation.id === annotation.id) setDialog(undefined)
    try {
      await removeAnnotation(annotation.id)
      notify('ok', t('toast.deleted'))
    } catch {
      notify('error', t('toast.storageFailed'))
    }
  }

  function jumpTo(page: number): void {
    setCurrentPage(page)
    setJump({ page, nonce: Date.now() })
  }

  function jumpToAnnotation(annotation: Annotation): void {
    jumpTo(pageOf(annotation))
    setFlashId(annotation.id)
    if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => { setFlashId(undefined) }, 1600)
    setNotesOpen(false)
  }

  function changeZoom(multiplier: number): void {
    setFitWidth(false)
    setZoom(current => {
      const nearest = ZOOM_STEPS.reduce((best, step) => Math.abs(step - current) < Math.abs(best - current) ? step : best, ZOOM_STEPS[0]!)
      if (multiplier > 1) return ZOOM_STEPS.find(step => step > nearest + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!
      return [...ZOOM_STEPS].reverse().find(step => step < nearest - 0.001) ?? ZOOM_STEPS[0]!
    })
  }

  /** Insert the default question and one quoted passage into the open chat. */
  function insertAsk(quote: string): void {
    if (activeSession === '') {
      notify('error', t('toast.noSession'))
      return
    }
    if (!askInConversation(activeSession, t('ask.defaultPrompt'), quote)) {
      notify('error', t('ask.notReady'))
      return
    }
    clearBrowserSelection()
    notify('ok', t('ask.inserted'))
  }

  /** Ask about a whole paragraph straight from its hover card. */
  const askAboutParagraph = useCallback((paragraph: Paragraph): void => {
    insertAsk(paragraph.text)
  }, [activeSession, t, notify])


  const pageCount = paper?.pageCount
  const pageLabel = pageCount === undefined
    ? t('reader.pageOf', { page: currentPage, count: '—' })
    : t('reader.pageOf', { page: Math.min(currentPage, pageCount), count: pageCount })
  const translationLabel = (() => {
    switch (translationPhase) {
      case 'parsing': return t('translate.parsing')
      case 'waiting': return t('translate.preparing')
      case 'translating': return t('translate.progress', { done: translationProgress.done, total: translationProgress.total })
      case 'done': return showTranslations ? t('translate.ready') : t('translate.hidden')
      case 'failed': return t('translate.failed')
      case 'unavailable': return t('translate.unavailable')
      default: return ''
    }
  })()
  const translateHint = translationPhase === 'failed' || translationPhase === 'unavailable'
    ? t('translate.retry')
    : translationPhase === 'parsing'
      ? t('translate.parsing')
      : translationPhase === 'translating' || translationPhase === 'waiting'
        ? t('translate.progress', { done: translationProgress.done, total: translationProgress.total })
        : showTranslations ? t('translate.hide') : t('translate.show')
  const hoverPendingLabel = translationPhase === 'failed' || translationPhase === 'unavailable'
    ? t('translate.none')
    : t('translate.pending')
  const translationBusy = translationPhase === 'translating' || translationPhase === 'waiting' || translationPhase === 'parsing'

  return <div
    ref={root}
    className="pr-root"
    onDragEnter={(event) => {
      if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); setDragActive(true) }
    }}
    onDragOver={(event) => {
      if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); setDragActive(true) }
    }}
    onDragLeave={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node)) return
      setDragActive(false)
    }}
    onDrop={(event) => {
      event.preventDefault()
      setDragActive(false)
      void handleUpload(event.dataTransfer.files[0])
    }}
  >
    <header className="pr-toolbar">
      {paper === undefined
        ? <span className="pr-brand-icon"><PaperIcon size={18} /></span>
        : <button type="button" className="pr-icon-button" title={t('reader.back')} aria-label={t('reader.back')} onClick={closePaper}>
          <BackIcon />
        </button>}
      <div className="pr-heading">
        <div className="pr-heading-title">{paper?.title ?? t('library.title')}</div>
        <div className="pr-heading-sub">
          {paper === undefined
            ? t('library.local')
            : <>{pageLabel}{translationLabel === '' ? '' : ` · ${translationLabel}`}</>}
        </div>
      </div>
      {paper !== undefined && <button
        type="button"
        className={`pr-icon-button ${translationPhase === 'failed' ? 'pr-icon-button-warn' : ''} ${showTranslations && translationPhase === 'done' ? 'pr-icon-button-active' : ''}`}
        title={translateHint}
        aria-label={translateHint}
        disabled={translationBusy}
        onClick={() => {
          if (translationPhase === 'failed' || translationPhase === 'unavailable') {
            setTranslationAttempt(value => value + 1)
            return
          }
          setShowTranslations(value => !value)
        }}
      >
        {translationBusy ? <span className="pr-spinner pr-spinner-small" /> : <GlobeIcon />}
      </button>}
      {paper !== undefined && <button
        type="button"
        className={`pr-icon-button ${notesOpen ? 'pr-icon-button-active' : ''}`}
        title={t('reader.notes')}
        aria-label={t('reader.notes')}
        onClick={() => { setNotesOpen(value => !value) }}
      >
        <ListIcon />
        {annotations.length > 0 && <span className="pr-badge">{annotations.length}</span>}
      </button>}
      <button
        type="button"
        className="pr-icon-button"
        title={paper === undefined ? t('library.upload') : t('reader.upload')}
        aria-label={paper === undefined ? t('library.upload') : t('reader.upload')}
        onClick={() => { fileInput.current?.click() }}
      >
        {uploading ? <span className="pr-spinner pr-spinner-small" /> : <UploadIcon />}
      </button>
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { void handleUpload(event.target.files?.[0]) }} />
    </header>

    {libraryOpen
      ? <Library
        t={t}
        locale={locale}
        papers={papers}
        loading={libraryLoading}
        uploading={uploading}
        onPick={() => { fileInput.current?.click() }}
        onOpen={(meta) => { void openPaper(meta) }}
        onDelete={(meta) => { void handleDelete(meta) }}
      />
      : <div className="pr-reader">
        <div className="pr-scroll" ref={scroll}>
          {paperLoading
            ? <div className="pr-pdf-status" role="status"><span className="pr-spinner" aria-hidden="true" /><p>{t('reader.loading')}</p></div>
            : engineError
              ? <div className="pr-pdf-status" role="alert">
                <p>{t('reader.engineFailed')}</p>
                <button type="button" className="pr-button" onClick={() => { setEngineError(false); setEngineAttempt(value => value + 1) }}>{t('reader.retry')}</button>
              </div>
              : Engine === undefined || bytes === undefined
                ? <div className="pr-pdf-status" role="status"><span className="pr-spinner" aria-hidden="true" /><p>{t('reader.loadingEngine')}</p></div>
                : <Engine
                  bytes={bytes}
                  annotations={annotations}
                  paragraphs={paragraphs}
                  translations={translations}
                  showTranslations={showTranslations}
                  pendingLabel={hoverPendingLabel}
                  extractLocally={paragraphSource === 'pdfjs'}
                  scrolling={scrolling}
                  width={readerWidth}
                  fitWidth={fitWidth}
                  zoom={zoom}
                  jump={jump}
                  flashId={flashId}
                  t={t}
                  onPageCount={handlePageCount}
                  onVisiblePage={handleVisiblePage}
                  onParagraphs={handleParagraphs}
                  onAskParagraph={askAboutParagraph}
                  onError={handlePdfError}
                />}
        </div>
        {paper !== undefined && <div className="pr-pagebar">
          <button type="button" className="pr-icon-button" title={t('reader.prevPage')} aria-label={t('reader.prevPage')} disabled={currentPage <= 1} onClick={() => { jumpTo(Math.max(1, currentPage - 1)) }}>
            <ChevronLeftIcon />
          </button>
          <span className="pr-page-label">{pageLabel}</span>
          <button type="button" className="pr-icon-button" title={t('reader.nextPage')} aria-label={t('reader.nextPage')} disabled={pageCount !== undefined && currentPage >= pageCount} onClick={() => { jumpTo(pageCount === undefined ? currentPage + 1 : Math.min(pageCount, currentPage + 1)) }}>
            <ChevronRightIcon />
          </button>
          <span className="pr-divider" />
          <button type="button" className={`pr-icon-button ${fitWidth ? 'pr-icon-button-active' : ''}`} title={t('reader.fitWidth')} aria-label={t('reader.fitWidth')} onClick={() => { setFitWidth(value => !value) }}>
            <FitIcon />
          </button>
          <button type="button" className="pr-icon-button" title={t('reader.zoomOut')} aria-label={t('reader.zoomOut')} onClick={() => { changeZoom(-1) }}>
            <MinusIcon />
          </button>
          <span className="pr-zoom-label">{fitWidth ? t('reader.fit') : `${Math.round(zoom * 100)}%`}</span>
          <button type="button" className="pr-icon-button" title={t('reader.zoomIn')} aria-label={t('reader.zoomIn')} onClick={() => { changeZoom(1) }}>
            <PlusIcon />
          </button>
        </div>}
        {notesOpen && paper !== undefined && <NotesPanel
          t={t}
          annotations={annotations}
          onClose={() => { setNotesOpen(false) }}
          onJump={jumpToAnnotation}
          onEdit={(annotation) => { setDialog({ kind: 'note-edit', annotation }) }}
          onDelete={(annotation) => { void deleteAnnotation(annotation) }}
        />}
      </div>}

    {selection !== undefined && dialog === undefined && <SelectionMenu
      t={t}
      selection={selection}
      onHighlight={() => { void createAnnotation('highlight', selection) }}
      onNote={() => { setDialog({ kind: 'note', selection }); setSelection(undefined) }}
      onAsk={() => { insertAsk(selection.quote); setSelection(undefined) }}
      onDismiss={() => { setSelection(undefined) }}
    />}

    {dialog?.kind === 'note' && <NoteDialog
      t={t}
      mode="create"
      quote={dialog.selection.quote}
      initial=""
      onClose={() => { setDialog(undefined) }}
      onSave={(text) => { void createAnnotation('note', dialog.selection, text) }}
    />}
    {dialog?.kind === 'note-edit' && <NoteDialog
      t={t}
      mode="edit"
      quote={dialog.annotation.quote}
      initial={dialog.annotation.note ?? ''}
      onClose={() => { setDialog(undefined) }}
      onSave={(text) => { void saveEditedNote(dialog.annotation, text) }}
    />}

    {dragActive && <div className="pr-drop-overlay" aria-hidden="true">
      <div className="pr-drop-card"><UploadIcon size={26} /><span>{t('library.drop')}</span></div>
    </div>}
    {toast !== undefined && <div className={`pr-toast pr-toast-${toast.kind}`} role="status">{toast.text}</div>}
  </div>
}

function Library(props: {
  readonly t: Translate
  readonly locale: string
  readonly papers: readonly PaperMeta[]
  readonly loading: boolean
  readonly uploading: boolean
  readonly onPick: () => void
  readonly onOpen: (paper: PaperMeta) => void
  readonly onDelete: (paper: PaperMeta) => void
}): ReactNode {
  const { t, locale, papers, loading, uploading, onPick, onOpen, onDelete } = props
  return <div className="pr-library">
    <section className="pr-hero">
      <div className="pr-hero-icon"><PaperIcon size={28} /></div>
      <h2>{papers.length === 0 ? t('library.empty') : t('library.title')}</h2>
      <p>{papers.length === 0 ? t('library.emptyHint') : t('library.subtitle')}</p>
      <button type="button" className="pr-button pr-button-primary" disabled={uploading} onClick={onPick}>
        {uploading ? <span className="pr-spinner pr-spinner-small" /> : <UploadIcon size={15} />}
        <span>{t('library.upload')}</span>
      </button>
      <span className="pr-hint">{t('library.uploadHint')}</span>
    </section>
    {loading
      ? <div className="pr-pdf-status" role="status"><span className="pr-spinner" aria-hidden="true" /><p>{t('reader.loading')}</p></div>
      : papers.length > 0 && <section className="pr-list-section">
        <div className="pr-section-head">{t('library.recent')}</div>
        <div className="pr-paper-list">
          {papers.map(entry => <div key={entry.id} className="pr-paper-row" role="button" tabIndex={0}
            onClick={() => { onOpen(entry) }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) } }}
          >
            <span className="pr-paper-art"><PaperIcon size={20} /></span>
            <span className="pr-paper-copy">
              <span className="pr-paper-title">{entry.title}</span>
              <span className="pr-paper-meta">
                {formatBytes(entry.size, locale)}
                {entry.pageCount === undefined ? '' : ` · ${entry.pageCount === 1 ? t('library.pagesOne') : t('library.pages', { count: entry.pageCount })}`}
              </span>
            </span>
            <button type="button" className="pr-icon-button pr-delete" title={t('library.delete')} aria-label={t('library.delete')} onClick={(event) => {
              event.stopPropagation()
              onDelete(entry)
            }}><TrashIcon /></button>
          </div>)}
        </div>
      </section>}
  </div>
}

function SelectionMenu(props: {
  readonly t: Translate
  readonly selection: SelectionSnapshot
  readonly onHighlight: () => void
  readonly onNote: () => void
  readonly onAsk: () => void
  readonly onDismiss: () => void
}): ReactNode {
  const { t, selection, onHighlight, onNote, onAsk, onDismiss } = props
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean }>()
  useLayoutEffect(() => {
    const node = menu.current
    if (node === null) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    const margin = 8
    const center = (selection.anchor.left + selection.anchor.right) / 2
    const left = Math.min(Math.max(center, width / 2 + margin), window.innerWidth - width / 2 - margin)
    const above = selection.anchor.top > height + margin * 3
    setPosition({ left, top: above ? selection.anchor.top - margin : selection.anchor.bottom + margin, above })
  }, [selection])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onDismiss() }
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && menu.current?.contains(event.target) === true) return
      onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onDismiss])
  return createPortal(<div
    ref={menu}
    className="pr-selection-menu"
    role="toolbar"
    aria-label={t('menu.highlight')}
    style={{
      left: position?.left ?? (selection.anchor.left + selection.anchor.right) / 2,
      top: position?.top ?? selection.anchor.top - 8,
      transform: position?.above === false ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      visibility: position === undefined ? 'hidden' : 'visible',
    }}
    onPointerDown={(event) => { event.stopPropagation() }}
    onMouseDown={(event) => { event.preventDefault() }}
  >
    <button type="button" className="pr-menu-item" onClick={onHighlight}><HighlightIcon size={15} /><span>{t('menu.highlight')}</span></button>
    <button type="button" className="pr-menu-item" onClick={onNote}><NoteIcon size={15} /><span>{t('menu.note')}</span></button>
    <button type="button" className="pr-menu-item" onClick={onAsk}><ChatIcon size={15} /><span>{t('menu.ask')}</span></button>
  </div>, document.body)
}

function NotesPanel(props: {
  readonly t: Translate
  readonly annotations: readonly Annotation[]
  readonly onClose: () => void
  readonly onJump: (annotation: Annotation) => void
  readonly onEdit: (annotation: Annotation) => void
  readonly onDelete: (annotation: Annotation) => void
}): ReactNode {
  const { t, annotations, onClose, onJump, onEdit, onDelete } = props
  const sorted = [...annotations].sort((left, right) => pageOf(left) - pageOf(right) || left.createdAt - right.createdAt)
  return <section className="pr-notes" aria-label={t('notes.title')}>
    <div className="pr-notes-head">
      <span>{t('notes.title')}</span>
      <span className="pr-count">{annotations.length}</span>
      <button type="button" className="pr-icon-button" aria-label={t('notes.cancel')} title={t('notes.cancel')} onClick={onClose}><CloseIcon size={14} /></button>
    </div>
    {sorted.length === 0
      ? <p className="pr-notes-empty">{t('notes.empty')}</p>
      : <div className="pr-notes-list">
        {sorted.map(annotation => <div key={annotation.id} className="pr-note-card" role="button" tabIndex={0}
          onClick={() => { onJump(annotation) }}
          onKeyDown={(event) => { if (event.key === 'Enter') onJump(annotation) }}
        >
          <div className="pr-note-meta">
            <span className={`pr-tag ${annotation.kind === 'note' ? 'pr-tag-note' : ''}`}>{annotation.kind === 'note' ? t('notes.note') : t('notes.highlight')}</span>
            <span>{t('notes.page', { page: pageOf(annotation) })}</span>
            <span className="pr-note-actions">
              {annotation.kind === 'note' && <button type="button" className="pr-icon-button" title={t('notes.editTitle')} aria-label={t('notes.editTitle')} onClick={(event) => { event.stopPropagation(); onEdit(annotation) }}><EditIcon size={13} /></button>}
              <button type="button" className="pr-icon-button" title={t('notes.delete')} aria-label={t('notes.delete')} onClick={(event) => { event.stopPropagation(); onDelete(annotation) }}><TrashIcon size={13} /></button>
            </span>
          </div>
          <blockquote className="pr-note-quote">{annotation.quote}</blockquote>
          {annotation.note !== undefined && annotation.note !== '' && <p className="pr-note-text">{annotation.note}</p>}
        </div>)}
      </div>}
  </section>
}

function NoteDialog(props: {
  readonly t: Translate
  readonly mode: 'create' | 'edit'
  readonly quote: string
  readonly initial: string
  readonly onClose: () => void
  readonly onSave: (text: string) => void
}): ReactNode {
  const { t, mode, quote, initial, onClose, onSave } = props
  const [text, setText] = useState(initial)
  return <Modal
    title={mode === 'create' ? t('notes.addTitle') : t('notes.editTitle')}
    closeLabel={t('notes.cancel')}
    onClose={onClose}
  >
    <blockquote className="pr-quote">{quote}</blockquote>
    <textarea
      className="pr-textarea"
      value={text}
      placeholder={t('notes.placeholder')}
      onChange={(event) => { setText(event.target.value) }}
      rows={5}
    />
    <div className="pr-modal-actions">
      <button type="button" className="pr-button" onClick={onClose}>{t('notes.cancel')}</button>
      <button type="button" className="pr-button pr-button-primary" disabled={text.trim() === ''} onClick={() => { onSave(text.trim()) }}>{t('notes.save')}</button>
    </div>
  </Modal>
}
