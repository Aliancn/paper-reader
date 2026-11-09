/** Target-language selection, the mapping onto stored translation keys, and tag validation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_PATTERN,
  LANGUAGES,
  languageLabel,
  resolveLanguage,
  translationKey,
} from '../src/client/languages.ts'

test('a stored language is used as-is', () => {
  assert.equal(resolveLanguage('ja'), 'ja')
  assert.equal(resolveLanguage('zh-tw'), 'zh-tw')
  assert.equal(resolveLanguage('pt-BR'), 'pt-BR')
})

test('anything unusable falls back to the default', () => {
  for (const value of [undefined, null, '', 42, {}, [], 'not a language!', 'zh_CN']) {
    assert.equal(resolveLanguage(value), DEFAULT_LANGUAGE, `input: ${String(value)}`)
  }
})

test('every offered language passes the Host validation pattern', () => {
  // The Host rejects a tag that does not match, so a picker entry that failed
  // here would make translation fail for that language only.
  for (const option of LANGUAGES) {
    assert.match(option.id, LANGUAGE_PATTERN, `offered language ${option.id} would be rejected`)
  }
})

test('offered languages are unique and the default is among them', () => {
  const ids = LANGUAGES.map(option => option.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate language id')
  assert.ok(ids.includes(DEFAULT_LANGUAGE), 'the default language is not offered in the picker')
})

test('a language label resolves, and unknown tags fall back to the tag', () => {
  assert.equal(languageLabel('zh'), '简体中文')
  assert.equal(languageLabel('ja'), '日本語')
  assert.equal(languageLabel('ZH-TW'), '繁體中文', 'matching is case-insensitive')
  assert.equal(languageLabel('sw'), 'sw', 'an unlisted language shows its own tag')
})

test('translation keys separate the same paper across languages', () => {
  assert.equal(translationKey('p1', 'zh'), 'p1::zh')
  assert.notEqual(translationKey('p1', 'zh'), translationKey('p1', 'ja'))
  // A paper id containing the separator must not let two papers collide.
  assert.notEqual(translationKey('a::b', 'zh'), translationKey('a', 'b::zh'))
})
