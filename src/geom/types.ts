/** Plan-view vertex in millimetres. */
export interface PlanVertex {
  x: number
  y: number
}

/** Moulding cross-section point: u outward from the sight edge, v up from the back. */
export interface ProfilePoint {
  u: number
  v: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Triangle {
  a: Vec3
  b: Vec3
  c: Vec3
}

export interface Mesh {
  triangles: Triangle[]
}

export type ShapeKind = 'rectangle' | 'square'

export type ProfileId = 'flat' | 'cove' | 'ogee' | 'chamfer'

export interface RabbetStack {
  enabled: boolean
  glass: number
  mat: number
  backing: number
  clearance: number
}

export interface FrameParams {
  shape: ShapeKind
  sightWidth: number
  sightHeight: number
  mouldingWidth: number
  mouldingHeight: number
  profile: ProfileId
  rabbetWidth: number
  rabbetDepth: number
  rabbetStack: RabbetStack
  /** Shrinkage applied to the glass-size readout so glass is not press-fit. */
  fitClearance: number
}

export interface DerivedSizes {
  outerWidth: number
  outerHeight: number
  pocketWidth: number
  pocketHeight: number
  glassWidth: number
  glassHeight: number
  effectiveRabbetDepth: number
  stackTotal: number
}

export interface ValidationIssue {
  field: string
  message: string
}

export interface ProfileDef {
  id: ProfileId
  label: string
  description: string
}

export const DEFAULT_PARAMS: FrameParams = {
  shape: 'rectangle',
  sightWidth: 100,
  sightHeight: 150,
  mouldingWidth: 20,
  mouldingHeight: 15,
  profile: 'flat',
  rabbetWidth: 6,
  rabbetDepth: 5,
  rabbetStack: {
    enabled: false,
    glass: 2,
    mat: 1,
    backing: 1.5,
    clearance: 0.5,
  },
  fitClearance: 0.5,
}

export const PROFILE_DEFS: readonly ProfileDef[] = [
  { id: 'flat', label: 'Flat', description: 'Rectangular stock with a back rabbet' },
  { id: 'cove', label: 'Cove', description: 'Concave scoop on the face after the sight lip' },
  { id: 'ogee', label: 'Ogee', description: 'Cyma S-curve on the face' },
  { id: 'chamfer', label: 'Chamfer', description: 'Bevelled face from the lip to the outer edge' },
]
