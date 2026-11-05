// 生成 iOS apple-touch-icon（180×180 全出血方形 PNG，圆角由 iOS 自行裁切）。
// 零依赖：用 zlib 手写 PNG 编码，4× 超采样做抗锯齿。几何参数与 public/icon.svg 等比（128 → 180）。
// 重跑：node scripts/gen-apple-touch-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'apple-touch-icon.png')
const SIZE = 180
const SS = 4 // 超采样倍数
const N = SIZE * SS

// icon.svg 128 坐标系 → 180：scale = 180/128
const S = SIZE / 128

// 颜色
const BG = [30, 30, 30] // #1e1e1e
const FG = [0, 122, 204] // #007acc

// 圆角矩形符号距离（到边界的带符号距离）
function roundedRectDist(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2
  const hx = w / 2 - r, hy = h / 2 - r
  const qx = Math.abs(px - cx) - hx
  const qy = Math.abs(py - cy) - hy
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

// 线段（胶囊形，对应 stroke-linecap="round"）的距离
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

// 图元表：[type, args..., strokeWidth]（180 坐标系）
const rect = { x: 24 * S, y: 24 * S, w: 80 * S, h: 80 * S, r: 14 * S, sw: 6 * S }
const bars = [
  { x1: 44 * S, y1: 84 * S, x2: 44 * S, y2: 60 * S },
  { x1: 64 * S, y1: 84 * S, x2: 64 * S, y2: 44 * S },
  { x1: 84 * S, y1: 84 * S, x2: 84 * S, y2: 68 * S },
].map((b) => ({ ...b, sw: 8 * S }))

function coverageAt(px, py) {
  let cov = 0
  if (Math.abs(roundedRectDist(px, py, rect.x, rect.y, rect.w, rect.h, rect.r)) <= rect.sw / 2) cov = 1
  for (const b of bars) {
    if (segDist(px, py, b.x1, b.y1, b.x2, b.y2) <= b.sw / 2) cov = 1
  }
  return cov
}

const img = Buffer.alloc(SIZE * SIZE * 3)
for (let Y = 0; Y < SIZE; Y++) {
  for (let X = 0; X < SIZE; X++) {
    let acc = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        acc += coverageAt(X * SS + sx + 0.5, Y * SS + sy + 0.5)
      }
    }
    const cov = acc / (SS * SS)
    const i = (Y * SIZE + X) * 3
    img[i] = Math.round(BG[0] + (FG[0] - BG[0]) * cov)
    img[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * cov)
    img[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * cov)
  }
}

// ---- PNG 编码（IHDR + IDAT + IEND，无辅助块） ----
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // 位深
ihdr[9] = 2 // 真彩色 RGB
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 3 + 1)] = 0 // filter: none
  img.copy(raw, y * (SIZE * 3 + 1) + 1, y * SIZE * 3, (y + 1) * SIZE * 3)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(OUT, png)
console.log(`written: ${OUT} (${png.length} bytes)`)
