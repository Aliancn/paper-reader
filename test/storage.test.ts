/** Storage quota detection and the eviction choice that follows it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isQuotaError, selectEvictions, StorageQuotaError } from '../src/client/storage.ts'
import type { PaperMeta } from '../src/client/types.ts'

function paper(id: string, lastOpenedAt: number): PaperMeta {
  return { id, title: id, fileName: `${id}.pdf`, size: 1024, addedAt: lastOpenedAt, lastOpenedAt }
}

/** Most recently opened first, exactly as `listPapers` orders them. */
const LIBRARY: PaperMeta[] = [
  paper('newest', 500),
  paper('middle', 300),
  paper('older', 200),
  paper('oldest', 100),
]

test('a quota failure is recognised by its name', () => {
  const error = new Error('no room')
  error.name = 'QuotaExceededError'
  assert.equal(isQuotaError(error), true)
})

test('named DOMExceptions from older engines are recognised', () => {
  for (const name of ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']) {
    const error = new Error('no room')
    error.name = name
    assert.equal(isQuotaError(error), true, name)
  }
  assert.equal(isQuotaError({ code: 22 }), true, 'the legacy numeric code still means quota')
})

test('ordinary failures are not treated as quota', () => {
  for (const error of [new Error('boom'), { name: 'AbortError' }, { code: 0 }, null, undefined, 'text', 42]) {
    assert.equal(isQuotaError(error), false, `input: ${String(error)}`)
  }
})

test('StorageQuotaError keeps its own name so callers can branch on it', () => {
  const error = new StorageQuotaError()
  assert.equal(error.name, 'StorageQuotaError')
  assert.ok(error instanceof Error)
  assert.equal(isQuotaError(error), false, 'the typed wrapper is not itself an IndexedDB quota error')
})

test('eviction starts from the least recently opened paper', () => {
  assert.deepEqual(selectEvictions(LIBRARY), ['oldest', 'older', 'middle'])
})

test('the paper being opened is never evicted', () => {
  const chosen = selectEvictions(LIBRARY, 'oldest')
  assert.ok(!chosen.includes('oldest'), 'the paper in use must survive its own upload')
  assert.equal(chosen[0], 'older', 'the next stalest paper goes first')
})

test('the limit caps how much one upload can destroy', () => {
  assert.equal(selectEvictions(LIBRARY, undefined, 1).length, 1)
  assert.equal(selectEvictions(LIBRARY, undefined, 0).length, 0)
  assert.equal(selectEvictions(LIBRARY, undefined, -5).length, 0, 'a negative limit deletes nothing')
})

test('a library that is empty or only the current paper yields no victims', () => {
  assert.deepEqual(selectEvictions([]), [])
  assert.deepEqual(selectEvictions([paper('only', 1)], 'only'), [])
})

test('the input order is not mutated', () => {
  const input = [...LIBRARY]
  selectEvictions(input)
  assert.deepEqual(input.map(entry => entry.id), LIBRARY.map(entry => entry.id))
})
