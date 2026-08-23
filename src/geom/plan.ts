import type { PlanVertex } from './types.ts'

export type PlanLoop = PlanVertex[]

export function sub(a: PlanVertex, b: PlanVertex): PlanVertex {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function hypot(v: PlanVertex): number {
  return Math.hypot(v.x, v.y)
}

export function signedArea(poly: PlanLoop): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.y - b.x * a.y
  }
  return s * 0.5
}

export function polygonBounds(set: PlanLoop[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const loop of set) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

export function loopBounds(poly: PlanLoop): { minX: number; minY: number; maxX: number; maxY: number } {
  return polygonBounds([poly])
}

export function ensureCcw(poly: PlanLoop): PlanLoop {
  if (poly.length < 3) return poly
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly
}

export function largestLoop(set: PlanLoop[]): PlanLoop | null {
  let best: PlanLoop | null = null
  let bestArea = 0
  for (const loop of set) {
    if (loop.length < 3) continue
    const area = Math.abs(signedArea(loop))
    if (area > bestArea) {
      bestArea = area
      best = loop
    }
  }
  return best
}

export function decimateClosed(poly: PlanLoop, maxVerts: number): PlanLoop {
  if (poly.length <= maxVerts) return poly
  const n = poly.length
  const out: PlanLoop = new Array(maxVerts)
  for (let i = 0; i < maxVerts; i++) out[i] = poly[Math.floor((i * n) / maxVerts)]!
  return out
}

export function removeDegen(poly: PlanLoop, eps = 1e-9): PlanLoop {
  const out: PlanLoop = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || hypot(sub(p, last)) > eps) out.push(p)
  }
  if (out.length > 1 && hypot(sub(out[0]!, out[out.length - 1]!)) <= eps) out.pop()
  return out
}

const POLYGON_MIN_VERTS = 3
const POLYGON_MAX_VERTS = 12

function perpDist(p: PlanVertex, a: PlanVertex, b: PlanVertex): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return hypot(sub(p, a))
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len
}

function douglasPeuckerOpen(pts: PlanLoop, eps: number): PlanLoop {
  if (pts.length <= 2) return pts.slice()
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  let maxD = -1
  let maxI = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i]!, a, b)
    if (d > maxD) {
      maxD = d
      maxI = i
    }
  }
  if (maxD > eps && maxI > 0) {
    const left = douglasPeuckerOpen(pts.slice(0, maxI + 1), eps)
    const right = douglasPeuckerOpen(pts.slice(maxI), eps)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

/** Closed Douglas–Peucker. Epsilon is millimetres. */
export function simplifyClosed(poly: PlanLoop, epsilon?: number): PlanLoop {
  const clean = removeDegen(poly)
  if (clean.length < 3) return clean
  const eps = epsilon ?? Math.max(0.6, perimeter(clean) * 0.004)
  let maxI = 1
  let maxD = 0
  const first = clean[0]!
  for (let i = 1; i < clean.length; i++) {
    const d = hypot(sub(clean[i]!, first))
    if (d > maxD) {
      maxD = d
      maxI = i
    }
  }
  const chain1 = clean.slice(0, maxI + 1)
  const chain2 = clean.slice(maxI).concat([first])
  const s1 = douglasPeuckerOpen(chain1, eps)
  const s2 = douglasPeuckerOpen(chain2, eps)
  return removeDegen(s1.slice(0, -1).concat(s2.slice(0, -1)))
}

/** Drop vertices whose turning angle is below `minTurnDeg` (collinear stairs). */
export function mergeCollinear(poly: PlanLoop, minTurnDeg = 12): PlanLoop {
  const clean = removeDegen(poly)
  if (clean.length < 3) return clean
  const minTurn = (minTurnDeg * Math.PI) / 180
  const n = clean.length
  const out: PlanLoop = []
  for (let i = 0; i < n; i++) {
    const a = clean[(i - 1 + n) % n]!
    const b = clean[i]!
    const c = clean[(i + 1) % n]!
    const ab = sub(b, a)
    const bc = sub(c, b)
    const lab = hypot(ab)
    const lbc = hypot(bc)
    if (lab < 1e-9 || lbc < 1e-9) continue
    const dot = (ab.x * bc.x + ab.y * bc.y) / (lab * lbc)
    const ang = Math.acos(Math.min(1, Math.max(-1, dot)))
    if (ang >= minTurn) out.push(b)
  }
  return out.length >= 3 ? out : clean
}

function isConvexLoop(poly: PlanLoop): boolean {
  const n = poly.length
  if (n < 3) return false
  const areaSign = Math.sign(signedArea(poly))
  if (areaSign === 0) return false
  let sign = 0
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]!
    const b = poly[i]!
    const c = poly[(i + 1) % n]!
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-12) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return sign === areaSign
}

/**
 * If the outline is a sharp convex polygon (triangle…dodecagon), return the
 * corner vertices. Hearts, darts, and freeform silhouettes return null.
 */
