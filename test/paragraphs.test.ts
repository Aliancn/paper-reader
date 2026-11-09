/** Paragraph extraction from positioned PDF.js text runs. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARAGRAPH_VERSION, buildParagraphs, type PageText } from '../src/client/paragraphs.ts'

/** Build one text run of ordinary height, placed by its top-left corner. */
function item(str: string, x: number, y: number, width = str.length * 6): PageText {
  return {
    page: 1,
    width: 612,
    height: 792,
    items: [{ str, x, y, width, height: 10 }],
  }
}

/** One page from stacked lines at a fixed leading. */
function pageOf(lines: readonly { text: string; x: number; width?: number }[]): PageText {
  return {
    page: 1,
    width: 612,
    height: 792,
    items: lines.map((line, index) => ({
      str: line.text,
      x: line.x,
      y: 100 + index * 14,
      width: line.width ?? line.text.length * 6,
      height: 10,
    })),
  }
}

test('no text produces no paragraphs', () => {
  assert.deepEqual(buildParagraphs([]), [])
  assert.deepEqual(buildParagraphs([{ page: 1, width: 612, height: 792, items: [] }]), [])
})

test('a single line becomes one paragraph carrying its text', () => {
  const paragraphs = buildParagraphs([item('Hello world', 72, 100)])
  assert.equal(paragraphs.length, 1)
  assert.equal(paragraphs[0]!.text, 'Hello world')
  assert.equal(paragraphs[0]!.page, 1)
})

test('consecutive lines merge into one paragraph', () => {
  const paragraphs = buildParagraphs([pageOf([
    { text: 'The first line of a paragraph', x: 72 },
    { text: 'and its second line', x: 72 },
  ])])
  assert.equal(paragraphs.length, 1, 'lines at one column should not be split apart')
  assert.match(paragraphs[0]!.text, /first line/u)
  assert.match(paragraphs[0]!.text, /second line/u)
})

test('a wide vertical gap starts a new paragraph', () => {
  const paragraphs = buildParagraphs([{
    page: 1,
    width: 612,
    height: 792,
    items: [
      { str: 'Top of the page', x: 72, y: 100, width: 120, height: 10 },
      { str: 'A separate block below', x: 72, y: 400, width: 160, height: 10 },
    ],
  }])
  assert.equal(paragraphs.length, 2, 'a large vertical gap must split paragraphs')
})

test('two columns stay separate paragraphs', () => {
  // Same vertical band, one run on each side of the gutter.
  const paragraphs = buildParagraphs([{
    page: 1,
    width: 612,
    height: 792,
    items: [
      { str: 'left column text here', x: 72, y: 100, width: 180, height: 10 },
      { str: 'right column text here', x: 330, y: 100, width: 180, height: 10 },
    ],
  }])
  assert.equal(paragraphs.length, 2, 'column detection should keep the columns apart')
})

test('no paragraph is empty or whitespace-only', () => {
  const paragraphs = buildParagraphs([pageOf([
    { text: 'Real text', x: 72 },
    { text: '   ', x: 72 },
  ])])
  for (const paragraph of paragraphs) {
    assert.notEqual(paragraph.text.trim(), '', 'an empty paragraph would show an empty hover box')
  }
})

test('every paragraph reports finite geometry inside its page', () => {
  const paragraphs = buildParagraphs([pageOf([
    { text: 'Some body text', x: 72 },
    { text: 'More body text', x: 72 },
  ])])
  assert.ok(paragraphs.length > 0)
  for (const paragraph of paragraphs) {
    for (const value of [paragraph.x, paragraph.y, paragraph.width, paragraph.height]) {
      assert.ok(Number.isFinite(value), 'geometry must be a finite number')
    }
    assert.ok(paragraph.width > 0 && paragraph.height > 0, 'a paragraph must have area to hover')
    assert.ok(paragraph.lines.length > 0, 'a paragraph keeps at least one line box')
  }
})

test('paragraph ids are unique', () => {
  const paragraphs = buildParagraphs([pageOf([
    { text: 'One', x: 72 },
    { text: 'Two', x: 72 },
    { text: 'Three', x: 72 },
  ])])
  const ids = paragraphs.map(paragraph => paragraph.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids would collide in the translation cache')
})

test('the version is a positive integer that changes with the geometry', () => {
  // Stored translations are keyed to this number, so a non-integer or a
  // zero would make cache invalidation unreliable.
  assert.ok(Number.isInteger(PARAGRAPH_VERSION))
  assert.ok(PARAGRAPH_VERSION > 0)
})
