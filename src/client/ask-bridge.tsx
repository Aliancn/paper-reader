/** Hidden composer seat that lets the reader insert a prompt and quote into chat. */
import { useEffect } from 'react'

type Insert = (prompt: string, quote: string) => boolean
const inserts = new Map<string, Insert>()

/** Insert a prompt and its quoted passage into a session's composer. */
export function askInConversation(sessionId: string, prompt: string, quote: string): boolean {
  const insert = inserts.get(sessionId)
  if (insert === undefined) return false
  return insert(prompt, quote)
}

/**
 * Register the current composer's insertion capability for the reader.
 * The dock entry renders nothing; it only publishes stable actions.
 */
export function AskBridge(props: { sessionId?: string; inputActions?: {
  captureInsertion: () => unknown
  insertText: (text: string, span: never) => boolean
  insertQuote?: (text: string) => boolean
} }): null {
  const { sessionId, inputActions } = props
  useEffect(() => {
    if (sessionId === undefined || inputActions === undefined) return
    const insert: Insert = (prompt, quote) => {
      const span = inputActions.captureInsertion()
      if (typeof inputActions.insertQuote === 'function') {
        if (!inputActions.insertText(`${prompt.trim()}\n\n`, span as never)) return false
        return inputActions.insertQuote(quote)
      }
      // Older shells expose only plain insertion; keep the quote readable as a
      // Markdown blockquote instead of failing the handoff.
      const quoted = quote.split(/\r?\n/u).map(line => `> ${line}`).join('\n')
      return inputActions.insertText(`${prompt.trim()}\n\n${quoted}`, span as never)
    }
    inserts.set(sessionId, insert)
    return () => {
      if (inserts.get(sessionId) === insert) inserts.delete(sessionId)
    }
  }, [sessionId, inputActions])
  return null
}
