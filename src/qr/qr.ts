// Zero-dependency QR encoder, enough for claim links: byte mode, error
// correction level L, versions 1 to 6 (up to 134 bytes). Implements the
// full spec path for that slice: Reed-Solomon over GF(256), function
// patterns, all 8 masks with penalty scoring, BCH format info.

interface VersionSpec {
  version: number
  size: number
  dataCodewords: number
  ecPerBlock: number
  blocks: number
}

const VERSIONS: VersionSpec[] = [
  { version: 1, size: 21, dataCodewords: 19, ecPerBlock: 7, blocks: 1 },
  { version: 2, size: 25, dataCodewords: 34, ecPerBlock: 10, blocks: 1 },
  { version: 3, size: 29, dataCodewords: 55, ecPerBlock: 15, blocks: 1 },
  { version: 4, size: 33, dataCodewords: 80, ecPerBlock: 20, blocks: 1 },
  { version: 5, size: 37, dataCodewords: 108, ecPerBlock: 26, blocks: 1 },
  { version: 6, size: 41, dataCodewords: 136, ecPerBlock: 18, blocks: 2 },
]

/* ---------- GF(256), primitive polynomial 0x11d ---------- */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

// Straightforward remainder of data * x^ecCount divided by the generator.
export function rsEncode(data: number[], ecCount: number): number[] {
  const gen = generatorDescending(ecCount)
  const remainder = new Array(ecCount).fill(0)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.shift()
    remainder.push(0)
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) {
        remainder[i] ^= gfMul(gen[i + 1], factor)
      }
    }
  }
  return remainder
}

// Generator with coefficients in descending powers, leading 1 first.
export function generatorDescending(ecCount: number): number[] {
  let poly = [1]
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j] // times x
      next[j + 1] ^= gfMul(poly[j], EXP[i]) // times alpha^i
    }
    poly = next
  }
  return poly
}

/* ---------- bit stream ---------- */

class BitBuffer {
  bits: number[] = []

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1)
    }
  }

  toBytes(): number[] {
    const bytes: number[] = []
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ?? 0)
      bytes.push(byte)
    }
    return bytes
  }
}

export function encodeCodewords(text: string): { spec: VersionSpec; codewords: number[] } {
  const bytes = new TextEncoder().encode(text)
  const spec = VERSIONS.find((v) => v.dataCodewords - 2 >= bytes.length)
  if (spec === undefined) {
    throw new Error(`text too long for QR versions 1-6: ${bytes.length} bytes (max 134)`)
  }

  const buffer = new BitBuffer()
  buffer.push(0b0100, 4) // byte mode
  buffer.push(bytes.length, 8) // char count, 8 bits for versions 1-9
  for (const byte of bytes) buffer.push(byte, 8)
  const capacityBits = spec.dataCodewords * 8
  buffer.push(0, Math.min(4, capacityBits - buffer.bits.length)) // terminator
  while (buffer.bits.length % 8 !== 0) buffer.bits.push(0)
  const data = buffer.toBytes()
  const pads = [0xec, 0x11]
  for (let i = 0; data.length < spec.dataCodewords; i++) data.push(pads[i % 2])

  // Split into blocks, compute EC per block, interleave.
  const perBlock = spec.dataCodewords / spec.blocks
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  for (let b = 0; b < spec.blocks; b++) {
    const block = data.slice(b * perBlock, (b + 1) * perBlock)
    dataBlocks.push(block)
    ecBlocks.push(rsEncode(block, spec.ecPerBlock))
  }
  const codewords: number[] = []
  for (let i = 0; i < perBlock; i++) {
    for (const block of dataBlocks) codewords.push(block[i])
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) codewords.push(block[i])
  }
  return { spec, codewords }
}

/* ---------- matrix ---------- */

type Cell = boolean | null

function functionTemplate(spec: VersionSpec): Cell[][] {
  const size = spec.size
  const grid: Cell[][] = Array.from({ length: size }, () => new Array<Cell>(size).fill(null))

  const setFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r
        const col = left + c
        if (row < 0 || col < 0 || row >= size || col >= size) continue
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6
        const dark = inRing && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))
        grid[row][col] = dark
      }
    }
  }
  setFinder(0, 0)
  setFinder(0, size - 7)
  setFinder(size - 7, 0)

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0
    if (grid[6][i] === null) grid[6][i] = dark
    if (grid[i][6] === null) grid[i][6] = dark
  }

  // Alignment pattern (versions 2-6 have exactly one, at size-7).
  if (spec.version >= 2) {
    const center = size - 7
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1
        grid[center + r][center + c] = dark
      }
    }
  }

  // Reserve format info areas (filled per mask later) and the dark module.
  for (let i = 0; i < 9; i++) {
    if (grid[i][8] === null) grid[i][8] = false
    if (grid[8][i] === null) grid[8][i] = false
  }
  for (let i = 0; i < 8; i++) {
    if (grid[8][size - 1 - i] === null) grid[8][size - 1 - i] = false
    if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false
  }
  grid[size - 8][8] = true // dark module

  return grid
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

