/** Lazily loaded PDF engine: original-page canvas rendering with selectable text. */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  Util,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist'
import { workerSource } from '../generated/pdf-worker-source.ts'
import { pdfAssets } from '../generated/pdf-assets.ts'
import { buildParagraphs, paragraphAt, type PageText, type Paragraph } from './paragraphs.ts'
import { MathText } from './math.tsx'
import type { Annotation, JumpRequest } from './types.ts'

const PAGE_SCALE = 96 / 72
/** Move the pointer toward the card without losing it. */
const TOOLTIP_HIDE_DELAY_MS = 450
/** Dwell before the card switches to another paragraph; kills hover flicker. */
const TOOLTIP_SWITCH_DELAY_MS = 220
let workerUrl: string | undefined
const assetCache = new Map<string, Promise<Uint8Array>>()

function ensureWorker(): void {
  if (workerUrl !== undefined) return
  workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  GlobalWorkerOptions.workerSrc = workerUrl
}

/**
 * Feed PDF.js's text layer small item batches across macrotasks. A dense page
 * measures every span with `measureText`, which otherwise holds the main
 * thread for seconds at a time.
 */
function pacedTextContent(source: ReadableStream<{ items?: unknown[] }>, batch = 48): ReadableStream {
  const reader = source.getReader()
  const queue: { items?: unknown[] }[] = []
  let finished = false
  return new ReadableStream({
    async pull(controller) {
      if (queue.length === 0) {
        if (finished) {
          controller.close()
          return
        }
        const result = await reader.read()
        if (result.done) {
          finished = true
          controller.close()
          return
        }
        const value = result.value ?? {}
        const items = Array.isArray(value.items) ? value.items : []
        if (items.length > batch) {
          for (let index = 0; index < items.length; index += batch) {
            queue.push({ ...value, items: items.slice(index, index + batch) })
          }
        } else {
          queue.push(value)
        }
      }
      // Let input, paint, and the next frame run before the next batch.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
      controller.enqueue(queue.shift())
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/**
 * Page raster work runs one page at a time and yields between pages, so a
 * burst of pages entering view never blocks input for a full second.
 */
const renderQueue: Array<() => Promise<void>> = []
let pumping = false

function nextTask(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

async function pumpRenderQueue(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (renderQueue.length > 0) {
      const run = renderQueue.shift()!
      try {
        await run()
      } catch {
        // A cancelled or failed page leaves the queue running.
      }
      await nextTask()
    }
  } finally {
    pumping = false
  }
}

const textQueue: Array<() => Promise<void>> = []
let textPumping = false

async function pumpTextQueue(): Promise<void> {
  if (textPumping) return
  textPumping = true
  try {
    while (textQueue.length > 0) {
      const run = textQueue.shift()!
      try {
        await run()
      } catch {
        // Text layers are optional for rendering; failures are dropped.
      }
      await nextTask()
    }
  } finally {
    textPumping = false
  }
}

function enqueueText(run: () => Promise<void>): () => void {
  textQueue.push(run)
  void pumpTextQueue()
  return () => {
    const index = textQueue.indexOf(run)
    if (index >= 0) textQueue.splice(index, 1)
  }
}

function enqueueRender(run: () => Promise<void>): () => void {
  renderQueue.push(run)
  void pumpRenderQueue()
  return () => {
    const index = renderQueue.indexOf(run)
    if (index >= 0) renderQueue.splice(index, 1)
  }
}

async function decodeAsset(kind: 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl', filename: string): Promise<Uint8Array> {
  const key = `${kind}/${filename}`
  let pending = assetCache.get(key)
  if (pending !== undefined) return pending
  pending = (async () => {
    const encoded = (pdfAssets as Record<string, Record<string, string>>)[kind]?.[filename]
    if (encoded === undefined) throw new Error(`PDF.js asset is not bundled: ${key}`)
    const compressed = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress the bundled PDF.js assets.')
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  })()
  assetCache.set(key, pending)
  return pending
}

class InlineBinaryDataFactory {
  fetch(request: { kind: 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'; filename: string }): Promise<Uint8Array> {
    return decodeAsset(request.kind, request.filename)
  }
}

interface OpenPdf {
  readonly document: Promise<PDFDocumentProxy>
  destroy(): Promise<void>
}

function openPdf(buffer: ArrayBuffer, signal: AbortSignal): OpenPdf {
  ensureWorker()
  let task: ReturnType<typeof getDocument> | undefined
  let destroying: Promise<void> | undefined
  const destroy = (): Promise<void> => {
    destroying ??= Promise.resolve().then(async () => {
      try {
        await task?.destroy()
      } catch {
        // A loading task that failed before producing a document is already gone.
      }
    })
    return destroying
  }
  const onAbort = (): void => { void destroy() }
  signal.addEventListener('abort', onAbort, { once: true })
  const document = (async () => {
    const data = new Uint8Array(buffer.slice(0))
    task = getDocument({
      data,
      cMapPacked: true,
      useWorkerFetch: false,
      BinaryDataFactory: InlineBinaryDataFactory as never,
      enableXfa: false,
      stopAtErrors: false,
    })
    try {
      return await task.promise
    } catch (error) {
      await destroy()
      throw error
    }
  })()
  return {
    document,
    destroy: async () => {
      signal.removeEventListener('abort', onAbort)
      await destroy()
    },
  }
}

/** Every paragraph of the document, in unscaled page geometry. */
async function extractParagraphs(document: PDFDocumentProxy, signal: AbortSignal): Promise<Paragraph[]> {
  const pages: PageText[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (signal.aborted) return []
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: PageText['items'] = []
    for (const entry of content.items) {
      const item = entry as { str?: string; transform?: number[]; width?: number }
      if (typeof item.str !== 'string' || item.str.trim() === '' || item.transform === undefined) continue
      const matrix = Util.transform(viewport.transform, item.transform)
      // Rotated runs (margin stamps, axis labels) have no usable horizontal
      // box; leaving them out keeps them from swallowing the real paragraphs.
      if (Math.abs(Math.atan2(matrix[1]!, matrix[0]!)) > 0.12) continue
      const fontSize = Math.hypot(matrix[2]!, matrix[3]!)
      const width = typeof item.width === 'number' ? item.width : 0
      if (!(fontSize > 0.1) || !(width > 0) || !Number.isFinite(matrix[4]) || !Number.isFinite(matrix[5])) continue
      items.push({ str: item.str, x: matrix[4]!, y: matrix[5]!, width, height: fontSize })
    }
    pages.push({ page: pageNumber, width: viewport.width, height: viewport.height, items })
  }
  return buildParagraphs(pages)
}

export interface PdfReaderProps {
  readonly bytes: ArrayBuffer
  readonly annotations: readonly Annotation[]
  readonly paragraphs: readonly Paragraph[]
  readonly translations: Readonly<Record<string, string>>
  readonly showTranslations: boolean
  readonly pendingLabel: string
  readonly width: number
  readonly fitWidth: boolean
  readonly zoom: number
  readonly jump: JumpRequest | undefined
  readonly flashId: string | undefined
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly onPageCount: (count: number) => void
  readonly onVisiblePage: (page: number) => void
  /** Local PDF.js extraction is the fallback used when MinerU is unavailable. */
  readonly extractLocally: boolean
  /** A scroll is in flight: defer page raster work so frames stay smooth. */
  readonly scrolling: boolean
  readonly onParagraphs?: (paragraphs: Paragraph[]) => void
  /** Ask about one whole paragraph, without a drag selection. */
  readonly onAskParagraph: (paragraph: Paragraph) => void
  readonly onError: (message: string) => void
}

interface HoveredParagraph {
  readonly paragraph: Paragraph
  readonly rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
}

/** Render every page at its natural geometry and expose PDF.js's selectable text layer. */
export function PdfReader(props: PdfReaderProps): ReactNode {
  const {
    bytes, width, fitWidth, zoom, annotations, paragraphs, translations, showTranslations,
    pendingLabel, extractLocally, scrolling, jump, flashId, t, onPageCount, onVisiblePage, onParagraphs, onError,
    onAskParagraph,
  } = props
  const [document, setDocument] = useState<PDFDocumentProxy>()
  const [pages, setPages] = useState(0)
  const [failure, setFailure] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [hover, setHover] = useState<HoveredParagraph>()
  const pagesRef = useRef<HTMLDivElement>(null)
  const tooltip = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const switchTimer = useRef<number | undefined>(undefined)
  // Callers may recreate their callbacks every render (a locale change does),
  // so the loading effect must not depend on their identity.
  const latest = useRef({ onPageCount, onVisiblePage, onParagraphs, onError })
  useEffect(() => {
    latest.current = { onPageCount, onVisiblePage, onParagraphs, onError }
  })

  useEffect(() => {
    const controller = new AbortController()
    setDocument(undefined)
    setPages(0)
    setFailure(undefined)
    setHover(undefined)
    const session = openPdf(bytes, controller.signal)
    session.document.then(
      (next) => {
        if (controller.signal.aborted) return
        setDocument(next)
        setPages(next.numPages)
        latest.current.onPageCount(next.numPages)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setFailure(message)
        latest.current.onError(message)
      },
    ).catch(() => {
      // Rendering does not depend on text extraction.
    })
    return () => {
      controller.abort()
      void session.destroy()
    }
  }, [bytes, attempt])

  // Local paragraph extraction runs only when the layout parse is not supplying them.
  useEffect(() => {
    if (document === undefined || !extractLocally) return
    const controller = new AbortController()
    void extractParagraphs(document, controller.signal).then(
      (list) => { if (!controller.signal.aborted) latest.current.onParagraphs?.(list) },
      () => {},
    )
    return () => { controller.abort() }
  }, [document, extractLocally])

  useEffect(() => {
    if (jump === undefined) return
    const target = pagesRef.current?.querySelector(`[data-paper-page="${jump.page}"]`)
    if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [jump?.nonce])

  function holdTooltip(): void {
    if (hideTimer.current !== undefined) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }
  }

  function cancelSwitch(): void {
    if (switchTimer.current !== undefined) {
      window.clearTimeout(switchTimer.current)
      switchTimer.current = undefined
    }
  }

  /** The card is scrollable, so leaving the page gives the pointer time to reach it. */
  function releaseTooltip(): void {
    holdTooltip()
    cancelSwitch()
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = undefined
      setHover(undefined)
    }, TOOLTIP_HIDE_DELAY_MS)
  }

  function dismissTooltip(): void {
    holdTooltip()
    cancelSwitch()
    setHover(undefined)
  }

  function acceptHover(next: HoveredParagraph | undefined): void {
    if (next === undefined) {
      releaseTooltip()
      return
    }
    holdTooltip()
    const current = hover
    if (current !== undefined && current.paragraph.id === next.paragraph.id) {
      cancelSwitch()
      return
    }
    cancelSwitch()
    // First card shows at once; switching requires a short dwell so passing
    // over paragraphs on the way to the card does not retrigger it.
    if (current === undefined) {
      setHover(next)
      return
    }
    switchTimer.current = window.setTimeout(() => {
      switchTimer.current = undefined
      setHover(next)
    }, TOOLTIP_SWITCH_DELAY_MS)
  }

  useEffect(() => () => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current)
    if (switchTimer.current !== undefined) window.clearTimeout(switchTimer.current)
  }, [])

  useEffect(() => {
    if (!showTranslations) dismissTooltip()
  }, [showTranslations])

  useEffect(() => {
    if (hover === undefined) return
    const clear = (event: Event): void => {
      // Scrolling inside the card itself must not dismiss it.
      const node = tooltip.current
      if (node !== null && event.target instanceof Node && node.contains(event.target)) return
      dismissTooltip()
    }
    window.addEventListener('scroll', clear, true)
    return () => { window.removeEventListener('scroll', clear, true) }
  }, [hover])

  const byPage = useMemo(() => {
    const map = new Map<number, Paragraph[]>()
    for (const paragraph of paragraphs) {
      const list = map.get(paragraph.page)
      if (list === undefined) map.set(paragraph.page, [paragraph])
      else list.push(paragraph)
    }
    return map
  }, [paragraphs])

  if (failure !== undefined) {
    return <div className="pr-pdf-status" role="alert">
      <p>{t('reader.loadFailed')}</p>
      <button type="button" className="pr-button" onClick={() => { setAttempt(value => value + 1) }}>
        {t('reader.retry')}
      </button>
    </div>
  }
  if (document === undefined) {
    return <div className="pr-pdf-status" role="status">
      <span className="pr-spinner" aria-hidden="true" />
      <p>{t('reader.loading')}</p>
    </div>
  }
  return <div className="pr-pages" ref={pagesRef}>
    {Array.from({ length: pages }, (_, index) => <PdfPage
      key={index + 1}
      document={document}
      pageNumber={index + 1}
      width={width}
      fitWidth={fitWidth}
      zoom={zoom}
      annotations={annotations}
      paragraphs={byPage.get(index + 1) ?? []}
      scrolling={scrolling}
      hoveredId={showTranslations && hover !== undefined && hover.paragraph.page === index + 1
        ? hover.paragraph.id
        : undefined}
      showTranslations={showTranslations}
      flashId={flashId}
      t={t}
      onVisible={onVisiblePage}
      onHover={acceptHover}
    />)}
    {hover !== undefined && showTranslations && <TranslationPopover
      t={t}
      rect={hover.rect}
      text={translations[hover.paragraph.id]}
      pendingLabel={pendingLabel}
      source={hover.paragraph.text}
      page={hover.paragraph.page}
      panelRef={tooltip}
      onHold={holdTooltip}
      onRelease={releaseTooltip}
      onAsk={() => {
        const paragraph = hover.paragraph
        dismissTooltip()
        onAskParagraph(paragraph)
      }}
    />}
  </div>
}

const PdfPage = memo(function PdfPage(props: {
  readonly document: PDFDocumentProxy
  readonly pageNumber: number
  readonly width: number
  readonly fitWidth: boolean
  readonly zoom: number
  readonly annotations: readonly Annotation[]
  readonly paragraphs: readonly Paragraph[]
  readonly hoveredId: string | undefined
  readonly showTranslations: boolean
  readonly scrolling: boolean
  readonly flashId: string | undefined
  readonly t: PdfReaderProps['t']
  readonly onVisible: (page: number) => void
  readonly onHover: (hover: HoveredParagraph | undefined) => void
}): ReactNode {
  const {
    document, pageNumber, width, fitWidth, zoom, annotations, paragraphs,
    hoveredId, showTranslations, scrolling, flashId, t, onVisible, onHover,
  } = props
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textHost = useRef<HTMLDivElement>(null)
  const textScale = useRef<number | undefined>(undefined)
  // The text layer is expensive; build it only for a page the pointer reaches.
  const [wantText, setWantText] = useState(false)
  /** What the canvas currently holds, so a preview can be upgraded in place. */
  const painted = useRef<{ readonly scale: number; readonly ratio: number } | undefined>(undefined)
  const hovered = useRef<string | undefined>(undefined)
  const [page, setPage] = useState<PDFPageProxy>()
  const [visible, setVisible] = useState(pageNumber <= 2)
  // Kept current (not sticky) so offscreen pages skip canvas work on zoom,
  // width changes, and theme re-renders.
  const [inView, setInView] = useState(pageNumber <= 2)
  const [metrics, setMetrics] = useState<{ width: number; height: number }>()
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const node = host.current
    if (node === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry === undefined) return
      if (entry.isIntersecting) {
        setVisible(true)
        onVisible(pageNumber)
      }
      setInView(entry.isIntersecting)
    }, { rootMargin: '500px 0px' })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [pageNumber, onVisible])

  useEffect(() => {
    if (!visible || page !== undefined) return
    let active = true
    document.getPage(pageNumber).then(
      (next) => { if (active) setPage(next) },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [document, pageNumber, visible, page, attempt])

  /** Viewport for the current width, fit mode, and zoom. */
  function viewportFor(target: PDFPageProxy): PageViewport {
    const base = target.getViewport({ scale: PAGE_SCALE })
    const cssWidth = fitWidth ? Math.max(140, width) : Math.max(100, base.width * zoom)
    const scale = cssWidth / base.width
    return target.getViewport({ scale: PAGE_SCALE * scale })
  }

  // Canvas paint. While the user scrolls, a cheap preview keeps the page
  // visible under the scroll; the full-resolution pass follows once it stops.
  useEffect(() => {
    const targetCanvas = canvas.current
    if (targetCanvas === null) return
    if (!inView) {
      if (targetCanvas.width > 0) {
        // Release the bitmap of a page that scrolled away. Fifteen retained
        // high-DPI canvases were the bulk of this view's GPU memory.
        targetCanvas.width = 0
        targetCanvas.height = 0
      }
      painted.current = undefined
      return
    }
    if (page === undefined || !visible || width <= 0) return
    const viewport = viewportFor(page)
    const fullRatio = Math.min(globalThis.devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (viewport.width * viewport.height)))
    const current = painted.current
    const sameScale = current !== undefined && Math.abs(current.scale - viewport.scale) < 1e-4
    if (scrolling) {
      // Nothing usable on screen yet? Paint a fast preview so content follows
      // the scroll instead of leaving a blank page.
      if (sameScale && current !== undefined && current.ratio > 0) return
    } else if (sameScale && current !== undefined && current.ratio >= fullRatio - 1e-3) {
      return
    }
    const ratio = scrolling ? Math.min(0.7, fullRatio) : fullRatio
    let active = true
    let renderTask: RenderTask | undefined
    setStatus('loading')
    const paint = async (): Promise<void> => {
      const pixel = page.getViewport({ scale: viewport.scale * ratio })
      targetCanvas.width = Math.max(1, Math.floor(pixel.width))
      targetCanvas.height = Math.max(1, Math.floor(pixel.height))
      renderTask = page.render({ canvas: targetCanvas, viewport: pixel })
      await renderTask.promise
      if (!active) return
      painted.current = { scale: viewport.scale, ratio }
      setMetrics({ width: viewport.width, height: viewport.height })
      setStatus('ready')
    }
    const cancelQueued = enqueueRender(async () => {
      try {
        await paint()
      } catch {
        if (active) setStatus('error')
      }
    })
    return () => {
      active = false
      cancelQueued()
      renderTask?.cancel()
    }
  }, [page, width, fitWidth, zoom, visible, inView, scrolling, attempt])

  // Text layer: built on demand (pointer over the page), because measuring
  // every span is the most expensive thing this view does on the main thread.
  useEffect(() => {
    if (page === undefined || !visible || !inView || width <= 0 || !wantText) return
    const targetText = textHost.current
    if (targetText === null) return
    const viewport = viewportFor(page)
    if (targetText.childElementCount > 0 && textScale.current === viewport.scale) return
    let active = true
    let layer: TextLayer | undefined
    const cancelQueued = enqueueText(async () => {
      if (!active) return
      targetText.replaceChildren()
      // PDF.js positions text spans from these factors; without them the
      // spans fall back to the inherited font size and selection misses.
      targetText.style.setProperty('--total-scale-factor', String(viewport.scale))
      targetText.style.setProperty('--scale-round-x', '1px')
      targetText.style.setProperty('--scale-round-y', '1px')
      layer = new TextLayer({
        textContentSource: pacedTextContent(page.streamTextContent({ includeMarkedContent: true })),
        container: targetText,
        viewport,
      })
      await layer.render()
      if (!active) return
      textScale.current = viewport.scale
    })
    return () => {
      active = false
      cancelQueued()
      layer?.cancel()
    }
  }, [page, width, fitWidth, zoom, visible, inView, wantText, t])

  const rects = annotations.flatMap(annotation => annotation.rects
    .filter(rect => rect.page === pageNumber)
    .map(rect => ({ annotation, rect })))
  const surfaceWidth = `${metrics?.width ?? Math.max(140, width)}px`
  const hoveredParagraph = hoveredId === undefined ? undefined : paragraphs.find(entry => entry.id === hoveredId)

  function requestText(): void {
    if (!wantText) setWantText(true)
  }

  function handleMove(event: MouseEvent<HTMLDivElement>): void {
    requestText()
    const selected = window.getSelection()
    if (selected !== null && !selected.isCollapsed && selected.rangeCount > 0) {
      // Never talk over an active text selection.
      if (hovered.current !== undefined) {
        hovered.current = undefined
        onHover(undefined)
      }
      return
    }
    if (!showTranslations || paragraphs.length === 0) {
      if (hovered.current !== undefined) {
        hovered.current = undefined
        onHover(undefined)
      }
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return
    const x = (event.clientX - bounds.left) / bounds.width
    const y = (event.clientY - bounds.top) / bounds.height
    const found = paragraphAt(paragraphs, x, y)
    if (found === undefined) {
      if (hovered.current !== undefined) {
        hovered.current = undefined
        onHover(undefined)
      }
      return
    }
    if (found.id === hovered.current) return
    hovered.current = found.id
    onHover({
      paragraph: found,
      rect: {
        left: bounds.left + found.x * bounds.width,
        top: bounds.top + found.y * bounds.height,
        right: bounds.left + (found.x + found.width) * bounds.width,
        bottom: bounds.top + (found.y + found.height) * bounds.height,
      },
    })
  }

  function handleLeave(): void {
    if (hovered.current === undefined) return
    hovered.current = undefined
    onHover(undefined)
  }

  return <div className="pr-page" data-paper-page={pageNumber} ref={host}>
    <div className="pr-page-number" aria-hidden="true">{pageNumber}</div>
    <div
      className="pr-surface"
      data-paper-surface
      style={{ width: surfaceWidth, aspectRatio: metrics === undefined ? '3 / 4' : `${metrics.width} / ${metrics.height}` }}
      onMouseMove={handleMove}
      onMouseDown={requestText}
      onMouseLeave={handleLeave}
    >
      <canvas ref={canvas} className="pr-canvas" role="img" aria-label={t('reader.pageImage', { page: pageNumber })} />
      <div className="pr-annotations" aria-hidden="true">
        {rects.map(({ annotation, rect }, index) => <span
          key={`${annotation.id}-${index}`}
          className={`pr-annotation ${annotation.kind === 'note' ? 'pr-annotation-note' : ''} ${flashId === annotation.id ? 'pr-annotation-flash' : ''}`}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />)}
      </div>
      {hoveredParagraph !== undefined && <span
        className="pr-paragraph-active"
        aria-hidden="true"
        style={{
          left: `${hoveredParagraph.x * 100}%`,
          top: `${hoveredParagraph.y * 100}%`,
          width: `${hoveredParagraph.width * 100}%`,
          height: `${hoveredParagraph.height * 100}%`,
        }}
      />}
      <div ref={textHost} className="pr-text textLayer" data-paper-text />
      {(status === 'loading' || status === 'error') && <div className="pr-page-status">
        {status === 'error'
          ? <button type="button" className="pr-link" onClick={() => { setStatus('idle'); setAttempt(value => value + 1) }}>{t('reader.retry')}</button>
          : <span className="pr-spinner" aria-label={t('reader.rendering')} />}
      </div>}
    </div>
  </div>
})

