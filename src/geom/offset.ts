import { extractPolygonsFromScalar } from './maskTrace.ts'
import { largestLoop, polygonBounds, smoothRoutedPath, type PlanLoop } from './plan.ts'
import type { PlanVertex } from './types.ts'

const INF = 1e20
const DEFAULT_CELL_MM = 0.25

export type OffsetOpts = {
  cellSize?: number
  maxGrid?: number
  targetCell?: number
  smoothRouted?: boolean
  spacing?: number
  maxVerts?: number
}

export function rasterizePolygonsBinary(
  set: PlanLoop[],
  width: number,
  height: number,
  originX: number,
  originY: number,
  cellSize: number,
): Uint8Array {
  const out = new Uint8Array(width * height)
  if (set.length === 0) return out
  const edges: Array<{ ax: number; ay: number; bx: number; by: number }> = []
  for (const loop of set) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!
      const b = loop[(i + 1) % loop.length]!
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y })
    }
  }
  const xs: number[] = []
  for (let y = 0; y < height; y++) {
    const yWorld = originY + (y + 0.5) * cellSize
    xs.length = 0
    for (const e of edges) {
      const ay = e.ay
      const by = e.by
      if ((ay <= yWorld && by > yWorld) || (by <= yWorld && ay > yWorld)) {
        const t = (yWorld - ay) / (by - ay)
        xs.push(e.ax + t * (e.bx - e.ax))
      }
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    const row = y * width
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0w = (xs[i]! - originX) / cellSize - 0.5
      const x1w = (xs[i + 1]! - originX) / cellSize - 0.5
      const x0 = Math.max(0, Math.ceil(x0w))
      const x1 = Math.min(width - 1, Math.floor(x1w))
      for (let x = x0; x <= x1; x++) out[row + x] = 1
    }
  }
  return out
}

function edt1d(f: Float64Array, n: number): Float64Array {
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = +INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * (q - v[k]!))
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * (q - v[k]!))
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = +INF
  }
  const D = new Float64Array(n)
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    D[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!
  }
  return D
}

function edtSquaredFromInside(inside: Uint8Array, w: number, h: number): Float64Array {
  const D = new Float64Array(w * h)
  const col = new Float64Array(h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = inside[y * w + x] ? 0 : INF
    const r = edt1d(col, h)
    for (let y = 0; y < h; y++) D[y * w + x] = r[y]!
  }
  const row = new Float64Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = D[y * w + x]!
    const r = edt1d(row, w)
    for (let x = 0; x < w; x++) D[y * w + x] = r[x]!
  }
  return D
}

function chooseGrid(
  spanX: number,
  spanY: number,
  maxGrid: number,
  opts: OffsetOpts,
): { cellSize: number; w: number; h: number } {
  const minCellFromGrid = Math.max(spanX, spanY) / maxGrid
  const target = opts.cellSize ?? Math.max(opts.targetCell ?? DEFAULT_CELL_MM, minCellFromGrid)
  let cellSize = target
  let w = Math.ceil(spanX / cellSize)
  let h = Math.ceil(spanY / cellSize)
  if (w > maxGrid || h > maxGrid) {
    cellSize = Math.max(spanX, spanY) / maxGrid
    w = Math.ceil(spanX / cellSize)
    h = Math.ceil(spanY / cellSize)
  }
  return { cellSize, w, h }
}

function levelOutward(distSq: Float64Array, dCells: number): Float64Array {
  const level = new Float64Array(distSq.length)
  for (let i = 0; i < distSq.length; i++) {
    const d = distSq[i]!
    level[i] = d >= INF * 0.5 ? dCells + 8 : Math.sqrt(d) - dCells
  }
  return level
}

function toWorldAndSmooth(
  gridPolys: PlanLoop[],
  ox: number,
  oy: number,
  cellSize: number,
  opts: OffsetOpts,
): PlanLoop[] {
  const world = gridPolys.map((loop) => loop.map((p) => ({ x: ox + p.x * cellSize, y: oy + p.y * cellSize })))
  if (opts.smoothRouted === false) return world
  const spacing = opts.spacing ?? 0.35
  const maxVerts = opts.maxVerts ?? 800
  return world.map((loop) => smoothRoutedPath(loop, spacing, maxVerts))
}