export function bchFormat(data5: number): number {
  let value = data5 << 10
  for (let i = 14; i >= 10; i--) {
    if ((value >> i) & 1) value ^= 0x537 << (i - 10)
  }
  return ((data5 << 10) | value) ^ 0x5412
}

function writeFormat(grid: Cell[][], size: number, mask: number): void {
  const bits = bchFormat((0b01 << 3) | mask) // EC level L is 01
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1
    // Copy 1, around the top-left finder (skips the timing row and column).
    if (i < 6) grid[i][8] = dark
    else if (i < 8) grid[i + 1][8] = dark
    else if (i === 8) grid[8][7] = dark
    else grid[8][14 - i] = dark
    // Copy 2, split across the other two finders.
    if (i < 8) grid[8][size - 1 - i] = dark
    else grid[size - 15 + i][8] = dark
  }
}

function placeData(grid: Cell[][], size: number, codewords: number[], mask: number): boolean[][] {
  const out: boolean[][] = grid.map((row) => row.map((cell) => cell === true))
  const totalBits = codewords.length * 8
  const maskFn = MASKS[mask]
  let bitIndex = 0
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col-- // the timing column is skipped whole
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i
      for (const c of [col, col - 1]) {
        if (grid[row][c] !== null) continue
        const bit =
          bitIndex < totalBits
            ? ((codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1) === 1
            : false
        bitIndex++
        out[row][c] = maskFn(row, c) ? !bit : bit
      }
    }
    upward = !upward
  }
  return out
}

function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0
  // Rule 1: runs of 5+ same-colored modules in rows and columns.
  for (let axis = 0; axis < 2; axis++) {
    for (let i = 0; i < size; i++) {
      let run = 1
      for (let j = 1; j < size; j++) {
        const current = axis === 0 ? m[i][j] : m[j][i]
        const previous = axis === 0 ? m[i][j - 1] : m[j - 1][i]
        if (current === previous) {
          run++
          if (j === size - 1 && run >= 5) score += run - 2
        } else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
    }
  }
  // Rule 2: 2x2 blocks of the same color.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 pattern with 4 light modules on a side.
  const pattern1 = [true, false, true, true, true, false, true, false, false, false, false]
  const pattern2 = [false, false, false, false, true, false, true, true, true, false, true]
  for (let axis = 0; axis < 2; axis++) {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j + 11 <= size; j++) {
        for (const pattern of [pattern1, pattern2]) {
          let hit = true
          for (let k = 0; k < 11; k++) {
            const value = axis === 0 ? m[i][j + k] : m[j + k][i]
            if (value !== pattern[k]) {
              hit = false
              break
            }
          }
          if (hit) score += 40
        }
      }
    }
  }
  // Rule 4: dark-module balance.
  let dark = 0
  for (const row of m) for (const cell of row) if (cell) dark++
  const percent = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(percent - 50) / 5) * 10
  return score
}

export function qrMatrix(text: string, forcedMask?: number): boolean[][] {
  const { spec, codewords } = encodeCodewords(text)
  const template = functionTemplate(spec)
  let best: boolean[][] | undefined
  let bestScore = Infinity
  const masks = forcedMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask]
  for (const mask of masks) {
    const grid = template.map((row) => row.slice())
    const matrix = placeData(grid, spec.size, codewords, mask)
    // Format bits are function modules; stamp them onto the boolean matrix.
    const stamped: Cell[][] = matrix.map((row) => row.map((cell) => cell as Cell))
    writeFormat(stamped, spec.size, mask)
    const final = stamped.map((row) => row.map((cell) => cell === true))
    const score = penalty(final)
    if (score < bestScore) {
      bestScore = score
      best = final
    }
  }
  return best!
}

// Renders for a dark terminal: light modules become white blocks, dark
// modules stay as the (dark) background. Two matrix rows per text line
// via half blocks, with the spec's 4-module quiet zone.
export function qrToTerminal(matrix: boolean[][]): string {
  const quiet = 4
  const size = matrix.length
  const total = size + quiet * 2
  const isDark = (r: number, c: number): boolean => {
    const row = r - quiet
    const col = c - quiet
    if (row < 0 || col < 0 || row >= size || col >= size) return false
    return matrix[row][col]
  }
  const lines: string[] = []
  for (let r = 0; r < total; r += 2) {
    let line = ''
    for (let c = 0; c < total; c++) {
      const topLight = !isDark(r, c)
      const bottomLight = r + 1 < total ? !isDark(r + 1, c) : false
      line += topLight ? (bottomLight ? '█' : '▀') : bottomLight ? '▄' : ' '
    }
    lines.push(line)
  }
  return lines.join('\n')
}
