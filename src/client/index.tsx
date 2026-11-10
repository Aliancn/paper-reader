/** Right-sidebar paper reader: guide entry, tab body, live title, chat composer bridge, and settings page. */
import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { PaperBody } from './PaperBody.tsx'
import { PaperIcon } from './ui.tsx'
import { SettingsSection } from './settings.tsx'
import { en, zh, ja, es, fr, de, ru, pt, type PaperLocaleKey } from './locales.ts'
import { AskBridge } from './ask-bridge.tsx'
import { useTabTitle } from './tab-title.ts'
import { CSS } from './styles.ts'

const ID = 'dsh-paper-reader'
const KIND = 'paper-reader'
const NS = 'paperReader'
const STYLE_ID = 'dsh-paper-reader/styles'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Paper reader interface copy. */
    paperReader: PaperLocaleKey
  }
}

export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.credentials']

function installStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function useLocale(ctx: Context): string {
  const subscribe = useCallback((listener: () => void) => ctx.on('locale/change', listener), [ctx])
  return useSyncExternalStore(subscribe, () => ctx.locale.getSnapshot().active, () => 'en')
}

export function apply(ctx: Context): void {
  installStyles()
  const t = ctx.locale.bind(NS)

  function PaperTitle(props: { useTabInfo: () => { tab: { id: string } } }): ReactNode {
    const { tab } = props.useTabInfo()
    const locale = useLocale(ctx)
    const title = useTabTitle(String(tab.id), t('tab.title'))
    void locale
    return <span className="pr-chip" title={title}>
      <PaperIcon size={14} />
      <span className="pr-chip-label">{title}</span>
    </span>
  }

  function Body(props: Record<string, unknown>): ReactNode {
    const locale = useLocale(ctx)
    return <PaperBody {...props} t={t} locale={locale} />
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'paper-reader: copy')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    keepMounted: true,
    title: () => t('tab.title'),
    guide: [{
      id: 'paper-reader',
      order: 40,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: PaperIcon,
    }],
  }), 'paper-reader: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
    locale: NS,
  }, Body)), 'paper-reader: body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: ID,
    locale: NS,
  }, PaperTitle)), 'paper-reader: title')
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'paper-reader-bridge',
    order: 5,
    locale: NS,
  }, AskBridge)), 'paper-reader: chat bridge')
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: ID,
    order: 30,
    label: () => t('settings.nav'),
  }, (props: Record<string, unknown>) => <SettingsSection ctx={ctx} t={t} {...props} />)), 'paper-reader: settings section')
  ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    id: ID,
  }, ({ size }: { size?: number }) => <PaperIcon size={size ?? 16} />)), 'paper-reader: settings icon')
}
