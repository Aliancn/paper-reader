/** Settings section: configure the MinerU API token through the Host credential store. */
import { useEffect, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { PaperIcon } from './ui.tsx'
import { parseAvailable } from './mineru.ts'

const TOKEN_REF = 'MINERU_TOKEN'

/** The credentials controller is optional: a Host without a mounted provider rejects the call. */
interface CredentialView {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

interface SettingsProps {
  readonly ctx: Context
  readonly t: (key: string, params?: Record<string, unknown>) => string
}

type Status = 'loading' | 'ready' | 'saving' | 'error'

export function SettingsSection({ ctx, t }: SettingsProps): ReactNode {
  const [view, setView] = useState<CredentialView | undefined>(undefined)
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [parse, setParse] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let active = true
    const read = async (): Promise<void> => {
      try {
        const response = await ctx.remote.credentials.describe([TOKEN_REF])
        if (!active) return
        if (response.ok) {
          const next = response.value[TOKEN_REF]
          setView(next === undefined ? { configured: false, writable: false } : next)
        } else {
          setView({ configured: false, writable: false })
        }
        setStatus('ready')
      } catch {
        if (!active) return
        setView({ configured: false, writable: false })
        setStatus('ready')
      }
      // The parse route reads the live token, so this reflects what a new upload gets.
      setParse(await parseAvailable(AbortSignal.timeout(10_000)).catch(() => false))
    }
    void read()
    const dispose = ctx.remote.$on('credentials/reference-updated', (ref: unknown) => {
      if (ref === TOKEN_REF && active) void read()
    })
    return () => {
      active = false
      dispose()
    }
  }, [ctx])

  const save = async (): Promise<void> => {
    const trimmed = value.trim()
    if (trimmed === '') return
    setStatus('saving')
    setError(undefined)
    setSaved(false)
    try {
      await ctx.remote.credentials.set(TOKEN_REF, trimmed)
      setValue('')
      setSaved(true)
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('error')
    }
  }

  const clear = async (): Promise<void> => {
    setStatus('saving')
    setError(undefined)
    setSaved(false)
    try {
      await ctx.remote.credentials.unset(TOKEN_REF)
      setSaved(true)
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('error')
    }
  }

  const sourceLabel = (source: string | undefined): string => {
    if (source === 'file') return t('settings.sourceFile')
    if (source === 'env' || source === 'project-env' || source === 'user-env') return t('settings.sourceEnv')
    return source
  }

  return <div className="pr-settings">
    <div className="pr-settings-head">
      <PaperIcon size={18} />
      <h2>{t('settings.title')}</h2>
    </div>
    <p className="pr-settings-lead">{t('settings.description')}</p>

    <label className="pr-settings-label" htmlFor="pr-mineru-token">{t('settings.tokenLabel')}</label>
    <div className="pr-settings-row">
      <input
        id="pr-mineru-token"
        className="pr-settings-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('settings.tokenPlaceholder')}
        value={value}
        disabled={status === 'saving' || status === 'loading'}
        onChange={(event) => { setValue(event.currentTarget.value); setSaved(false) }}
        onKeyDown={(event) => { if (event.key === 'Enter') void save() }}
      />
      {status === 'saving'
        ? <span className="pr-settings-inlineSave"><span className="pr-spinner pr-spinner-small" aria-hidden="true" /></span>
        : <button
            className="pr-button pr-button-primary"
            type="button"
            disabled={status !== 'ready' || value.trim() === ''}
            onClick={() => { void save() }}
          >{t('settings.save')}</button>}
    </div>
    <p className="pr-hint">{t('settings.tokenHint')}</p>

    {status === 'loading'
      ? <p className="pr-hint"><span className="pr-spinner pr-spinner-small" aria-hidden="true" /> {t('settings.loading')}</p>
      : <div className="pr-settings-state">
          {view?.configured === true
            ? <span className="pr-chip pr-settings-badge">
                <span className="pr-settings-dot pr-settings-dot-on" />
                {t('settings.configured')}
                {view.source !== undefined ? <span className="pr-settings-source">{sourceLabel(view.source)}</span> : null}
              </span>
            : <span className="pr-chip pr-settings-badge">
                <span className="pr-settings-dot" />
                {t('settings.notConfigured')}
              </span>}
          {view?.configured === true && view.writable && status === 'ready'
            ? <button className="pr-button" type="button" onClick={() => { void clear() }}>{t('settings.clear')}</button>
            : null}
          <span className="pr-settings-parse">
            {parse === undefined ? '' : parse ? t('settings.parseReady') : t('settings.parseOff')}
          </span>
        </div>}

    {saved ? <p className="pr-settings-saved">{t('settings.saved')}</p> : null}
    {error !== undefined ? <p className="pr-error">{error}</p> : null}
    <p className="pr-hint">{t('settings.privacy')}</p>
  </div>
}
