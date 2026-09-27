import type { Mesh, Vec3 } from './types.ts'

/** Shared-vertex triangle mesh (millimetres). */
export interface IndexedMesh {
  positions: Float32Array
  indices: Uint32Array
}

const QUANTUM = 1e-5

/**
 * Weld a triangle soup on quantized coordinates (open-addressing hash over
 * integer cells). Triangles that collapse to a repeated vertex are dropped:
 * their two surviving edges cancel each other, so the rest stays closed.
 */
export function weld(mesh: Mesh, quantum = QUANTUM): IndexedMesh {
  const tris = mesh.triangles
  const maxVerts = tris.length * 3
  let cap = 1
  while (cap < maxVerts * 2) cap <<= 1
  const mask = cap - 1
  const slots = new Int32Array(cap).fill(-1)
  const qx = new Int32Array(maxVerts)
  const qy = new Int32Array(maxVerts)
  const qz = new Int32Array(maxVerts)
  const pos = new Float64Array(maxVerts * 3)
  let nv = 0
  const inv = 1 / quantum
  const id = (v: Vec3): number => {
    const x = Math.round(v.x * inv)
    const y = Math.round(v.y * inv)
    const z = Math.round(v.z * inv)
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask
    for (;;) {
      const s = slots[h]!
      if (s < 0) {
        slots[h] = nv
        qx[nv] = x
        qy[nv] = y
        qz[nv] = z
        pos[nv * 3] = v.x
        pos[nv * 3 + 1] = v.y
        pos[nv * 3 + 2] = v.z
        return nv++
      }
      if (qx[s] === x && qy[s] === y && qz[s] === z) return s
      h = (h + 1) & mask
    }
  }
  const idx = new Uint32Array(tris.length * 3)
  let ni = 0
  for (const t of tris) {
    const a = id(t.a)
    const b = id(t.b)
    const c = id(t.c)
    if (a === b || b === c || a === c) continue
    idx[ni++] = a
    idx[ni++] = b
    idx[ni++] = c
  }
  return { positions: new Float32Array(pos.subarray(0, nv * 3)), indices: idx.slice(0, ni) }
}

export function triangleCount(mesh: IndexedMesh): number {
  return mesh.indices.length / 3
}

export interface IndexedReport {
  triangleCount: number
  openEdges: number
  nonManifoldEdges: number
  watertight: boolean
  bounds: { min: Vec3; max: Vec3 }
}

export function inspectIndexed(mesh: IndexedMesh): IndexedReport {
  const nv = mesh.positions.length / 3
  const edges = new Map<number, number>()
  const ix = mesh.indices
  for (let t = 0; t < ix.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ix[t + e]!
      const b = ix[t + ((e + 1) % 3)]!
      const k = a < b ? a * nv + b : b * nv + a
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  let open = 0
  let nonManifold = 0
  for (const c of edges.values()) {
    if (c === 1) open++
    else if (c !== 2) nonManifold++
  }
  return {
    triangleCount: ix.length / 3,
    openEdges: open,
    nonManifoldEdges: nonManifold,
    watertight: open === 0 && nonManifold === 0,
    bounds: indexedBounds(mesh),
  }
}

export function indexedBounds(mesh: IndexedMesh): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  const p = mesh.positions
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!
    const y = p[i + 1]!
    const z = p[i + 2]!
    if (x < min.x) min.x = x
    if (y < min.y) min.y = y
    if (z < min.z) min.z = z
    if (x > max.x) max.x = x
    if (y > max.y) max.y = y
    if (z > max.z) max.z = z
  }
  return { min, max }
}

/** Apply `fn` to every vertex. `flip` reverses winding (for mirroring transforms). */
export function transformIndexed(
  mesh: IndexedMesh,
  fn: (x: number, y: number, z: number) => [number, number, number],
  flip = false,
): IndexedMesh {
  const p = new Float32Array(mesh.positions.length)
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = fn(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!)
    p[i] = x
    p[i + 1] = y
    p[i + 2] = z
  }
  let indices = mesh.indices
  if (flip) {
    indices = new Uint32Array(mesh.indices)
    for (let t = 0; t < indices.length; t += 3) {
      const b = indices[t + 1]!
      indices[t + 1] = indices[t + 2]!
      indices[t + 2] = b
    }
  }
  return { positions: p, indices }
}

