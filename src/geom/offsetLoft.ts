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

function monotoneArcParams(inner: PlanVertex[], loop: PlanVertex[], spacing: number): number[] | null {
  const { segs, perim } = loopArcLengths(loop)
  if (perim < 1e-9) return null
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

  const minAdvance = Math.max(1e-4, Math.min(spacing * 0.02, perim / (n * 8)))
  for (let i = 1; i < n; i++) {
    if (unwrapped[i]! < unwrapped[i - 1]! + minAdvance) {
      unwrapped[i] = unwrapped[i - 1]! + minAdvance
    }
  }
  const span = unwrapped[n - 1]! - unwrapped[0]!
  const target = perim - minAdvance
  if (span > target && span > 1e-9) {
    const s0 = unwrapped[0]!
    for (let i = 1; i < n; i++) {
      unwrapped[i] = s0 + ((unwrapped[i]! - s0) / span) * target
    }
  }
  return unwrapped
}

function mapOntoLoop(inner: PlanVertex[], outer: PlanVertex[], spacing: number): PlanVertex[] {
  const loop = ensureCcw(removeDegen(outer))
  if (inner.length < 3 || loop.length < 3) return inner
  const params = monotoneArcParams(inner, loop, spacing)
  if (!params) return inner
  const { segs, perim } = loopArcLengths(loop)
  return params.map((s) => pointAtArc(loop, segs, perim, s))
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
  const innerLoop = ensureCcw(removeDegen(inner))
  const loop = ensureCcw(removeDegen(outer))
  if (innerLoop.length < 3 || loop.length < 3) return { inner: innerLoop, outer: innerLoop }
  const unwrapped = monotoneArcParams(innerLoop, loop, spacing)
  if (!unwrapped) return { inner: innerLoop, outer: innerLoop }
  const { segs, perim } = loopArcLengths(loop)
  const innerArc = loopArcLengths(innerLoop)

  const n = innerLoop.length
  const innerS: number[] = [0]
  let acc = 0
  for (let i = 0; i < n - 1; i++) {
    acc += innerArc.segs[i] ?? 0
    innerS.push(acc)
  }

  const outInner: PlanVertex[] = []
  const outOuter: PlanVertex[] = []
  const minGap = spacing * 1.5
  for (let i = 0; i < n; i++) {
    outInner.push(innerLoop[i]!)
    outOuter.push(pointAtArc(loop, segs, perim, unwrapped[i]!))
    const t0 = unwrapped[i]!
    const t1 = i + 1 < n ? unwrapped[i + 1]! : unwrapped[0]! + perim
    const gap = t1 - t0
    if (gap <= minGap) continue
    const sA = innerS[i]!
    const sB = i + 1 < n ? innerS[i + 1]! : innerArc.perim
    const nIns = Math.max(1, Math.round(gap / spacing) - 1)
    for (let k = 1; k <= nIns; k++) {
      const f = k / (nIns + 1)
      outInner.push(pointAtArc(innerLoop, innerArc.segs, innerArc.perim, sA + (sB - sA) * f))
      outOuter.push(pointAtArc(loop, segs, perim, t0 + gap * f))
    }
  }
  return { inner: outInner, outer: outOuter }
}

/**
 * Build an organic frame by lofting the moulding profile between robust
 * disk-offsets of the sight outline. The decorative outer still fills
 * concave clefts. `u = 0` stays on the plate (mask) polyline. When
 * `pocketRing` is set (LithoLab pack + fit), that loop is the back rabbet
 * wall instead of offset(smoothed sight, rabbetWidth).
 */
export function sweepOffsetLoft(
  inner: PlanVertex[],
  profile: ProfilePoint[],
  opts: {
    spacing?: number
    maxVerts?: number
    maxGrid?: number
    pocketRing?: PlanVertex[] | null
    pocketU?: number
  } = {},
): Mesh {
  if (inner.length < 3) throw new Error('Plan outline needs at least 3 vertices.')
  if (profile.length < 3) throw new Error('Profile needs at least 3 points.')

  const sight = ensureCcw(removeDegen(inner))
  const spacing = opts.spacing ?? 0.35
  const maxU = Math.max(0, ...profile.map((p) => p.u))
  const ringPerim = perimeter(sight) + 2 * Math.PI * maxU
  const count = Math.max(96, Math.min(opts.maxVerts ?? 800, Math.round(ringPerim / spacing)))
  const maxGrid = opts.maxGrid ?? 2048
  const pocketU = opts.pocketU != null ? quantizeU(opts.pocketU) : null
  const pocketSrc =
    opts.pocketRing && opts.pocketRing.length >= 3 ? ensureCcw(removeDegen(opts.pocketRing)) : null

  const unique = [...new Set(profile.map((p) => quantizeU(p.u)))].sort((a, b) => a - b)
  const cache = new Map<number, PlanVertex[]>()
  const maskRing = alignRing(sight, count)
  let front = maskRing

  const rings = offsetLoopAtDeltas(sight, unique, { maxGrid, spacing, maxVerts: count })
  const maxKey = quantizeU(maxU)
  const maxOff = rings.get(maxKey)
  if (maxOff && maxOff.length >= 3) {
    const merged = mergeWalk(maskRing, maxOff, spacing)
    front = merged.inner
    cache.set(maxKey, merged.outer)
  }
  if (pocketSrc && pocketU != null && pocketU > 1e-6 && Math.abs(pocketU - maxKey) > 1e-6) {
    const mergedPocket = mergeWalk(front, pocketSrc, spacing)
    cache.set(pocketU, mergedPocket.outer)
    if (mergedPocket.inner.length !== front.length) {
      front = mergedPocket.inner
      if (maxOff && maxOff.length >= 3) {
        cache.set(maxKey, mapOntoLoop(front, maxOff, spacing))
      }
    }
  }
  cache.set(0, front)
  for (const u of unique) {
    if (Math.abs(u) < 1e-6) {
      cache.set(u, front)
      continue
    }
    if (cache.has(u) && cache.get(u)!.length === front.length) continue
    const off = rings.get(u)
    cache.set(u, off && off.length >= 3 ? mapOntoLoop(front, off, spacing) : front)
  }

  const ringAt = (u: number): PlanVertex[] => {
    const key = quantizeU(u)
    return cache.get(key) ?? front
  }

  const n = front.length
  const m = profile.length
  const triangles: Triangle[] = []

  for (let k = 0; k < m; k++) {
    const p0 = profile[k]!
    const p1 = profile[(k + 1) % m]!
    const r0 = ringAt(p0.u)
    const r1 = ringAt(p1.u)
    if (r0.length < 3 || r1.length < 3) continue
    const use = Math.min(n, r0.length, r1.length)

    for (let i = 0; i < use; i++) {
      const i1 = (i + 1) % use
      const a0 = place(r0[i]!, p0.v)
      const a1 = place(r1[i]!, p1.v)
      const b0 = place(r0[i1]!, p0.v)
      const b1 = place(r1[i1]!, p1.v)
      const t1: Triangle = { a: a0, b: b0, c: b1 }
      const t2: Triangle = { a: a0, b: b1, c: a1 }
      // Keep sliver quads — dropping near-zero area faces leaves open edges.
      triangles.push(t1)
      triangles.push(t2)
    }
  }

  if (signedVolume(triangles) < 0) flip(triangles)
  return { triangles }
}
