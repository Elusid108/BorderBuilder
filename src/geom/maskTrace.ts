import {
  asPolygonCorners,
  classifyPolygonLoops,
  ensureCcw,
  holesInsideLoop,
  largestLoop,
  polygonBounds,
  signedArea,
  smoothChaikin,
  smoothRoutedPath,
  type PlanLoop,
} from './plan.ts'
import type { PlanVertex } from './types.ts'

/** Pixel buffer, same layout as ImageData (RGBA, row-major). */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

export const MASK_MAX_VERTS = 400

/** LithoLab near-black cutoff: white and mid-gray stay inside; enclosed pure black becomes holes. */
export const NEAR_BLACK_LUM = 32

export interface MaskTrace {
  sight: PlanVertex[]
  holes: PlanVertex[][]
}

/**
 * Build a binary "inside" grid. RGB masks (white-on-black) use luminance.
 * Images with a real alpha hole (original-masked.png) use alpha only so dark
 * photo pixels stay inside.
 */
export function maskInsideFromImage(img: RgbaImage, threshold = NEAR_BLACK_LUM): Uint8Array {
  const { width, height, data } = img
  const n = width * height
  let transparent = 0
  for (let p = 0, i = 3; p < n; p++, i += 4) {
    if ((data[i] ?? 0) < 16) transparent++
  }
  const useAlpha = transparent > 0.01 * n
  const blackCut = Math.min(threshold, NEAR_BLACK_LUM)
  const inside = new Uint8Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = data[i + 3] ?? 0
    if (a < 16) continue
    if (useAlpha) {
      inside[p] = 1
      continue
    }
    const lum = 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)
    if (lum >= blackCut) inside[p] = 1
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

function stitchSegments(segHeads: Map<string, Array<{ to: PlanVertex; toKey: string }>>): PlanLoop[] {
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

function pushSeg(
  segHeads: Map<string, Array<{ to: PlanVertex; toKey: string }>>,
  ka: string,
  pb: PlanVertex,
  kb: string,
): void {
  let list = segHeads.get(ka)
  if (!list) {
    list = []
    segHeads.set(ka, list)
  }
  list.push({ to: pb, toKey: kb })
}

export function extractPolygonsFromBinary(inside: Uint8Array, w: number, h: number): PlanLoop[] {
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
        pushSeg(segHeads, vertexKey(pa), pb, vertexKey(pb))
      }
    }
  }
  return stitchSegments(segHeads)
}

function gridEdgeKey(cx: number, cy: number, edge: number): string {
  switch (edge) {
    case 0:
      return `h:${cx}:${cy}`
    case 1:
      return `v:${cx + 1}:${cy}`
    case 2:
      return `h:${cx}:${cy + 1}`
    default:
      return `v:${cx}:${cy}`
  }
}

function lerpIso(vA: number, vB: number, ax: number, ay: number, bx: number, by: number): PlanVertex {
  const t = Math.abs(vB - vA) < 1e-12 ? 0.5 : (0 - vA) / (vB - vA)
  const u = Math.min(1, Math.max(0, t))
  return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u }
}

function isoEdgePoint(
  cx: number,
  cy: number,
  edge: number,
  v00: number,
  v10: number,
  v11: number,
  v01: number,
): PlanVertex {
  const x0 = cx + 0.5
  const y0 = cy + 0.5
  switch (edge) {
    case 0:
      return lerpIso(v00, v10, x0, y0, x0 + 1, y0)
    case 1:
      return lerpIso(v10, v11, x0 + 1, y0, x0 + 1, y0 + 1)
    case 2:
      return lerpIso(v11, v01, x0 + 1, y0 + 1, x0, y0 + 1)
    default:
      return lerpIso(v00, v01, x0, y0, x0, y0 + 1)
  }
}