export function asPolygonCorners(poly: PlanLoop): PlanLoop | null {
  const simple = mergeCollinear(simplifyClosed(poly))
  if (simple.length < POLYGON_MIN_VERTS || simple.length > POLYGON_MAX_VERTS) return null
  if (!isConvexLoop(simple)) return null
  return ensureCcw(simple)
}

export function isPolygonalOutline(poly: PlanLoop): boolean {
  return asPolygonCorners(poly) !== null
}

/** Uniform arc-length resample of a closed loop. */
export function perimeter(poly: PlanLoop): number {
  let perim = 0
  for (let i = 0; i < poly.length; i++) {
    perim += hypot(sub(poly[(i + 1) % poly.length]!, poly[i]!))
  }
  return perim
}

export function resampleClosedToCount(poly: PlanLoop, count: number): PlanLoop {
  const clean = removeDegen(poly)
  if (clean.length < 3) return clean
  const n = clean.length
  const targetCount = Math.max(3, Math.floor(count))
  const seg: number[] = new Array(n)
  let perim = 0
  for (let i = 0; i < n; i++) {
    const len = hypot(sub(clean[(i + 1) % n]!, clean[i]!))
    seg[i] = len
    perim += len
  }
  if (perim < 1e-9) return clean

  const out: PlanLoop = []
  let i = 0
  let acc = 0
  for (let k = 0; k < targetCount; k++) {
    const target = (k * perim) / targetCount
    while (acc + (seg[i] ?? 0) < target && i < n - 1) {
      acc += seg[i] ?? 0
      i++
    }
    const len = seg[i] ?? 0
    const t = len < 1e-12 ? 0 : (target - acc) / len
    const a = clean[i]!
    const b = clean[(i + 1) % n]!
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return removeDegen(out)
}

/** Uniform arc-length resample of a closed loop. */
export function resampleClosed(poly: PlanLoop, spacing: number, maxVerts = 512): PlanLoop {
  const clean = removeDegen(poly)
  if (clean.length < 3) return clean
  const perim = perimeter(clean)
  if (perim < 1e-9) return clean
  const count = Math.max(32, Math.min(maxVerts, Math.round(perim / Math.max(spacing, 1e-3))))
  return resampleClosedToCount(clean, count)
}

export function rotateToLandmark(poly: PlanLoop): PlanLoop {
  if (poly.length < 3) return poly
  let start = 0
  for (let i = 1; i < poly.length; i++) {
    const p = poly[i]!
    const s = poly[start]!
    if (p.y < s.y - 1e-9 || (Math.abs(p.y - s.y) < 1e-9 && p.x < s.x)) start = i
  }
  if (start === 0) return poly
  return poly.slice(start).concat(poly.slice(0, start))
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

/** Closed centripetal Catmull-Rom through `a,b,c,d` at parameter t in [0,1] on segment b→c. */
function crPoint(a: PlanVertex, b: PlanVertex, c: PlanVertex, d: PlanVertex, t: number): PlanVertex {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: 0.5 * (2 * b.x + (-a.x + c.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * t3),
    y: 0.5 * (2 * b.y + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * t3),
  }
}

/**
 * Kill pixel jaggies: modest control polygon, Chaikin, Catmull-Rom, dense resample.
 * Keeps overall silhouette (heart cleft) while reading as a routed edge.
 */
export function smoothRoutedPath(poly: PlanLoop, spacing = 0.35, maxVerts = 800): PlanLoop {
  const clean = removeDegen(ensureCcw(poly))
  if (clean.length < 3) return clean
  const controlBudget = Math.min(280, Math.max(160, Math.round(perimeter(clean) / 2.5)))
  const controls = decimateClosed(clean, controlBudget)
  const rounded = smoothChaikin(controls, 4)
  const n = rounded.length
  const spline: PlanLoop = []
  const samplesPerSeg = 6
  for (let i = 0; i < n; i++) {
    const a = rounded[(i - 1 + n) % n]!
    const b = rounded[i]!
    const c = rounded[(i + 1) % n]!
    const d = rounded[(i + 2) % n]!
    for (let s = 0; s < samplesPerSeg; s++) spline.push(crPoint(a, b, c, d, s / samplesPerSeg))
  }
  return resampleClosed(spline, spacing, maxVerts)
}

export function pointInPoly(pt: PlanVertex, poly: PlanLoop): boolean {
  let inside = false
  const n = poly.length
  let j = n - 1
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > pt.y !== b.y > pt.y) {
      const xCross = a.x + ((pt.y - a.y) * (b.x - a.x)) / (b.y - a.y)
      if (pt.x < xCross) inside = !inside
    }
    j = i
  }
  return inside
}

export function minEdgeDistance(pt: PlanVertex, poly: PlanLoop): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2))
    const dx = pt.x - (a.x + abx * t)
    const dy = pt.y - (a.y + aby * t)
    const d = Math.hypot(dx, dy)
    if (d < best) best = d
  }
  return best
}
