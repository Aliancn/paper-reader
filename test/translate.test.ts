/** Paragraph batching and sentence splitting for the Host translation route. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { batchParagraphs, splitText } from '../src/client/translate.ts'

const entry = (text: string) => ({ text })

test('short text is returned as one part', () => {
  assert.deepEqual(splitText('A short sentence.', 100), ['A short sentence.'])
})

test('empty or whitespace-only text yields no parts', () => {
  assert.deepEqual(splitText('', 100), [])
  assert.deepEqual(splitText('   \n\t ', 100), [])
})

test('a long paragraph is split, and no part exceeds the limit', () => {
  const text = 'This is a sentence. '.repeat(40).trim()
  const parts = splitText(text, 100)
  assert.ok(parts.length > 1, 'text longer than the limit must be split')
  for (const part of parts) {
    assert.ok(part.length <= 100, `part of ${part.length} chars exceeds the 100 char limit`)
  }
})

test('splitting preserves every word of the source', () => {
  const text = 'Alpha beta gamma. Delta epsilon zeta. Eta theta iota. Kappa lambda mu.'
  const parts = splitText(text, 30)
  const rejoined = parts.join(' ').replace(/\s+/gu, ' ').trim()
  assert.equal(rejoined, text.replace(/\s+/gu, ' ').trim())
})

test('text with no spaces still makes progress', () => {
  // A pathological run with no separators must not loop or return nothing.
  const parts = splitText('x'.repeat(250), 100)
  assert.ok(parts.length >= 2)
  assert.equal(parts.join('').length, 250)
})

test('batching keeps every entry exactly once', () => {
  const entries = Array.from({ length: 50 }, (_, index) => entry(`paragraph number ${index}`))
  const batches = batchParagraphs(entries, 1000, 5)
  const flat = batches.flat()
  assert.equal(flat.length, entries.length, 'batching must not drop or duplicate an entry')
  assert.deepEqual(flat.map(item => item.text), entries.map(item => item.text), 'original order is kept')
})

test('batching respects the per-batch entry count', () => {
  const entries = Array.from({ length: 20 }, (_, index) => entry(`p${index}`))
  for (const batch of batchParagraphs(entries, 4000, 4)) {
    assert.ok(batch.length <= 4, `batch of ${batch.length} exceeds the count limit of 4`)
  }
})

test('batching respects the character budget', () => {
  const entries = Array.from({ length: 20 }, () => entry('y'.repeat(200)))
  const batches = batchParagraphs(entries, 500, 10, 500)
  for (const batch of batches) {
    const chars = batch.reduce((total, item) => total + Math.min(item.text.length, 500), 0)
    assert.ok(chars <= 500, `batch carries ${chars} chars, over the 500 char budget`)
  }
})

test('an empty input produces no batches', () => {
  assert.deepEqual(batchParagraphs([], 1000, 5), [])
})

test('a single entry always forms one batch', () => {
  const batches = batchParagraphs([entry('only one')], 1000, 5)
  assert.equal(batches.length, 1)
  assert.equal(batches[0]!.length, 1)
})
