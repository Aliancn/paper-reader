/** Live tab-chip titles shared by the body and the keyed title seat. */
import { useSyncExternalStore } from 'react'

const titles = new Map<string, string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Set or clear the title shown on one reader tab. */
export function setTabTitle(tabId: string, title: string | undefined): void {
  const current = titles.get(tabId)
  if (title === undefined) {
    if (current === undefined) return
    titles.delete(tabId)
  } else {
    if (current === title) return
    titles.set(tabId, title)
  }
  emit()
}

/** Read the live title, falling back to the localized tab name. */
export function useTabTitle(tabId: string, fallback: string): string {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => titles.get(tabId) ?? fallback,
    () => fallback,
  )
}
