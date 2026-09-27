import type { FrameParams, PlanVertex } from '../geom/types.ts'

export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
  /** When set, `positions` is non-indexed (one xyz per triangle corner) with these creased normals. */
  normals?: Float32Array
}

export interface ImportGeometry {
  sight: PlanVertex[]
  holes: PlanVertex[][]
  packOutline: PlanVertex[]
}

export interface BacklightResult {
  panel: MeshData
  acrylic: MeshData
  led: MeshData
  kickstand: MeshData | null
  buttons: MeshData | null
  /** Score lines as x1 y1 x2 y2 quads, front view. */
  score: Float32Array
  bands: { panel: [number, number]; acrylic: [number, number]; litho: [number, number] }
  acrylicSize: [number, number]
  panelSize: [number, number]
  ledStripLength: number
  scoreLines: number
  buttonCount: number
  kickstandLength: number | null
}

export interface BuildResult {
  issues: string[]
  frame: MeshData | null
  triangleCount: number
  watertight: boolean
  backlight: BacklightResult | null
  warnings: string[]
  ms: number
}

export type WorkerRequest =
  | { type: 'import'; geometry: ImportGeometry | null }
  | { type: 'build'; id: number; params: FrameParams }
  | { type: 'package'; id: number; baseName: string; header: string }
  | { type: 'stl'; id: number; header: string }

export type WorkerResponse =
  | { type: 'built'; id: number; result: BuildResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'package'; id: number; zip: Uint8Array }
  | { type: 'stl'; id: number; stl: ArrayBuffer }
