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

export type ShapeKind = 'rectangle' | 'hexagon' | 'octagon' | 'circle' | 'imported'

export const RADIUS_SHAPES: readonly ShapeKind[] = ['hexagon', 'octagon', 'circle']

export function isRadiusShape(shape: ShapeKind): boolean {
  return RADIUS_SHAPES.some((s) => s === shape)
}

export type ProfileGroup = 'simple' | 'concave' | 'convex' | 'scurve' | 'compound'

export type ProfileId =
  | 'flat'
  | 'chamfer'
  | 'reverseChamfer'
  | 'step'
  | 'cove'
  | 'scoop'
  | 'scotia'
  | 'ovolo'
  | 'quarterRound'
  | 'bullnose'
  | 'bead'
  | 'ogee'
  | 'reverseOgee'
  | 'coveBead'
  | 'ogeeFillet'
  | 'gallery'

export interface RabbetStack {
  enabled: boolean
  glass: number
  mat: number
  backing: number
  clearance: number
}

export interface FrameParams {
  shape: ShapeKind
  /** Artwork width (mm), or circumradius for hexagon / octagon / circle. */
  sightWidth: number
  sightHeight: number
  mouldingWidth: number
  mouldingHeight: number
  profile: ProfileId
  /** Flat landing on the glass, measured outward from the sight edge (mm). */
  lipWidth: number
  /** How strongly the decorative face reads, 0 = almost flat, 1 = full. */
  faceDepth: number
  rabbetWidth: number
  rabbetDepth: number
  rabbetStack: RabbetStack
  /** Extra room in the rabbet. Rectangles shrink the glass readout; LithoLab import offsets the pack outline by this gap. */
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
  effectiveLipWidth: number
}

export interface ValidationIssue {
  field: string
  message: string
}

export interface ProfileDef {
  id: ProfileId
  label: string
  description: string
  group: ProfileGroup
}

export const PROFILE_GROUPS: readonly { id: ProfileGroup; label: string }[] = [
  { id: 'simple', label: 'Simple' },
  { id: 'concave', label: 'Concave' },
  { id: 'convex', label: 'Convex' },
  { id: 'scurve', label: 'S-curve' },
  { id: 'compound', label: 'Compound' },
]

export const DEFAULT_PARAMS: FrameParams = {
  shape: 'rectangle',
  sightWidth: 100,
  sightHeight: 150,
  mouldingWidth: 20,
  mouldingHeight: 15,
  profile: 'flat',
  lipWidth: 6,
  faceDepth: 0.7,
  rabbetWidth: 6,
  rabbetDepth: 5,
  rabbetStack: {
    enabled: false,
    glass: 2,
    mat: 1,
    backing: 1.5,
    clearance: 0.5,
  },
  fitClearance: 0.8,
}

export const PROFILE_DEFS: readonly ProfileDef[] = [
  { id: 'flat', label: 'Flat', description: 'Rectangular stock with a back rabbet', group: 'simple' },
  {
    id: 'chamfer',
    label: 'Chamfer',
    description: 'Bevel from the lip down to the outer edge',
    group: 'simple',
  },
  {
    id: 'reverseChamfer',
    label: 'Reverse chamfer',
    description: 'Step down at the lip, then a rising bevel to a tall outer edge',
    group: 'simple',
  },
  {
    id: 'step',
    label: 'Step / plateau',
    description: 'Flat lip, then a square drop to a lower outer shelf',
    group: 'simple',
  },
  { id: 'cove', label: 'Cove', description: 'Gentle concave scoop after the sight lip', group: 'concave' },
  { id: 'scoop', label: 'Deep scoop', description: 'Deeper concave hollow across the face', group: 'concave' },
  { id: 'scotia', label: 'Scotia', description: 'Circular concave quarter after the lip', group: 'concave' },
  { id: 'ovolo', label: 'Ovolo', description: 'Convex quarter-round on the outer corner', group: 'convex' },
  {
    id: 'quarterRound',
    label: 'Quarter-round',
    description: 'Full-span convex quarter from the lip to the outer edge',
    group: 'convex',
  },
  { id: 'bullnose', label: 'Bullnose', description: 'Half-round nose on the outer edge', group: 'convex' },
  { id: 'bead', label: 'Bead', description: 'Raised half-round bead after the lip, then a shelf', group: 'convex' },
  { id: 'ogee', label: 'Ogee', description: 'Cyma recta: convex then concave S-curve', group: 'scurve' },
  {
    id: 'reverseOgee',
    label: 'Reverse ogee',
    description: 'Cyma reversa: drops first, then sweeps back out',
    group: 'scurve',
  },
  {
    id: 'coveBead',
    label: 'Cove + bead',
    description: 'Concave scoop finishing in a small outer bead',
    group: 'compound',
  },
  {
    id: 'ogeeFillet',
    label: 'Ogee + fillet',
    description: 'Ogee face ending in a flat outer fillet',
    group: 'compound',
  },
  {
    id: 'gallery',
    label: 'Gallery',
    description: 'Lip, deep scoop, and an outer ovolo — a classic gallery moulding',
    group: 'compound',
  },
]
