import { inspectIndexed, weld } from './indexed.ts'
import type { Mesh, Vec3 } from './types.ts'

export interface MeshReport {
  triangleCount: number
  bounds: { min: Vec3; max: Vec3 }
  openEdges: number
  nonManifoldEdges: number
  watertight: boolean
}

/** Watertight / bbox report. Welds on 1e-5 mm and ignores collapsed (zero-area) triangles. */
export function inspectMesh(mesh: Mesh): MeshReport {
  const report = inspectIndexed(weld(mesh))
  return { ...report, triangleCount: mesh.triangles.length }
}
