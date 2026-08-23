import {
  decimateClosed,
  ensureCcw,
  largestLoop,
  loopBounds,
  signedArea,
  type PlanLoop,
} from './plan.ts'
import type { PlanVertex } from './types.ts'

/** Pixel buffer, same layout as ImageData (RGBA, row-major). */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

export const MASK_MAX_VERTS = 512

/**
 * Build a binary "inside" grid. RGB masks (white-on-black) use luminance.
 * Images with a real alpha hole (original-masked.png) use alpha only so dark
 * photo pixels stay inside.
 */
export function maskInsideFromImage(img: RgbaImage, threshold = 128): Uint8Array {
  const { width, height, data } = img
  const n = width * height
  let transparent = 0
  for (let p = 0, i = 3; p < n; p++, i += 4) {
    if ((data[i] ?? 0) < 16) transparent++
  }
  const useAlpha = transparent > 0.01 * n
  const inside = new Uint8Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = data[i + 3] ?? 0
    if (a < 16) continue
    if (useAlpha) {
      inside[p] = 1
      continue
    }
    const lum = 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)
    if (lum >= threshold) inside[p] = 1
  }
  return inside
}

const MS_TABLE: Array<Array<[number, number]>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [
    [3, 0],
    [1, 2],
  ],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[2, 0]],
  [
    [0, 1],
    [2, 3],
  ],
  [[2, 1]],
  [[1, 3]],
  [[1, 0]],
  [[0, 3]],
  [],
]

function edgePoint(cx: number, cy: number, edge: number): PlanVertex {
  switch (edge) {
    case 0:
      return { x: cx + 0.5, y: cy }
    case 1:
      return { x: cx + 1, y: cy + 0.5 }
    case 2:
      return { x: cx + 0.5, y: cy + 1 }
    default:
      return { x: cx, y: cy + 0.5 }
  }
}

function vertexKey(p: PlanVertex): string {
  return `${Math.round(p.x * 2)}|${Math.round(p.y * 2)}`
}

function extractPolygonsFromBinary(inside: Uint8Array, w: number, h: number): PlanLoop[] {
  const segHeads = new Map<string, Array<{ to: PlanVertex; toKey: string }>>()
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0
    return inside[y * w + x] ?? 0
  }

  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const code = at(cx, cy) | (at(cx + 1, cy) << 1) | (at(cx + 1, cy + 1) << 2) | (at(cx, cy + 1) << 3)
      const segs = MS_TABLE[code] ?? []
      for (const [a, b] of segs) {
        const pa = edgePoint(cx, cy, a)
        const pb = edgePoint(cx, cy, b)
        const ka = vertexKey(pa)
        const kb = vertexKey(pb)
        let list = segHeads.get(ka)
        if (!list) {
          list = []
          segHeads.set(ka, list)
        }
        list.push({ to: pb, toKey: kb })
      }
    }
  }

  const loops: PlanLoop[] = []
  while (segHeads.size > 0) {
    const startKey = segHeads.keys().next().value as string | undefined
    if (!startKey) break
    const loop: PlanLoop = []
    let key = startKey
    let safety = 1_000_000
    while (safety-- > 0) {
      const choices = segHeads.get(key)
      if (!choices || choices.length === 0) {
        segHeads.delete(key)
        break
      }
      const next = choices.shift()!
      if (choices.length === 0) segHeads.delete(key)
      loop.push(next.to)
      key = next.toKey
      if (key === startKey) break
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

export function smoothChaikin(poly: PlanLoop, iterations: number): PlanLoop {
  if (poly.length < 3 || iterations <= 0) return poly
  let pts = poly
  for (let it = 0; it < iterations; it++) {
    const n = pts.length
    const next: PlanLoop = new Array(n * 2)
    for (let i = 0; i < n; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % n]!
      next[i * 2] = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }
      next[i * 2 + 1] = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }
    }
    pts = next
  }
  return pts
}

export function extractMaskPolygons(
  img: RgbaImage,
  opts: { threshold?: number; smoothIters?: number; minLoopArea?: number } = {},
): PlanLoop[] {
  const threshold = opts.threshold ?? 128
  const smoothIters = opts.smoothIters ?? 3
  const minLoopArea = opts.minLoopArea ?? 6
  const inside = maskInsideFromImage(img, threshold)
  let loops = extractPolygonsFromBinary(inside, img.width, img.height)
  loops = loops.filter((l) => Math.abs(signedArea(l)) >= minLoopArea)
  if (smoothIters > 0) loops = loops.map((l) => smoothChaikin(l, smoothIters))
  return loops
}

export interface TrimmedMask {
  polygon: PlanLoop
  trimW: number
  trimH: number
}

/** Largest loop, shifted so its bbox origin is (0, 0). */
export function trimLargestLoop(loops: PlanLoop[]): TrimmedMask | null {
  const raw = largestLoop(loops)
  if (!raw) return null
  const b = loopBounds(raw)
  const trimW = Math.max(1e-6, b.maxX - b.minX)
  const trimH = Math.max(1e-6, b.maxY - b.minY)
  const polygon = raw.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }))
  return { polygon, trimW, trimH }
}

/**
 * LithoLab dest mapping: stretch the trimmed mask to destW × destH, flip Y
 * into BorderBuilder plan space, and center on the origin.
 */
export function sightFromTrimmed(trim: TrimmedMask, destW: number, destH: number): PlanVertex[] {
  const sx = destW / trim.trimW
  const sy = destH / trim.trimH
  const scaled = trim.polygon.map((p) => ({ x: p.x * sx, y: p.y * sy }))
  return centerFlipY(scaled, destW, destH)
}

/** Trace fallback: polygon already in silhouette-canvas pixels. */
export function sightFromPixelLoops(loops: PlanLoop[], pixelSizeMm: number): PlanVertex[] {
  const trim = trimLargestLoop(loops)
  if (!trim) throw new Error('Could not trace a silhouette from the masked image.')
  const scaled = trim.polygon.map((p) => ({ x: p.x * pixelSizeMm, y: p.y * pixelSizeMm }))
  return centerFlipY(scaled, trim.trimW * pixelSizeMm, trim.trimH * pixelSizeMm)
}

export function centerFlipY(poly: PlanLoop, width: number, height: number): PlanVertex[] {
  const hx = width / 2
  const hy = height / 2
  const flipped = poly.map((p) => ({ x: p.x - hx, y: height - p.y - hy }))
  return decimateClosed(ensureCcw(flipped), MASK_MAX_VERTS)
}

export function sightFromMaskImage(img: RgbaImage, destW: number, destH: number): PlanVertex[] {
  const loops = extractMaskPolygons(img)
  const trim = trimLargestLoop(loops)
  if (!trim) throw new Error('The mask image has no usable silhouette.')
  return sightFromTrimmed(trim, destW, destH)
}
