import { loopBounds } from './plan.ts'
import type { PlanVertex } from './types.ts'

export interface Segment {
  a: PlanVertex
  b: PlanVertex
}

/** Crossings of the horizontal line y = c (or vertical x = c) with every loop edge, sorted. */
function crossings(loops: PlanVertex[][], c: number, vertical: boolean): number[] {
  const xs: number[] = []
  for (const loop of loops) {
    const n = loop.length
    for (let i = 0; i < n; i++) {
      const p = loop[i]!
      const q = loop[(i + 1) % n]!
      const pa = vertical ? p.x : p.y
      const qa = vertical ? q.x : q.y
      if ((pa <= c && qa > c) || (qa <= c && pa > c)) {
        const t = (c - pa) / (qa - pa)
        xs.push(vertical ? p.y + t * (q.y - p.y) : p.x + t * (q.x - p.x))
      }
    }
  }
  return xs.sort((a, b) => a - b)
}

/**
 * Light-guide score grid: horizontal and vertical lines at `pitch`, centred on
 * the region's bounding box and clipped even-odd to `loops` (outer outline plus
 * any holes, which stay unscored).
 */
export function scoreGrid(loops: PlanVertex[][], pitch: number, minLength = 0.3): Segment[] {
  const outer = loops[0]
  if (!outer || outer.length < 3 || !(pitch > 0)) return []
  const b = loopBounds(outer)
  const out: Segment[] = []
  for (const vertical of [false, true]) {
    const lo = vertical ? b.minX : b.minY
    const hi = vertical ? b.maxX : b.maxY
    const mid = (lo + hi) / 2
    const k0 = Math.ceil((lo - mid) / pitch)
    const k1 = Math.floor((hi - mid) / pitch)
    for (let k = k0; k <= k1; k++) {
      // Nudge off exact vertex heights so crossings stay paired.
      const c = mid + k * pitch + 1e-7
      const xs = crossings(loops, c, vertical)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const s0 = xs[i]!
        const s1 = xs[i + 1]!
        if (s1 - s0 < minLength) continue
        out.push(
          vertical
            ? { a: { x: c, y: s0 }, b: { x: c, y: s1 } }
            : { a: { x: s0, y: c }, b: { x: s1, y: c } },
        )
      }
    }
  }
  return out
}
