import type { Mesh, PlanVertex, ProfilePoint, Triangle, Vec3 } from './types.ts'

function sub(a: PlanVertex, b: PlanVertex): PlanVertex {
  return { x: a.x - b.x, y: a.y - b.y }
}

function hypot(v: PlanVertex): number {
  return Math.hypot(v.x, v.y)
}

/** Unit outward normal for a CCW plan polygon edge a→b. */
export function outwardNormal(a: PlanVertex, b: PlanVertex): PlanVertex {
  const d = sub(b, a)
  const len = hypot(d)
  if (len < 1e-12) return { x: 0, y: 0 }
  return { x: d.y / len, y: -d.x / len }
}

/**
 * Offset a vertex by distance `u` along the miter (intersection of two
 * parallel offsets). Works for rectangles now; later phases reuse this for
 * regular n-gons. Organic paths should use parallel-transport instead.
 */
export function miterOffset(
  prev: PlanVertex,
  curr: PlanVertex,
  next: PlanVertex,
  u: number,
): PlanVertex {
  const n1 = outwardNormal(prev, curr)
  const n2 = outwardNormal(curr, next)
  const dot = n1.x * n2.x + n1.y * n2.y
  const denom = 1 + dot
  if (Math.abs(denom) < 1e-8) {
    return { x: curr.x + n1.x * u, y: curr.y + n1.y * u }
  }
  return {
    x: curr.x + (u * (n1.x + n2.x)) / denom,
    y: curr.y + (u * (n1.y + n2.y)) / denom,
  }
}

function place(vertex: PlanVertex, point: ProfilePoint): Vec3 {
  return { x: vertex.x, y: vertex.y, z: point.v }
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

/**
 * Sweep a closed (u, v) profile around a CCW plan polygon with true miters.
 * Adjacent sides share miter-plane vertices, so the result is a single solid
 * without end caps.
 */
export function sweepMiteredProfile(inner: PlanVertex[], profile: ProfilePoint[]): Mesh {
  if (inner.length < 3) throw new Error('Plan outline needs at least 3 vertices.')
  if (profile.length < 3) throw new Error('Profile needs at least 3 points.')

  const n = inner.length
  const m = profile.length
  const triangles: Triangle[] = []

  for (let i = 0; i < n; i++) {
    const prev = inner[(i - 1 + n) % n]
    const curr = inner[i]
    const next = inner[(i + 1) % n]
    const after = inner[(i + 2) % n]
    if (!prev || !curr || !next || !after) continue

    for (let k = 0; k < m; k++) {
      const p0 = profile[k]
      const p1 = profile[(k + 1) % m]
      if (!p0 || !p1) continue
      const a0 = place(miterOffset(prev, curr, next, p0.u), p0)
      const a1 = place(miterOffset(prev, curr, next, p1.u), p1)
      const b0 = place(miterOffset(curr, next, after, p0.u), p0)
      const b1 = place(miterOffset(curr, next, after, p1.u), p1)
      const t1: Triangle = { a: a0, b: b0, c: b1 }
      const t2: Triangle = { a: a0, b: b1, c: a1 }
      if (area2(t1) > 1e-16) triangles.push(t1)
      if (area2(t2) > 1e-16) triangles.push(t2)
    }
  }

  if (signedVolume(triangles) < 0) flip(triangles)
  return { triangles }
}
