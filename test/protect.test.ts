/**
 * Inline-token protection for model translation: masking, strict
 * restoration, and the repair ladder inside `modelTranslate`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskInlineTokens, restoreInlineTokens } from '../src/host/protect.js'

test('math, commands, URLs, and DOIs become numbered placeholders', () => {
  const source = 'The loss $L(x)$ follows from $$E=mc^2$$ per \\cite{ref} at https://example.org/a with doi:10.1234/abc.def'
  const masked = maskInlineTokens(source)
  assert.ok(!masked.text.includes('$L(x)$'))
  assert.ok(!masked.text.includes('E=mc^2'))
  assert.ok(!masked.text.includes('example.org'))
  assert.ok(masked.text.includes('⟦0⟧'))
  assert.equal(masked.tokens.length, 5)
  // Prose stays in place around the placeholders.
  assert.match(masked.text, /^The loss ⟦\d+⟧ follows from ⟦\d+⟧ per ⟦\d+⟧ at ⟦\d+⟧ with ⟦\d+⟧$/)
})

test('overlapping patterns never nest', () => {
  // `$$E=mc^2$$` also contains a `\mc`-shaped command start; the display
  // span wins and no placeholder is placed inside another.
  const masked = maskInlineTokens('Given $$E=mc^2$$ and $a_i$ we proceed')
  assert.equal(masked.tokens.length, 2)
  const restored = restoreInlineTokens(masked.text, masked.tokens)
  assert.equal(restored.missing, 0)
  assert.ok(!restored.invalid)
  assert.equal(restored.text, 'Given $$E=mc^2$$ and $a_i$ we proceed')
})

test('a placeholder that already exists in the text is skipped', () => {
  // A literal ⟦0⟧ in the source is itself protected, so it becomes a token
  // too; the masked text carries distinct placeholders for both spans.
  const masked = maskInlineTokens('See ⟦0⟧ and $x$')
  const mathToken = masked.tokens.find(token => token.original === '$x$')
  assert.notEqual(mathToken.placeholder, '⟦0⟧')
  const roundTrip = restoreInlineTokens(masked.text, masked.tokens)
  assert.equal(roundTrip.missing, 0)
  assert.ok(!roundTrip.invalid)
  assert.equal(roundTrip.text, 'See ⟦0⟧ and $x$')
})

test('a dropped placeholder marks the answer missing', () => {
  const masked = maskInlineTokens('The value $x$ is small')
  const restored = restoreInlineTokens('该值很小', masked.tokens)
  assert.equal(restored.missing, 1)
})

test('a duplicated placeholder marks the answer invalid', () => {
  const masked = maskInlineTokens('The value $x$ is small')
  const restored = restoreInlineTokens(`该值 ${masked.tokens[0].placeholder} ${masked.tokens[0].placeholder} 很小`, masked.tokens)
  assert.ok(restored.invalid)
})

test('a clean round trip restores the exact source', () => {
  const source = 'In \\textbf{Sec.} 3 the estimator $\\hat{\\theta}$ minimizes https://example.org/x'
  const masked = maskInlineTokens(source)
  const restored = restoreInlineTokens(masked.text, masked.tokens)
  assert.equal(restored.text, source)
})

test('text without protected spans passes through with no tokens', () => {
  const masked = maskInlineTokens('Plain prose only')
  assert.equal(masked.text, 'Plain prose only')
  assert.equal(masked.tokens.length, 0)
  const restored = restoreInlineTokens('只有普通文字', masked.tokens)
  assert.equal(restored.missing, 0)
  assert.ok(!restored.invalid)
})
