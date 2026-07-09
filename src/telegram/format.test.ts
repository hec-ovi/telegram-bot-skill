import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkText, escapeHtml } from './format.ts'

test('escapeHtml escapes the three HTML-significant characters', () => {
  assert.equal(escapeHtml('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d')
  assert.equal(escapeHtml('<script>&'), '&lt;script&gt;&amp;')
})

test('escapeHtml escapes & first so entities are not double-broken', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;')
})

test('chunkText returns short text as a single chunk', () => {
  assert.deepEqual(chunkText('hello'), ['hello'])
  assert.deepEqual(chunkText(''), [])
})

test('chunkText keeps text exactly at the limit whole', () => {
  const text = 'x'.repeat(4000)
  assert.deepEqual(chunkText(text), [text])
})

test('chunkText prefers paragraph boundaries', () => {
  const a = 'a'.repeat(3000)
  const b = 'b'.repeat(3000)
  assert.deepEqual(chunkText(`${a}\n\n${b}`, 4000), [a, b])
})

test('chunkText falls back to line then word boundaries', () => {
  const a = 'a'.repeat(3000)
  const b = 'b'.repeat(3000)
  assert.deepEqual(chunkText(`${a}\n${b}`, 4000), [a, b])
  assert.deepEqual(chunkText(`${a} ${b}`, 4000), [a, b])
})

test('chunkText hard-cuts a single word longer than the limit', () => {
  const giant = 'x'.repeat(9000)
  const chunks = chunkText(giant, 4000)
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [4000, 4000, 1000],
  )
  assert.equal(chunks.join(''), giant)
})

test('chunkText never exceeds the limit', () => {
  const text = Array.from({ length: 50 }, (_, i) => `paragraph ${i} ${'word '.repeat(60)}`).join('\n\n')
  for (const chunk of chunkText(text, 500)) {
    assert.ok(chunk.length <= 500, `chunk of ${chunk.length} exceeds limit`)
  }
})
