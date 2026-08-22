import type { Mesh, Triangle, Vec3 } from './types.ts'

function key(v: Vec3, decimals = 5): string {
  return `${v.x.toFixed(decimals)},${v.y.toFixed(decimals)},${v.z.toFixed(decimals)}`
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ka = key(a)
  const kb = key(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

function bounds(mesh: Mesh): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  const consider = (v: Vec3) => {
    min.x = Math.min(min.x, v.x)
    min.y = Math.min(min.y, v.y)
    min.z = Math.min(min.z, v.z)
    max.x = Math.max(max.x, v.x)
    max.y = Math.max(max.y, v.y)
    max.z = Math.max(max.z, v.z)
  }
  for (const t of mesh.triangles) {
    consider(t.a)
    consider(t.b)
    consider(t.c)
  }
  return { min, max }
}

export interface MeshReport {
  triangleCount: number
  bounds: { min: Vec3; max: Vec3 }
  openEdges: number
  nonManifoldEdges: number
  watertight: boolean
}

function verts(t: Triangle): [Vec3, Vec3, Vec3] {
  return [t.a, t.b, t.c]
}

export function inspectMesh(mesh: Mesh): MeshReport {
  const edges = new Map<string, number>()
  for (const t of mesh.triangles) {
    const [a, b, c] = verts(t)
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = edgeKey(p, q)
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  let open = 0
  let nonManifold = 0
  for (const count of edges.values()) {
    if (count === 1) open += 1
    else if (count !== 2) nonManifold += 1
  }
  return {
    triangleCount: mesh.triangles.length,
    bounds: bounds(mesh),
    openEdges: open,
    nonManifoldEdges: nonManifold,
    watertight: open === 0 && nonManifold === 0,
  }
}