/** Expand to a flat xyz-per-corner array (viewer / STL). */
export function toTriangleArray(mesh: IndexedMesh): Float32Array {
  const out = new Float32Array(mesh.indices.length * 3)
  const p = mesh.positions
  for (let k = 0; k < mesh.indices.length; k++) {
    const i = mesh.indices[k]! * 3
    out[k * 3] = p[i]!
    out[k * 3 + 1] = p[i + 1]!
    out[k * 3 + 2] = p[i + 2]!
  }
  return out
}

export function indexedVolume(mesh: IndexedMesh): number {
  const p = mesh.positions
  const ix = mesh.indices
  let acc = 0
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3
    const b = ix[t + 1]! * 3
    const c = ix[t + 2]! * 3
    acc +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) +
      p[a + 1]! * (p[b + 2]! * p[c]! - p[b]! * p[c + 2]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
  }
  return acc / 6
}

/**
 * Non-indexed positions + normals that smooth across edges gentler than
 * `creaseDeg` and stay sharp elsewhere (rabbet steps, chamfers). Area-weighted.
 */
export function creasedNormals(mesh: IndexedMesh, creaseDeg = 35): { positions: Float32Array; normals: Float32Array } {
  const p = mesh.positions
  const ix = mesh.indices
  const nt = ix.length / 3
  const nv = p.length / 3
  const fn = new Float32Array(nt * 3)
  for (let t = 0; t < nt; t++) {
    const a = ix[t * 3]! * 3
    const b = ix[t * 3 + 1]! * 3
    const c = ix[t * 3 + 2]! * 3
    const ux = p[b]! - p[a]!
    const uy = p[b + 1]! - p[a + 1]!
    const uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!
    const vy = p[c + 1]! - p[a + 1]!
    const vz = p[c + 2]! - p[a + 2]!
    // Unnormalised cross product = 2 × area × unit normal.
    fn[t * 3] = uy * vz - uz * vy
    fn[t * 3 + 1] = uz * vx - ux * vz
    fn[t * 3 + 2] = ux * vy - uy * vx
  }
  const start = new Uint32Array(nv + 1)
  for (let k = 0; k < ix.length; k++) start[ix[k]! + 1]!++
  for (let v = 0; v < nv; v++) start[v + 1] = start[v + 1]! + start[v]!
  const fill = start.slice(0, nv)
  const faces = new Uint32Array(ix.length)
  for (let k = 0; k < ix.length; k++) faces[fill[ix[k]!]!++] = (k / 3) | 0
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180)
  const positions = new Float32Array(nt * 9)
  const normals = new Float32Array(nt * 9)
  for (let t = 0; t < nt; t++) {
    const tx = fn[t * 3]!
    const ty = fn[t * 3 + 1]!
    const tz = fn[t * 3 + 2]!
    const tl = Math.hypot(tx, ty, tz) || 1
    for (let e = 0; e < 3; e++) {
      const v = ix[t * 3 + e]!
      let nx = 0
      let ny = 0
      let nz = 0
      for (let k = start[v]!; k < start[v + 1]!; k++) {
        const f = faces[k]!
        const fx = fn[f * 3]!
        const fy = fn[f * 3 + 1]!
        const fz = fn[f * 3 + 2]!
        const fl = Math.hypot(fx, fy, fz) || 1
        if ((fx * tx + fy * ty + fz * tz) / (fl * tl) < cosLimit) continue
        nx += fx
        ny += fy
        nz += fz
      }
      const l = Math.hypot(nx, ny, nz) || 1
      const o = t * 9 + e * 3
      positions[o] = p[v * 3]!
      positions[o + 1] = p[v * 3 + 1]!
      positions[o + 2] = p[v * 3 + 2]!
      normals[o] = nx / l
      normals[o + 1] = ny / l
      normals[o + 2] = nz / l
    }
  }
  return { positions, normals }
}
