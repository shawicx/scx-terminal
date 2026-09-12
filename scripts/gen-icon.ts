// Generates the app icon (1024x1024 PNG) without external image tooling.
// Usage: bun scripts/gen-icon.mjs <output.png>
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SIZE = 1024
const out = process.argv[2] ?? 'src-tauri/icons/icon.png'

// rounded-rect mask
const margin = 64
const radius = 200
function insideRoundedRect (x: number, y: number): boolean {
    const x0 = margin, y0 = margin, x1 = SIZE - margin, y1 = SIZE - margin
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = Math.max(x0 + radius, Math.min(x, x1 - radius))
    const cy = Math.max(y0 + radius, Math.min(y, y1 - radius))
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

// signed distance from point to line segment
function distToSegment (px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    const cx = ax + t * dx, cy = ay + t * dy
    return Math.hypot(px - cx, py - cy)
}

// ">" chevron drawn as two thick segments
function chevron (x: number, y: number): boolean {
    const w = 46
    return distToSegment(x, y, 340, 368, 566, 512) < w ||
        distToSegment(x, y, 340, 656, 566, 512) < w
}

// "_" underscore as a thick horizontal segment
function underscore (x: number, y: number): boolean {
    return distToSegment(x, y, 620, 620, 782, 620) < 44
}

const BG = [0x1a, 0x1b, 0x26]   // dark navy
const FG = [0x7a, 0xa2, 0xf7]   // soft blue

const rows: number[] = []
for (let y = 0; y < SIZE; y++) {
    rows.push(0) // filter byte: none
    for (let x = 0; x < SIZE; x++) {
        let r = 0, g = 0, b = 0, a = 0
        if (insideRoundedRect(x, y)) {
            const glyph = chevron(x, y) || underscore(x, y)
            ;[r, g, b] = glyph ? FG : BG
            a = 255
        }
        rows.push(r, g, b, a)
    }
}

const raw = Buffer.from(rows)
const idat = deflateSync(raw, { level: 9 })

function chunk (type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crcTable: number[] = []
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        crcTable[n] = c >>> 0
    }
    let crc = 0xffffffff
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([len, body, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`icon written: ${out} (${png.length} bytes)`)
