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

export type AcrylicPresetId =
  | 'm4'
  | 'm6'
  | 'm8'
  | 'm10'
  | 'm12'
  | 'in3_16'
  | 'in1_4'
  | 'in5_16'
  | 'in3_8'
  | 'in1_2'
  | 'custom'

export interface AcrylicPreset {
  id: AcrylicPresetId
  label: string
  system: 'metric' | 'sae' | 'custom'
  /** Nominal sheet thickness (mm). */
  thickness: number
  /** LED strip width this sheet pairs with (mm). */
  ledWidth: number
}

/** Standard cast-acrylic sheets closest to 4 / 6 / 8 / 10 / 12 mm LED strips. */
export const ACRYLIC_PRESETS: readonly AcrylicPreset[] = [
  { id: 'm4', label: '4 mm', system: 'metric', thickness: 4, ledWidth: 4 },
  { id: 'm6', label: '6 mm', system: 'metric', thickness: 6, ledWidth: 6 },
  { id: 'm8', label: '8 mm', system: 'metric', thickness: 8, ledWidth: 8 },
  { id: 'm10', label: '10 mm', system: 'metric', thickness: 10, ledWidth: 10 },
  { id: 'm12', label: '12 mm', system: 'metric', thickness: 12, ledWidth: 12 },
  { id: 'in3_16', label: '3/16″ (4.76 mm)', system: 'sae', thickness: 4.7625, ledWidth: 4 },
  { id: 'in1_4', label: '1/4″ (6.35 mm)', system: 'sae', thickness: 6.35, ledWidth: 6 },
  { id: 'in5_16', label: '5/16″ (7.94 mm)', system: 'sae', thickness: 7.9375, ledWidth: 8 },
  { id: 'in3_8', label: '3/8″ (9.53 mm)', system: 'sae', thickness: 9.525, ledWidth: 10 },
  { id: 'in1_2', label: '1/2″ (12.7 mm)', system: 'sae', thickness: 12.7, ledWidth: 12 },
  { id: 'custom', label: 'Custom / measured', system: 'custom', thickness: 6, ledWidth: 6 },
]

export function acrylicPreset(id: AcrylicPresetId): AcrylicPreset {
  return ACRYLIC_PRESETS.find((p) => p.id === id) ?? ACRYLIC_PRESETS[1]!
}

export type ScrewSize = 'M3' | 'M2.5'

/** Edge-lit acrylic + LED strip + printed back panel, stacked behind the lithophane. */
export interface BacklightParams {
  enabled: boolean
  acrylicPreset: AcrylicPresetId
  /** Actual sheet thickness (mm). Presets fill it; measure your sheet and override if needed. */
  acrylicThickness: number
  ledStripWidth: number
  /** Gap between the acrylic edge and the rabbet wall, where the LED strip sits (mm). */
  ledGap: number
  /** Laser score grid pitch (mm). */
  scorePitch: number
  /** Which acrylic face carries the score. `back` mirrors the DXF so the score faces the panel. */
  scoreFace: 'back' | 'front'
  panelThickness: number
  /** How far the back panel reaches past the LED wall onto its shelf (mm). */
  panelOverlap: number
  /** XY clearance between the back panel and its rabbet (mm, per side). */
  panelFit: number
  /** Wire passthrough position: angle around the panel centre, 0 = bottom, 90 = right (seen from the front). */
  wireAngleDeg: number
  wireWidth: number
  /** How far the notch cuts in from the panel edge (mm). */
  wireDepth: number
  kickstand: boolean
  /** Lean back from vertical (degrees). */
  kickstandTilt: number
  kickstandWidth: number
  kickstandThickness: number
  /** Printed turn-buttons that hold the panel; 0 = friction fit. */
  buttonCount: number
  screw: ScrewSize
}

export interface ChamferParams {
  /** Front sight edge (mm). */
  sight: number
  /** Back outer edge — counters elephant's foot when printed back-down (mm). */
  backOuter: number
  /** Mouth of the back-most rabbet — eases insertion and counters elephant's foot (mm). */
  rabbetMouth: number
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
  chamfer: ChamferParams
  backlight: BacklightParams
  /**
   * LithoLab pack border (mask → pack outline) when a pack is imported, else null.
   * Locates the lithophane edge at `u = packBorder`; presets use `rabbetWidth − fit/2`.
   */
  packBorder: number | null
}

/** One rabbet step: wall at `u`, occupying `depth` of the back stack. Front-most first. */
export interface RabbetStep {
  id: 'litho' | 'acrylic' | 'panel'
  u: number
  depth: number
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
  /** Total back stack depth (all rabbet steps). */
  totalRabbetDepth: number
  steps: RabbetStep[]
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
  chamfer: { sight: 0.4, backOuter: 0.4, rabbetMouth: 0.3 },
  backlight: {
    enabled: false,
    acrylicPreset: 'm6',
    acrylicThickness: 6,
    ledStripWidth: 6,
    ledGap: 3,
    scorePitch: 2,
    scoreFace: 'back',
    panelThickness: 3,
    panelOverlap: 4,
    panelFit: 0.3,
    wireAngleDeg: 0,
    wireWidth: 6,
    wireDepth: 8,
    kickstand: true,
    kickstandTilt: 15,
    kickstandWidth: 16,
    kickstandThickness: 4,
    buttonCount: 4,
    screw: 'M3',
  },
  packBorder: null,
}

/** Chamfers off — the v0.6.1 profile. */
export const NO_CHAMFER: ChamferParams = { sight: 0, backOuter: 0, rabbetMouth: 0 }

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
