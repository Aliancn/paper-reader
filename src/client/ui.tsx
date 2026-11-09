/** Small presentation helpers shared by the reader shell. */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface IconProps {
  readonly size?: number
  readonly className?: string
}

function svg(props: IconProps, children: ReactNode, viewBox = '0 0 20 20'): ReactNode {
  const { size = 16, className } = props
  return <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
}

export function PaperIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="M5.5 2.75h6.1L15.5 6.6v10.65H5.5z" />
    <path d="M11.4 2.9v4h3.9M8 10.2h5M8 13h5M8 7.5h1.7" />
  </>)
}

export function UploadIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="M10 13V3.5M6.5 7 10 3.5 13.5 7" />
    <path d="M4 12.5v3.1c0 .5.4.9.9.9h10.2c.5 0 .9-.4.9-.9v-3.1" />
  </>)
}

export function HighlightIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="m5 15 1.2-3.2L13 4.9a1.8 1.8 0 0 1 2.5 0l.6.6a1.8 1.8 0 0 1 0 2.5l-6.9 6.8L5 15Z" />
    <path d="M4 17.5h12" />
  </>)
}

export function NoteIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="M4 3.5h12v9.6l-3.9 3.9H4z" />
    <path d="M12 17v-4h4M7 7.2h6M7 10h4.6" />
  </>)
}

export function ChatIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="M3.5 4.2h13v9.2h-7L5 17v-3.6H3.5z" />
    <path d="M7 8.2h6M7 10.8h3.6" />
  </>)
}

export function BackIcon(props: IconProps): ReactNode {
  return svg(props, <path d="m12.5 4.5-5 5.5 5 5.5" />)
}

export function CloseIcon(props: IconProps): ReactNode {
  return svg(props, <path d="m5 5 10 10M15 5 5 15" />)
}

export function TrashIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="M4 6h12M8 6V4h4v2M6 6l.7 10.2c0 .5.4.8.8.8h5c.4 0 .8-.3.8-.8L14 6" />
    <path d="M8.5 9v4.5M11.5 9v4.5" />
  </>) 
}

export function EditIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="m4 16 .8-3.2L13.4 4.2a1.7 1.7 0 0 1 2.4 0l.2.2a1.7 1.7 0 0 1 0 2.4l-8.6 8.4z" />
    <path d="m11.8 5.8 2.4 2.4" />
  </>)
}

export function ChevronLeftIcon(props: IconProps): ReactNode {
  return svg(props, <path d="m12 5-4.5 5 4.5 5" />)
}

export function ChevronRightIcon(props: IconProps): ReactNode {
  return svg(props, <path d="m8 5 4.5 5L8 15" />)
}

export function FitIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13" />
    <path d="M3.5 10h13" opacity=".45" />
  </>)
}

export function MinusIcon(props: IconProps): ReactNode {
  return svg(props, <path d="M5 10h10" />)
}

export function PlusIcon(props: IconProps): ReactNode {
  return svg(props, <path d="M10 5v10M5 10h10" />)
}

/** Translation: a globe with a small language swap mark. */
export function GlobeIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <circle cx="10" cy="10" r="6.4" />
    <path d="M3.8 7.6h12.4M3.8 12.4h12.4" />
    <path d="M10 3.6c1.8 2 2.7 4.2 2.7 6.4s-.9 4.4-2.7 6.4c-1.8-2-2.7-4.2-2.7-6.4S8.2 5.6 10 3.6Z" />
  </>)
}

export function ListIcon(props: IconProps): ReactNode {
  return svg(props, <>
    <path d="M7 5.5h9M7 10h9M7 14.5h9" />
    <path d="M4 5.5h.01M4 10h.01M4 14.5h.01" />
  </>)
}

/** One page-local id without depending on the asynchronous Web Crypto API. */
export function localId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Compact, locale-aware file size. */
export function formatBytes(size: number, locale: string): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const value = size / 1024 ** exponent
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: exponent === 0 ? 0 : 1 }).format(value)} ${units[exponent]}`
}

/** Modal shell portaled outside the sidebar's clipped stacking context. */
export function Modal(props: {
  readonly title: string
  readonly children: ReactNode
  readonly onClose: () => void
  readonly closeLabel?: string
  readonly wide?: boolean
}): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    const text = panel.current?.querySelector<HTMLElement>('textarea, input')
    const first = text ?? panel.current?.querySelector<HTMLElement>('button')
    first?.focus()
    return () => { document.removeEventListener('keydown', onKey) }
  }, [props.onClose])
  return createPortal(<div className="pr-modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) props.onClose()
  }}>
    <div ref={panel} className={`pr-modal ${props.wide === true ? 'pr-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="pr-modal-head">
        <h2>{props.title}</h2>
        <button type="button" className="pr-icon-button" aria-label={props.closeLabel ?? 'Close'} onClick={props.onClose}><CloseIcon /></button>
      </div>
      {props.children}
    </div>
  </div>, document.body)
}
