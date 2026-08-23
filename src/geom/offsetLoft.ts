import { offsetLoopAtDeltas } from './offset.ts'
import {
  ensureCcw,
  hypot,
  perimeter,
  removeDegen,
  resampleClosedToCount,
  rotateToLandmark,
  sub,
} from './plan.ts'
import type { Mesh, PlanVertex, ProfilePoint, Triangle, Vec3 } from './types.ts'

function place(p: PlanVertex, v: number): Vec3 {
  return { x: p.x, y: p.y, z: v }
}

function signedVolume(triangles: Triangle[]): number {
  let acc = 0
  for (const t of triangles) {
    acc +=
      t.a.x * (t.b.y * t.c.z - t.b.z * t.c.y) +
      t.a.y * (t.b.z * t.c.x - t.b.x * t.c.z) +
      t.a.z * (t.b.x * t.c.y - t.b.y * t.c.x)
  }
  return acc / 6
}

function flip(triangles: Triangle[]): void {
  for (const t of triangles) {
    const tmp = t.b
    t.b = t.c
    t.c = tmp
  }
}

function area2(t: Triangle): number {
  const ux = t.b.x - t.a.x
  const uy = t.b.y - t.a.y
  const uz = t.b.z - t.a.z
  const vx = t.c.x - t.a.x
  const vy = t.c.y - t.a.y
  const vz = t.c.z - t.a.z
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  return nx * nx + ny * ny + nz * nz
}

function quantizeU(u: number): number {
  return Math.round(u * 100) / 100
}

function alignRing(poly: PlanVertex[], count: number): PlanVertex[] {
  return resampleClosedToCount(rotateToLandmark(ensureCcw(removeDegen(poly))), count)
}

function loopArcLengths(loop: PlanVertex[]): { segs: number[]; perim: number } {
  const segs: number[] = []
  let perim = 0
  for (let i = 0; i < loop.length; i++) {
    const len = hypot(sub(loop[(i + 1) % loop.length]!, loop[i]!))
    segs.push(len)
    perim += len
  }
  return { segs, perim }
}

function pointAtArc(loop: PlanVertex[], segs: number[], perim: number, s: number): PlanVertex {
  let t = ((s % perim) + perim) % perim
  for (let i = 0; i < loop.length; i++) {
    const len = segs[i] ?? 0
    if (t <= len || i === loop.length - 1) {
      const u = len < 1e-12 ? 0 : t / len
      const a = loop[i]!
      const b = loop[(i + 1) % loop.length]!
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
    t -= len
  }
  return loop[0]!
}

function closestArcParam(
  p: PlanVertex,
  loop: PlanVertex[],
  segs: number[],
  outward?: PlanVertex,
): number {
  let bestD = Infinity
  let bestS = 0
  let acc = 0
  const consider = (x: number, y: number, s: number) => {
    if (outward && (x - p.x) * outward.x + (y - p.y) * outward.y < -1e-6) return
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)
    if (d < bestD) {
      bestD = d
      bestS = s
    }
  }
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % loop.length]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
    consider(a.x + abx * t, a.y + aby * t, acc + t * (segs[i] ?? 0))
    acc += segs[i] ?? 0
  }
  if (!Number.isFinite(bestD) && outward) return closestArcParam(p, loop, segs)
  return bestS
}

function vertexOutward(poly: PlanVertex[], i: number): PlanVertex {
  const n = poly.length
  const a = poly[(i - 1 + n) % n]!
  const c = poly[(i + 1) % n]!
  const ox = c.y - a.y
  const oy = -(c.x - a.x)
  const len = Math.hypot(ox, oy) || 1
  return { x: ox / len, y: oy / len }
}

function closestPointOnLoop(p: PlanVertex, loop: PlanVertex[]): PlanVertex {
  let bestX = loop[0]!.x
  let bestY = loop[0]!.y
  let bestD = Infinity
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % loop.length]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
    const x = a.x + abx * t
    const y = a.y + aby * t
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)
    if (d < bestD) {
      bestD = d
      bestX = x
      bestY = y
    }
  }
  return { x: bestX, y: bestY }
}

/**
 * Pair each inner vertex to the outer ring, then fill large outer-arc gaps
 * (convex tip caps) so the loft keeps the disk-offset silhouette. Inner-only
 * closest-point mapping chords those caps flat.
 */