/** Marching squares on a scalar field. Values ≤ 0 are inside; crossings are interpolated. */
export function extractPolygonsFromScalar(field: Float64Array, w: number, h: number): PlanLoop[] {
  const segHeads = new Map<string, Array<{ to: PlanVertex; toKey: string }>>()
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 1e6
    return field[y * w + x] ?? 1e6
  }

  for (let cy = -1; cy < h; cy++) {
    for (let cx = -1; cx < w; cx++) {
      const v00 = at(cx, cy)
      const v10 = at(cx + 1, cy)
      const v11 = at(cx + 1, cy + 1)
      const v01 = at(cx, cy + 1)
      const code =
        (v00 <= 0 ? 1 : 0) | (v10 <= 0 ? 2 : 0) | (v11 <= 0 ? 4 : 0) | (v01 <= 0 ? 8 : 0)
      const segs = MS_TABLE[code] ?? []
      for (const [a, b] of segs) {
        const pb = isoEdgePoint(cx, cy, b, v00, v10, v11, v01)
        pushSeg(segHeads, gridEdgeKey(cx, cy, a), pb, gridEdgeKey(cx, cy, b))
      }
    }
  }
  return stitchSegments(segHeads)
}

export function extractMaskPolygons(
  img: RgbaImage,
  opts: { threshold?: number; smoothIters?: number; minLoopArea?: number } = {},
): PlanLoop[] {
  const threshold = opts.threshold ?? NEAR_BLACK_LUM
  const smoothIters = opts.smoothIters ?? 3
  const minLoopArea = opts.minLoopArea ?? 6
  const inside = maskInsideFromImage(img, threshold)
  let loops = extractPolygonsFromBinary(inside, img.width, img.height)
  loops = loops.filter((l) => Math.abs(signedArea(l)) >= minLoopArea)
  if (smoothIters > 0) loops = loops.map((l) => smoothChaikin(l, smoothIters))
  return loops
}

export interface TrimmedMask {
  outers: PlanLoop[]
  holes: PlanLoop[]
  trimW: number
  trimH: number
}

/** All loops, shifted so the combined bbox origin is (0, 0), then classified. */
export function trimMaskLoops(loops: PlanLoop[]): TrimmedMask | null {
  const usable = loops.filter((l) => l.length >= 3)
  if (usable.length === 0) return null
  const b = polygonBounds(usable)
  const trimW = Math.max(1e-6, b.maxX - b.minX)
  const trimH = Math.max(1e-6, b.maxY - b.minY)
  const shifted = usable.map((loop) => loop.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY })))
  const classified = classifyPolygonLoops(shifted)
  if (classified.outers.length === 0) return null
  return { outers: classified.outers, holes: classified.holes, trimW, trimH }
}

function mapLoop(poly: PlanLoop, sx: number, sy: number, destW: number, destH: number): PlanVertex[] {
  const scaled = poly.map((p) => ({ x: p.x * sx, y: p.y * sy }))
  return centerFlipY(scaled, destW, destH)
}

/**
 * LithoLab dest mapping: stretch the trimmed mask to destW × destH, flip Y
 * into BorderBuilder plan space, and center on the origin.
 */
export function traceFromTrimmed(trim: TrimmedMask, destW: number, destH: number): MaskTrace {
  const outer = largestLoop(trim.outers)
  if (!outer) throw new Error('The mask image has no usable silhouette.')
  const sx = destW / trim.trimW
  const sy = destH / trim.trimH
  const nested = holesInsideLoop(outer, trim.holes)
  return {
    sight: mapLoop(outer, sx, sy, destW, destH),
    holes: nested.map((h) => mapLoop(h, sx, sy, destW, destH)),
  }
}

/** Trace fallback: polygons already in silhouette-canvas pixels. */
export function sightFromPixelLoops(loops: PlanLoop[], pixelSizeMm: number): MaskTrace {
  const trim = trimMaskLoops(loops)
  if (!trim) throw new Error('Could not trace a silhouette from the masked image.')
  const destW = trim.trimW * pixelSizeMm
  const destH = trim.trimH * pixelSizeMm
  return traceFromTrimmed(trim, destW, destH)
}

export function centerFlipY(poly: PlanLoop, width: number, height: number): PlanVertex[] {
  const hx = width / 2
  const hy = height / 2
  const flipped = ensureCcw(poly.map((p) => ({ x: p.x - hx, y: height - p.y - hy })))
  const corners = asPolygonCorners(flipped)
  if (corners) return corners
  return smoothRoutedPath(flipped, 0.35, MASK_MAX_VERTS)
}

export function sightFromMaskImage(img: RgbaImage, destW: number, destH: number): MaskTrace {
  const loops = extractMaskPolygons(img, { smoothIters: 0 })
  const trim = trimMaskLoops(loops)
  if (!trim) throw new Error('The mask image has no usable silhouette.')
  return traceFromTrimmed(trim, destW, destH)
}