/** Floating Chinese translation of the hovered paragraph, anchored below it. */
function TranslationPopover(props: {
  readonly t: PdfReaderProps['t']
  readonly rect: HoveredParagraph['rect']
  readonly text: string | undefined
  readonly pendingLabel: string
  readonly source: string
  readonly page: number
  readonly panelRef: { current: HTMLDivElement | null }
  readonly onHold: () => void
  readonly onRelease: () => void
  readonly onAsk: () => void
}): ReactNode {
  const { t, rect, text, pendingLabel, source, page, panelRef, onHold, onRelease, onAsk } = props
  const [overflowing, setOverflowing] = useState(false)

  // Fit the viewport first: the side with more room wins, and the card may use
  // all of it. Long translations scroll inside the card instead of being cut.
  const margin = 10
  const maxWidth = Math.max(220, Math.min(420, window.innerWidth - margin * 2))
  const width = Math.min(Math.max(rect.right - rect.left, 280), maxWidth)
  const spaceBelow = window.innerHeight - rect.bottom - margin * 2
  const spaceAbove = rect.top - margin * 2
  const below = spaceBelow >= 200 || spaceBelow >= spaceAbove
  const maxHeight = Math.min(460, Math.max(140, below ? spaceBelow : spaceAbove))
  const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - width - margin))

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    setOverflowing(element.scrollHeight > element.clientHeight + 2)
  }, [text, pendingLabel, source, maxHeight, width])

  return createPortal(<div
    ref={panelRef}
    className={`pr-translation ${below ? '' : 'pr-translation-above'} ${overflowing ? 'pr-translation-overflowing' : ''}`}
    role="status"
    onMouseEnter={onHold}
    onMouseLeave={onRelease}
    style={{
      left,
      width,
      maxHeight,
      ...(below
        ? { top: rect.bottom + margin }
        : { bottom: Math.max(margin, window.innerHeight - rect.top + margin) }),
    }}
  >
    <div className="pr-translation-head">
      <span className="pr-translation-tag">{t('translate.label')}</span>
      <span className="pr-translation-page">{t('notes.page', { page })}</span>
    </div>
    <div ref={scrollRef} className="pr-translation-scroll">
      <p className="pr-translation-body">
        {text !== undefined && text !== ''
          ? <MathText text={text} />
          : <span className="pr-translation-pending">{pendingLabel}</span>}
      </p>
      <p className="pr-translation-source"><MathText text={source} /></p>
    </div>
    {overflowing && <span className="pr-translation-fade" aria-hidden="true" />}
    <div className="pr-translation-actions">
      <button type="button" className="pr-translation-ask" onClick={onAsk}>
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 4.2h13v9.2h-7L5 17v-3.6H3.5z" />
          <path d="M7 8.2h6M7 10.8h3.6" />
        </svg>
        <span>{t('menu.ask')}</span>
      </button>
    </div>
  </div>, document.body)
}


/** Declared for the host's lazy chunk loader. */
export default PdfReader