function mergeWalk(
  inner: PlanVertex[],
  outer: PlanVertex[],
  spacing: number,
): { inner: PlanVertex[]; outer: PlanVertex[] } {
  const loop = ensureCcw(removeDegen(outer))
  if (inner.length < 3 || loop.length < 3) return { inner, outer: inner }
  const { segs, perim } = loopArcLengths(loop)
  if (perim < 1e-9) return { inner, outer: inner }

  const n = inner.length
  const raw = inner.map((p, i) => closestArcParam(p, loop, segs, vertexOutward(inner, i)))
  const unwrapped: number[] = [raw[0]!]
  for (let i = 1; i < n; i++) {
    let s = raw[i]!
    const prev = unwrapped[i - 1]!
    while (s - prev > perim / 2) s -= perim
    while (prev - s > perim / 2) s += perim
    unwrapped.push(s)
  }

  const outInner: PlanVertex[] = []
  const outOuter: PlanVertex[] = []
  const minGap = spacing * 1.5
  for (let i = 0; i < n; i++) {
    outInner.push(inner[i]!)
    outOuter.push(pointAtArc(loop, segs, perim, unwrapped[i]!))
    const t0 = unwrapped[i]!
    const t1 = i + 1 < n ? unwrapped[i + 1]! : unwrapped[0]! + perim
    const gap = t1 - t0
    if (gap <= minGap) continue
    const a = inner[i]!
    const b = inner[(i + 1) % n]!
    const nIns = Math.max(1, Math.round(gap / spacing) - 1)
    for (let k = 1; k <= nIns; k++) {
      const f = k / (nIns + 1)
      outInner.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
      outOuter.push(pointAtArc(loop, segs, perim, t0 + gap * f))
    }
  }
  return { inner: outInner, outer: outOuter }
}

/**
 * Build an organic frame by lofting the moulding profile between robust
 * disk-offsets of the sight outline. Concave corners (heart cleft) fill
 * instead of self-intersecting.
 */
export function sweepOffsetLoft(
  inner: PlanVertex[],
  profile: ProfilePoint[],
  opts: { spacing?: number; maxVerts?: number; maxGrid?: number } = {},
): Mesh {
  if (inner.length < 3) throw new Error('Plan outline needs at least 3 vertices.')
  if (profile.length < 3) throw new Error('Profile needs at least 3 points.')

  const sight = ensureCcw(removeDegen(inner))
  const spacing = opts.spacing ?? 0.35
  const maxU = Math.max(0, ...profile.map((p) => p.u))
  const ringPerim = perimeter(sight) + 2 * Math.PI * maxU
  const count = Math.max(96, Math.min(opts.maxVerts ?? 800, Math.round(ringPerim / spacing)))
  const maxGrid = opts.maxGrid ?? 2048

  const unique = [...new Set(profile.map((p) => quantizeU(p.u)))].sort((a, b) => a - b)
  const cache = new Map<number, PlanVertex[]>()
  let last = alignRing(sight, count)
  cache.set(0, last)

  const rings = offsetLoopAtDeltas(sight, unique, { maxGrid, spacing, maxVerts: count })
  const maxOff = rings.get(quantizeU(maxU))
  if (maxOff && maxOff.length >= 3) {
    const merged = mergeWalk(cache.get(0) ?? last, maxOff, spacing)
    cache.set(0, merged.inner)
    cache.set(quantizeU(maxU), merged.outer)
    last = merged.outer
  }
  for (const u of unique) {
    if (Math.abs(u) < 1e-6) {
      cache.set(u, cache.get(0) ?? last)
      continue
    }
    if (Math.abs(u - maxU) < 1e-6 && cache.has(quantizeU(maxU))) continue
    const off = rings.get(u)
    const src = cache.get(quantizeU(maxU))
    last =
      off && off.length >= 3 && src && src.length >= 3
        ? src.map((p) => closestPointOnLoop(p, off))
        : last
    cache.set(u, last)
  }

  const ringAt = (u: number): PlanVertex[] => {
    const key = quantizeU(u)
    return cache.get(key) ?? cache.get(0) ?? last
  }

  const n = cache.get(0)?.length ?? count
  const m = profile.length
  const triangles: Triangle[] = []

  for (let k = 0; k < m; k++) {
    const p0 = profile[k]!
    const p1 = profile[(k + 1) % m]!
    const r0 = ringAt(p0.u)
    const r1 = ringAt(p1.u)
    const n0 = r0.length
    const n1 = r1.length
    if (n0 < 3 || n1 < 3) continue
    const use = Math.min(n, n0, n1)

    for (let i = 0; i < use; i++) {
      const i1 = (i + 1) % use
      const a0 = place(r0[i]!, p0.v)
      const a1 = place(r1[i]!, p1.v)
      const b0 = place(r0[i1]!, p0.v)
      const b1 = place(r1[i1]!, p1.v)
      const t1: Triangle = { a: a0, b: b0, c: b1 }
      const t2: Triangle = { a: a0, b: b1, c: a1 }
      if (area2(t1) > 1e-16) triangles.push(t1)
      if (area2(t2) > 1e-16) triangles.push(t2)
    }
  }

  if (signedVolume(triangles) < 0) flip(triangles)
  return { triangles }
}
