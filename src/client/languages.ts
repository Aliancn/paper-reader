/**
 * Target languages the reader can translate into.
 *
 * The Host validates the incoming tag against the same shape, so every id here is
 * a plain BCP 47 language tag. `label` is the name shown in the picker, written in
 * the language itself so it reads correctly whatever the interface locale is.
 */

export interface LanguageOption {
  readonly id: string
  readonly label: string
}

/** Languages offered in the picker, in display order. Chinese first as the default. */
export const LANGUAGES: readonly LanguageOption[] = [
  { id: 'zh', label: '简体中文' },
  { id: 'zh-tw', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
  { id: 'pt', label: 'Português' },
]

/** Used when nothing valid is stored yet. */
export const DEFAULT_LANGUAGE = 'zh'

/** Same shape the Host accepts, so a stored value can never produce a rejected request. */
export const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/

/** The stored translation target for a paper, falling back to the default. */
export function resolveLanguage(value: unknown): string {
  return typeof value === 'string' && LANGUAGE_PATTERN.test(value) ? value : DEFAULT_LANGUAGE
}

/** The human label for a tag, falling back to the tag itself for unlisted languages. */
export function languageLabel(tag: string): string {
  const match = LANGUAGES.find(option => option.id.toLowerCase() === tag.toLowerCase())
  return match?.label ?? tag
}

/**
 * The IndexedDB key for one paper's translations in one language.
 *
 * The plain `paperId::language` form is kept whenever it is unambiguous, which
 * covers every generated id, so stored translations keep loading. A paper id that
 * itself contains the separator would let two papers share one key, so those ids
 * fall back to a length-prefixed form that cannot collide.
 */
export function translationKey(paperId: string, language: string): string {
  return paperId.includes('::')
    ? `${paperId.length}:${paperId}::${language}`
    : `${paperId}::${language}`
}
