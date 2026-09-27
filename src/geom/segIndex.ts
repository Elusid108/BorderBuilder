import type { PlanVertex } from './types.ts'

/**
 * Uniform-grid index over the edges of a closed loop. Nearest-edge queries
 * expand Chebyshev rings of cells until no unvisited cell can beat the best
 * hit, so a query costs roughly the cells within the answer distance instead
 * of every edge. Ties resolve to the lowest edge index, matching a linear scan.
 */
export class SegmentIndex {
  readonly loop: PlanVertex[]
  readonly n: number
  /** Arc length at the start of each edge. */
  readonly acc: Float64Array
  readonly perim: number
  private readonly cell: number
  private readonly ox: number
  private readonly oy: number
  private readonly w: number
  private readonly h: number
  private readonly start: Int32Array
  private readonly items: Int32Array
  private readonly stamp: Int32Array
  private gen = 0

  constructor(loop: PlanVertex[], opts: { segsPerCell?: number; maxDim?: number } = {}) {
    this.loop = loop
    const n = loop.length
    this.n = n
    this.acc = new Float64Array(n)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let perim = 0
    for (let i = 0; i < n; i++) {
      const a = loop[i]!
      const b = loop[(i + 1) % n]!
      this.acc[i] = perim
      perim += Math.hypot(b.x - a.x, b.y - a.y)
      if (a.x < minX) minX = a.x
      if (a.y < minY) minY = a.y
      if (a.x > maxX) maxX = a.x
      if (a.y > maxY) maxY = a.y
    }
    this.perim = perim
    if (!isFinite(minX)) {
      minX = minY = 0
      maxX = maxY = 1
    }
    const spanX = Math.max(1e-6, maxX - minX)
    const spanY = Math.max(1e-6, maxY - minY)
    const maxDim = opts.maxDim ?? 384
    const avg = n > 0 ? perim / n : 1
    let cell = Math.max(avg * (opts.segsPerCell ?? 32), 1e-3)
    cell = Math.max(cell, spanX / maxDim, spanY / maxDim)
    this.cell = cell
    this.ox = minX
    this.oy = minY
    this.w = Math.max(1, Math.ceil(spanX / cell) + 1)
    this.h = Math.max(1, Math.ceil(spanY / cell) + 1)

    const counts = new Int32Array(this.w * this.h + 1)
    const range = (i: number): [number, number, number, number] => {
      const a = loop[i]!
      const b = loop[(i + 1) % n]!
      const x0 = this.cx(Math.min(a.x, b.x))
      const x1 = this.cx(Math.max(a.x, b.x))
      const y0 = this.cy(Math.min(a.y, b.y))
      const y1 = this.cy(Math.max(a.y, b.y))
      return [x0, x1, y0, y1]
    }
    for (let i = 0; i < n; i++) {
      const [x0, x1, y0, y1] = range(i)
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) counts[y * this.w + x + 1]!++
    }
    for (let c = 1; c < counts.length; c++) counts[c] = counts[c]! + counts[c - 1]!
    this.start = counts
    this.items = new Int32Array(counts[counts.length - 1]!)
    const fill = counts.slice(0, counts.length - 1)
    for (let i = 0; i < n; i++) {
      const [x0, x1, y0, y1] = range(i)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) this.items[fill[y * this.w + x]!++] = i
      }
    }
    this.stamp = new Int32Array(n)
  }

  private cx(x: number): number {
    return Math.min(this.w - 1, Math.max(0, Math.floor((x - this.ox) / this.cell)))
  }

  private cy(y: number): number {
    return Math.min(this.h - 1, Math.max(0, Math.floor((y - this.oy) / this.cell)))
  }

  /**
   * Closest point on the loop. With `outward`, points behind `p` along that
   * direction are skipped (falls back to unfiltered if nothing qualifies).
   */
  nearest(p: PlanVertex, outward?: PlanVertex): { seg: number; t: number; d2: number; s: number } | null {
    if (this.n < 2) return null
    const hit = this.search(p, outward)
    if (!hit && outward) return this.search(p)
    return hit
  }

  distance(p: PlanVertex): number {
    const hit = this.nearest(p)
    return hit ? Math.sqrt(hit.d2) : Infinity
  }

  private search(p: PlanVertex, outward?: PlanVertex): { seg: number; t: number; d2: number; s: number } | null {
    const loop = this.loop
    const n = this.n
    const gen = ++this.gen
    if (gen > 0x3fffffff) {
      this.stamp.fill(0)
      this.gen = 1
    }
    const g = this.gen
    const fx = Math.floor((p.x - this.ox) / this.cell)
    const fy = Math.floor((p.y - this.oy) / this.cell)
    let bestD2 = Infinity
    let bestSeg = -1
    let bestT = 0
    const visit = (x: number, y: number) => {
      const c = y * this.w + x
      const end = this.start[c + 1]!
      for (let k = this.start[c]!; k < end; k++) {
        const i = this.items[k]!
        if (this.stamp[i] === g) continue
        this.stamp[i] = g
        const a = loop[i]!
        const b = loop[(i + 1) % n]!
        const abx = b.x - a.x
        const aby = b.y - a.y
        const len2 = abx * abx + aby * aby
        const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
        const qx = a.x + abx * t
        const qy = a.y + aby * t
        if (outward && (qx - p.x) * outward.x + (qy - p.y) * outward.y < -1e-6) continue
        const d2 = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy)
        if (d2 < bestD2 || (d2 === bestD2 && i < bestSeg)) {
          bestD2 = d2
          bestSeg = i
          bestT = t
        }
      }
    }
    // Chebyshev distance (in cells) from p's cell to the far corner of the grid.
    const maxK = Math.max(Math.abs(fx), Math.abs(fx - (this.w - 1)), Math.abs(fy), Math.abs(fy - (this.h - 1)))
    for (let k = 0; k <= maxK; k++) {
      const x0 = fx - k
      const x1 = fx + k
      const y0 = fy - k
      const y1 = fy + k
      const cx0 = Math.max(0, x0)
      const cx1 = Math.min(this.w - 1, x1)
      if (y0 >= 0 && y0 < this.h) for (let x = cx0; x <= cx1; x++) visit(x, y0)
      if (k > 0 && y1 >= 0 && y1 < this.h) for (let x = cx0; x <= cx1; x++) visit(x, y1)
      const cy0 = Math.max(0, y0 + 1)
      const cy1 = Math.min(this.h - 1, y1 - 1)
      if (x0 >= 0 && x0 < this.w) for (let y = cy0; y <= cy1; y++) visit(x0, y)
      if (k > 0 && x1 >= 0 && x1 < this.w) for (let y = cy0; y <= cy1; y++) visit(x1, y)
      if (bestSeg >= 0) {
        const reach = k * this.cell
        if (bestD2 < reach * reach) break
      }
    }
    if (bestSeg < 0) return null
    const a = loop[bestSeg]!
    const b = loop[(bestSeg + 1) % n]!
    const s = this.acc[bestSeg]! + bestT * Math.hypot(b.x - a.x, b.y - a.y)
    return { seg: bestSeg, t: bestT, d2: bestD2, s }
  }

  /** True when two non-adjacent edges properly cross. */
  selfIntersects(): boolean {
    const loop = this.loop
    const n = this.n
    if (n < 4) return false
    for (let c = 0; c < this.w * this.h; c++) {
      const s0 = this.start[c]!
      const s1 = this.start[c + 1]!
      for (let p = s0; p < s1; p++) {
        const i = this.items[p]!
        for (let q = p + 1; q < s1; q++) {
          const j = this.items[q]!
          const d = Math.abs(i - j)
          if (d <= 1 || d === n - 1) continue
          if (properCross(loop[i]!, loop[(i + 1) % n]!, loop[j]!, loop[(j + 1) % n]!)) return true
        }
      }
    }
    return false
  }
}

function orient(a: PlanVertex, b: PlanVertex, c: PlanVertex): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function properCross(a: PlanVertex, b: PlanVertex, c: PlanVertex, d: PlanVertex): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

const cache = new WeakMap<PlanVertex[], SegmentIndex>()

/** Shared index for a loop array (keyed by identity — callers must not mutate the array afterwards). */
export function segmentIndexFor(loop: PlanVertex[]): SegmentIndex {
  let idx = cache.get(loop)
  if (!idx || idx.n !== loop.length) {
    idx = new SegmentIndex(loop)
    cache.set(loop, idx)
  }
  return idx
}
