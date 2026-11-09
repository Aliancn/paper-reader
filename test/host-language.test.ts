/** Host-side target-language validation and the names handed to the model. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LANGUAGE, LANGUAGE, LANGUAGE_NAMES, languageName } from '../src/host/index.js'

test('the default language is one the model knows by name', () => {
  assert.equal(typeof DEFAULT_LANGUAGE, 'string')
  assert.ok(languageName(DEFAULT_LANGUAGE) !== DEFAULT_LANGUAGE, 'the default must map to a readable name')
})

test('ordinary language tags are accepted', () => {
  for (const tag of ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'ru', 'pt', 'zh-tw', 'zh-Hans', 'pt-BR']) {
    assert.match(tag, LANGUAGE, `tag ${tag} would be rejected`)
  }
})

test('malformed tags are rejected', () => {
  for (const tag of ['', 'x', 'zzzz', 'zh_CN', 'zh CN', '../etc', 'a-b', 'zh-', '-zh', 'zh--tw', 'zh 中文']) {
    assert.doesNotMatch(tag, LANGUAGE, `tag ${tag} should be rejected`)
  }
})

test('Chinese variants map to the right script', () => {
  assert.equal(languageName('zh'), 'Simplified Chinese')
  assert.equal(languageName('zh-cn'), 'Simplified Chinese')
  assert.equal(languageName('zh-tw'), 'Traditional Chinese')
  assert.equal(languageName('zh-hk'), 'Traditional Chinese')
})

test('matching ignores case', () => {
  assert.equal(languageName('ZH-TW'), 'Traditional Chinese')
  assert.equal(languageName('JA'), 'Japanese')
})

test('an unknown but well-formed tag is passed through unchanged', () => {
  // The model prompt then reads "Translate into sw", which is still actionable.
  assert.equal(languageName('sw'), 'sw')
  assert.equal(languageName('yue'), 'yue')
})

test('every mapped name is non-empty text', () => {
  for (const [tag, name] of Object.entries(LANGUAGE_NAMES)) {
    assert.equal(typeof name, 'string')
    assert.ok(name.trim() !== '', `language ${tag} has an empty name`)
    assert.match(tag, LANGUAGE, `the map holds ${tag}, which the validator would reject`)
  }
})
