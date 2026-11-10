/**
 * The repair ladder inside `modelTranslate`: a clean batch answer restores
 * directly, a damaged segment is retried alone, and a segment the model
 * keeps mangling falls through to the anonymous routes as null.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelTranslate } from '../src/host/index.js'

/**
 * A fake llm service that answers from a script of round handlers. The real
 * service resolves its stream synchronously (an object that is directly
 * async-iterable), so the fake returns one too: a promise of an iterable
 * would fail `for await` before the first chunk.
 */
function fakeLlm(rounds) {
  let call = 0
  return {
    stream: (options) => {
      const round = rounds[Math.min(call, rounds.length - 1)]
      call += 1
      const text = typeof round === 'function' ? round(options) : round
      const deltas = []
      for (let cursor = 0; cursor < text.length; cursor += 40) {
        deltas.push(text.slice(cursor, cursor + 40))
      }
      let index = 0
      return {
        async * [Symbol.asyncIterator]() {
          while (index < deltas.length) {
            yield { type: 'text-delta', text: deltas[index] }
            index += 1
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
}

const ctxWith = (llm) => ({ get: (name) => (name === 'llm' ? llm : undefined) })
const route = { provider: 'bifrost', model: 'sgl/deepseek-v4.1-flash' }

test('a clean batch answer restores every placeholder', async () => {
  const llm = fakeLlm(['[[1]] 损失 ⟦0⟧ 很小\n\n[[2]] 参见 ⟦0⟧ 的讨论'])
  const results = await modelTranslate(ctxWith(llm), route, ['the loss $L(x)$ is small', 'see $n$ discussions'], 'zh')
  assert.deepEqual(results, ['损失 $L(x)$ 很小', '参见 $n$ 的讨论'])
})

test('a segment that drops its placeholder is retried alone and restored', async () => {
  const llm = fakeLlm([
    // First round: segment 1 comes back with the placeholder dropped.
    '[[1]] 损失很小\n\n[[2]] 参见 ⟦0⟧ 的讨论',
    // Repair round for segment 1 alone.
    '损失 ⟦0⟧ 很小',
  ])
  const results = await modelTranslate(ctxWith(llm), route, ['the loss $L(x)$ is small', 'see $n$ discussions'], 'zh')
  assert.deepEqual(results, ['损失 $L(x)$ 很小', '参见 $n$ 的讨论'])
})

test('a segment the model keeps mangling falls through to null', async () => {
  const llm = fakeLlm([
    // Batch answer drops the placeholder.
    '[[1]] 损失很小',
    // Single-segment retry still drops it.
    '损失很小',
    // Prose fragment answers invent a placeholder: the repair fails.
    '损失 ⟦5⟧ 很小',
  ])
  const results = await modelTranslate(ctxWith(llm), route, ['the loss $L(x)$ is small'], 'zh')
  assert.deepEqual(results, [null])
})

test('a missing segment marker leaves that segment for the repair ladder', async () => {
  const llm = fakeLlm([
    // Segment 2's marker never appears; segment 1 is clean.
    '[[1]] 损失 ⟦0⟧ 很小',
    '参见 ⟦0⟧ 的讨论',
  ])
  const results = await modelTranslate(ctxWith(llm), route, ['the loss $L(x)$ is small', 'see $n$ discussions'], 'zh')
  assert.deepEqual(results, ['损失 $L(x)$ 很小', '参见 $n$ 的讨论'])
})

test('no llm service resolves to all null without calling the network', async () => {
  let calls = 0
  const llm = { stream: async () => { calls += 1; throw new Error('unreachable') } }
  const results = await modelTranslate(ctxWith(undefined), route, ['text'], 'zh')
  assert.deepEqual(results, [null])
  assert.equal(calls, 0)
})
