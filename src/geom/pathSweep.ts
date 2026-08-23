import { hypot, resampleClosed, sub } from './plan.ts'
import type { Mesh, PlanVertex, ProfilePoint, Triangle, Vec3 } from './types.ts'

function place(x: number, y: number, v: number): Vec3 {
  return { x, y, z: v }
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

function normalize(v: PlanVertex): PlanVertex {
  const len = hypot(v)
  if (len < 1e-12) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

/**
 * Outward unit normals for a CCW loop. Average the two adjacent edge
 * outward normals (bevel) instead of a central-difference tangent — a
 * sharp concave cleft (heart) makes next-prev point across the V, and
 * perp(next-prev) aims inward into the opening.
 */
export function transportedNormals(pts: PlanVertex[]): PlanVertex[] {
  const n = pts.length
  const out: PlanVertex[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!
    const curr = pts[i]!
    const next = pts[(i + 1) % n]!
    const e1 = sub(curr, prev)
    const e2 = sub(next, curr)
    const n1 = normalize({ x: e1.y, y: -e1.x })
    const n2 = normalize({ x: e2.y, y: -e2.x })
    const sum = { x: n1.x + n2.x, y: n1.y + n2.y }
    out[i] = hypot(sum) < 1e-9 ? n1 : normalize(sum)
  }
  return out
}

/**
 * Sweep a closed (u, v) profile along an organic plan path. Offset distance
 * is always |u| along the transported outward normal, so sharp corners
 * (heart cleft, tip) do not produce miter spikes.
 */
export function sweepTransportedProfile(
  inner: PlanVertex[],
  profile: ProfilePoint[],
  opts: { spacing?: number; maxVerts?: number } = {},
): Mesh {
  if (inner.length < 3) throw new Error('Plan outline needs at least 3 vertices.')
  if (profile.length < 3) throw new Error('Profile needs at least 3 points.')

  const samples = resampleClosed(inner, opts.spacing ?? 0.7, opts.maxVerts ?? 480)
  if (samples.length < 3) throw new Error('Plan outline collapsed while resampling.')
  const normals = transportedNormals(samples)
  const n = samples.length
  const m = profile.length
  const triangles: Triangle[] = []

  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n
    const p = samples[i]!
    const q = samples[i1]!
    const np = normals[i]!
    const nq = normals[i1]!

    for (let k = 0; k < m; k++) {
      const p0 = profile[k]!
      const p1 = profile[(k + 1) % m]!
      const a0 = place(p.x + np.x * p0.u, p.y + np.y * p0.u, p0.v)
      const a1 = place(p.x + np.x * p1.u, p.y + np.y * p1.u, p1.v)
      const b0 = place(q.x + nq.x * p0.u, q.y + nq.y * p0.u, p0.v)
      const b1 = place(q.x + nq.x * p1.u, q.y + nq.y * p1.u, p1.v)
      const t1: Triangle = { a: a0, b: b0, c: b1 }
      const t2: Triangle = { a: a0, b: b1, c: a1 }
      if (area2(t1) > 1e-16) triangles.push(t1)
      if (area2(t2) > 1e-16) triangles.push(t2)
    }
  }

  if (signedVolume(triangles) < 0) flip(triangles)
  return { triangles }
}
