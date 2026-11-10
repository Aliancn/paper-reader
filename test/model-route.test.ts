/** Translation model resolution: pinned pair, chat default, and service mode. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translationRoute } from '../src/host/index.js'

const selection = () => ({ provider: 'chat-default', model: 'glm-5.3' })
const ctx = { get: (name) => (name === 'agentDefaultModel' ? { currentSelection: selection } : undefined) }

test('a pinned provider and model pair wins over the chat default', () => {
  assert.deepEqual(
    translationRoute(ctx, { translation: { provider: 'bifrost', model: 'sgl/deepseek-v4.1-flash' } }),
    { provider: 'bifrost', model: 'sgl/deepseek-v4.1-flash' },
  )
})

test('without a pin the chat default model is used', () => {
  assert.deepEqual(translationRoute(ctx, {}), { provider: 'chat-default', model: 'glm-5.3' })
  assert.deepEqual(translationRoute(ctx, { translation: { provider: 'bifrost' } }), { provider: 'chat-default', model: 'glm-5.3' })
  assert.deepEqual(translationRoute(ctx, { translation: { model: 'sgl/deepseek-v4.1-flash' } }), { provider: 'chat-default', model: 'glm-5.3' })
})

test('an empty pin value falls back to the chat default', () => {
  assert.deepEqual(
    translationRoute(ctx, { translation: { provider: '', model: '' } }),
    { provider: 'chat-default', model: 'glm-5.3' },
  )
})

test('service mode disables the model route entirely', () => {
  assert.equal(translationRoute(ctx, { mode: 'service' }), undefined)
  assert.equal(
    translationRoute(ctx, { mode: 'service', translation: { provider: 'bifrost', model: 'sgl/deepseek-v4.1-flash' } }),
    undefined,
  )
})

test('no configured chat default and no pin resolves undefined', () => {
  assert.equal(translationRoute({ get: () => undefined }, {}), undefined)
  assert.equal(translationRoute({ get: () => ({ currentSelection: () => null }) }, {}), undefined)
})
