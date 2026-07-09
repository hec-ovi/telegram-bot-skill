import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bchFormat, qrMatrix, qrToTerminal, rsEncode } from './qr.ts'

test('Reed-Solomon matches the canonical HELLO WORLD vector', () => {
  // Published worked example (thonky.com QR tutorial): v1-M, 10 EC codewords.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
  assert.deepEqual(rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
})

test('golden matrix for "hello" (externally verified with an OpenCV decode)', () => {
  const expected = [
    '111111100101101111111',
    '100000101101001000001',
    '101110101100101011101',
    '101110100101001011101',
    '101110101000101011101',
    '100000101001101000001',
    '111111101010101111111',
    '000000001111100000000',
    '110100110110001110110',
    '011111011100001000011',
    '001101111010110001101',
    '000101001001000001011',
    '000010110110101010000',
    '000000001111000110101',
    '111111101110010101110',
    '100000100111110110000',
    '101110100101001110001',
    '101110101011000101111',
    '101110100110100010101',
    '100000101110011000000',
    '111111101011100101010',
  ]
  const actual = qrMatrix('hello').map((row) => row.map((c) => (c ? '1' : '0')).join(''))
  assert.deepEqual(actual, expected)
})

test('picks the smallest version that fits, and rejects oversize input', () => {
  assert.equal(qrMatrix('x'.repeat(17)).length, 21) // v1
  assert.equal(qrMatrix('x'.repeat(18)).length, 25) // v2
  assert.equal(qrMatrix('x'.repeat(53)).length, 29) // v3
  assert.equal(qrMatrix('x'.repeat(134)).length, 41) // v6
  assert.throws(() => qrMatrix('x'.repeat(135)), /too long/)
})

test('finder patterns sit in three corners with light separators', () => {
  const m = qrMatrix('https://t.me/my_agent_bot?start=Ab9xK2fLq83R')
  const size = m.length
  const checkFinder = (top: number, left: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const dark = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        assert.equal(m[top + r][left + c], dark, `finder mismatch at ${top + r},${left + c}`)
      }
    }
  }
  checkFinder(0, 0)
  checkFinder(0, size - 7)
  checkFinder(size - 7, 0)
  for (let i = 0; i < 8; i++) {
    assert.equal(m[7][i], false, 'separator below top-left finder')
    assert.equal(m[i][7], false, 'separator right of top-left finder')
  }
})

test('timing patterns alternate between the finders', () => {
  const m = qrMatrix('hello')
  const size = m.length
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `row timing at col ${i}`)
    assert.equal(m[i][6], i % 2 === 0, `column timing at row ${i}`)
  }
})

test('format info: both copies agree, BCH-valid, error level L', () => {
  for (const text of ['hello', 'x'.repeat(60)]) {
    const m = qrMatrix(text)
    const size = m.length
    const copy1: boolean[] = []
    const copy2: boolean[] = []
    for (let i = 0; i < 15; i++) {
      if (i < 6) copy1.push(m[i][8])
      else if (i < 8) copy1.push(m[i + 1][8])
      else if (i === 8) copy1.push(m[8][7])
      else copy1.push(m[8][14 - i])
      if (i < 8) copy2.push(m[8][size - 1 - i])
      else copy2.push(m[size - 15 + i][8])
    }
    assert.deepEqual(copy1, copy2, 'the two format copies must be identical')
    const bits = copy1.reduce((acc, bit, i) => acc | (Number(bit) << i), 0)
    const unmasked = bits ^ 0x5412
    const data5 = unmasked >> 10
    assert.equal(data5 >> 3, 0b01, 'error correction level must be L')
    const mask = data5 & 0b111
    assert.ok(mask >= 0 && mask <= 7)
    assert.equal(bchFormat(data5), bits, 'BCH remainder must validate')
    assert.equal(m[size - 8][8], true, 'dark module')
  }
})

test('output is deterministic', () => {
  const link = 'https://t.me/hectors_agent_bot?start=m3REJvO0y7za'
  assert.deepEqual(qrMatrix(link), qrMatrix(link))
})

test('terminal rendering: half-block lines with a 4-module quiet zone', () => {
  const m = qrMatrix('hello')
  const size = m.length
  const lines = qrToTerminal(m).split('\n')
  assert.equal(lines.length, Math.ceil((size + 8) / 2))
  for (const line of lines) {
    assert.equal(line.length, size + 8)
    assert.match(line, /^[█▀▄ ]+$/)
  }
  // The quiet zone is light, so the first line must be solid blocks.
  assert.equal(lines[0], '█'.repeat(size + 8))
})
