import { offsetLoopAtDeltas } from './offset.ts'
import {
  ensureCcw,
  perimeter,
  removeDegen,
  resampleClosedToCount,
  rotateToLandmark,
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
  for (const u of unique) {
    if (Math.abs(u) < 1e-6) {
      cache.set(u, cache.get(0) ?? last)
      continue
    }
    const off = rings.get(u)
    last = off && off.length >= 3 ? alignRing(off, count) : last
    cache.set(u, last)
  }

  const ringAt = (u: number): PlanVertex[] => {
    const key = quantizeU(u)
    return cache.get(key) ?? cache.get(0) ?? last
  }

  const n = count
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