function extractOutwardIso(
  distSq: Float64Array,
  w: number,
  h: number,
  dCells: number,
  ox: number,
  oy: number,
  cellSize: number,
  opts: OffsetOpts,
): PlanLoop[] {
  const gridPolys = extractPolygonsFromScalar(levelOutward(distSq, dCells), w, h)
  return toWorldAndSmooth(gridPolys, ox, oy, cellSize, opts)
}

export function offsetPolygonSet(set: PlanLoop[], delta: number, opts: OffsetOpts = {}): PlanLoop[] {
  if (set.length === 0) return set
  if (delta === 0) return set

  const inward = delta < 0
  const absDelta = Math.abs(delta)
  const b = polygonBounds(set)
  const pad = absDelta * 1.25 + 4
  const spanX = b.maxX - b.minX + 2 * pad
  const spanY = b.maxY - b.minY + 2 * pad
  const maxGrid = opts.maxGrid ?? 2048
  const { cellSize, w, h } = chooseGrid(spanX, spanY, maxGrid, opts)
  const ox = b.minX - pad
  const oy = b.minY - pad
  const inside = rasterizePolygonsBinary(set, w, h, ox, oy, cellSize)
  const dCells = absDelta / cellSize

  if (inward) {
    const outside = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) outside[i] = inside[i] ? 0 : 1
    const distSq = edtSquaredFromInside(outside, w, h)
    const level = new Float64Array(w * h)
    for (let i = 0; i < w * h; i++) {
      if (!inside[i]) {
        level[i] = 1
        continue
      }
      const d = distSq[i]!
      level[i] = d >= INF * 0.5 ? 1 : dCells - Math.sqrt(d)
    }
    return toWorldAndSmooth(extractPolygonsFromScalar(level, w, h), ox, oy, cellSize, opts)
  }

  const distSq = edtSquaredFromInside(inside, w, h)
  return extractOutwardIso(distSq, w, h, dCells, ox, oy, cellSize, opts)
}

/** Outward (positive) or inward disk offset of a single loop. Largest result loop, or null if empty. */
export function offsetLoop(poly: PlanVertex[], delta: number, opts: OffsetOpts = {}): PlanVertex[] | null {
  if (Math.abs(delta) < 1e-9) return poly
  const loops = offsetPolygonSet([poly], delta, opts)
  return largestLoop(loops)
}

/**
 * One raster + EDT, then an isosurface at each positive delta.
 * Shared grid keeps ring quality consistent across the moulding profile.
 */
export function offsetLoopAtDeltas(
  poly: PlanVertex[],
  deltas: number[],
  opts: OffsetOpts = {},
): Map<number, PlanVertex[] | null> {
  const out = new Map<number, PlanVertex[] | null>()
  const positive = [...new Set(deltas.filter((d) => d > 1e-9))].sort((a, b) => a - b)
  if (positive.length === 0) return out

  const b = polygonBounds([poly])
  const maxDelta = positive[positive.length - 1]!
  const pad = maxDelta * 1.25 + 4
  const spanX = b.maxX - b.minX + 2 * pad
  const spanY = b.maxY - b.minY + 2 * pad
  const maxGrid = opts.maxGrid ?? 2048
  const { cellSize, w, h } = chooseGrid(spanX, spanY, maxGrid, opts)
  const ox = b.minX - pad
  const oy = b.minY - pad
  const inside = rasterizePolygonsBinary([poly], w, h, ox, oy, cellSize)
  const distSq = edtSquaredFromInside(inside, w, h)

  for (const delta of positive) {
    const loops = extractOutwardIso(distSq, w, h, delta / cellSize, ox, oy, cellSize, opts)
    out.set(delta, largestLoop(loops))
  }
  return out
}
