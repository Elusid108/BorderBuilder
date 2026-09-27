import { isRadiusShape, type DerivedSizes, type FrameParams, type RabbetStep, type ValidationIssue } from './types.ts'

const MIN_OUTER_WALL = 1.2
/** Depth slack in the acrylic / LED band so the sheet is not clamped against the lithophane. */
export const ACRYLIC_DEPTH_SLACK_MM = 0.3
/** Solid face left in front of the whole back stack. */
export const MIN_FRONT_SKIN_MM = 1.5
/** Turn-button pivot distance outward from the panel rabbet wall. */
export const BUTTON_PIVOT_OFFSET_MM = 4.5
/** Frame material needed around a turn-button pilot hole. */
export const BUTTON_BOSS_RADIUS_MM = 3.2

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function maxLipWidth(mouldingWidth: number): number {
  return Math.max(0, mouldingWidth - MIN_OUTER_WALL)
}

/** Lip actually used on the face (clamped so an outer wall remains). */
export function effectiveLipWidth(params: FrameParams): number {
  return clamp(params.lipWidth, 0, maxLipWidth(params.mouldingWidth))
}

export function stackTotal(params: FrameParams): number {
  const s = params.rabbetStack
  return s.glass + s.mat + s.backing + s.clearance
}

export function effectiveRabbetDepth(params: FrameParams): number {
  return params.rabbetStack.enabled ? stackTotal(params) : params.rabbetDepth
}

/** Outward distance from the sight edge to the lithophane / glass edge. */
export function lithoEdgeU(params: FrameParams): number {
  if (params.packBorder != null) return Math.max(0, params.packBorder)
  return Math.max(0, params.rabbetWidth - Math.max(0, params.fitClearance) / 2)
}

/** Acrylic + LED band depth. */
export function acrylicBandDepth(params: FrameParams): number {
  const b = params.backlight
  return Math.max(b.acrylicThickness, b.ledStripWidth) + ACRYLIC_DEPTH_SLACK_MM
}

/**
 * Rabbet steps front-most first. Without backlight this is the single
 * lithophane / glass rabbet; with it, the acrylic + LED band and the back
 * panel step out behind it.
 */
export function rabbetSteps(params: FrameParams): RabbetStep[] {
  const steps: RabbetStep[] = [{ id: 'litho', u: params.rabbetWidth, depth: effectiveRabbetDepth(params) }]
  const b = params.backlight
  if (!b.enabled) return steps
  const r2 = lithoEdgeU(params) + b.ledGap
  steps.push({ id: 'acrylic', u: r2, depth: acrylicBandDepth(params) })
  steps.push({ id: 'panel', u: r2 + b.panelOverlap, depth: b.panelThickness })
  return steps
}

export function totalRabbetDepth(params: FrameParams): number {
  return rabbetSteps(params).reduce((s, st) => s + st.depth, 0)
}

/** Back-most rabbet wall (the one that opens onto the back face). */
export function backRabbetU(params: FrameParams): number {
  const steps = rabbetSteps(params)
  return steps[steps.length - 1]!.u
}

/** Smallest moulding width that fits the rabbets (and turn-button pilot holes). */
export function minMouldingWidth(params: FrameParams): number {
  const back = backRabbetU(params) + Math.max(0, params.chamfer.rabbetMouth)
  if (params.backlight.enabled && params.backlight.buttonCount > 0) {
    return backRabbetU(params) + BUTTON_PIVOT_OFFSET_MM + BUTTON_BOSS_RADIUS_MM
  }
  return back + MIN_OUTER_WALL
}

/** Smallest moulding height that fits the whole back stack. */
export function minMouldingHeight(params: FrameParams): number {
  return totalRabbetDepth(params) + MIN_FRONT_SKIN_MM
}

export function effectiveSight(params: FrameParams): { width: number; height: number } {
  if (isRadiusShape(params.shape)) {
    const d = 2 * params.sightWidth
    return { width: d, height: d }
  }
  return { width: params.sightWidth, height: params.sightHeight }
}

export function deriveSizes(
  params: FrameParams,
  opts?: { geometricOuter?: boolean; destWidth?: number; destHeight?: number },
): DerivedSizes {
  const { width, height } = effectiveSight(params)
  const mw = params.mouldingWidth
  const rw = params.rabbetWidth
  const clearance = Math.max(0, params.fitClearance)
  const depth = effectiveRabbetDepth(params)
  const steps = rabbetSteps(params)
  const totalDepth = steps.reduce((a, st) => a + st.depth, 0)
  if (opts?.geometricOuter) {
    const outerWidth = isRadiusShape(params.shape) ? 2 * params.sightWidth : params.sightWidth
    const outerHeight = isRadiusShape(params.shape) ? 2 * params.sightWidth : params.sightHeight
    const destW = opts.destWidth ?? width
    const destH = opts.destHeight ?? height
    return {
      outerWidth,
      outerHeight,
      pocketWidth: destW + 2 * rw,
      pocketHeight: destH + 2 * rw,
      glassWidth: destW + 2 * rw - clearance,
      glassHeight: destH + 2 * rw - clearance,
      effectiveRabbetDepth: depth,
      stackTotal: stackTotal(params),
      effectiveLipWidth: effectiveLipWidth(params),
      totalRabbetDepth: totalDepth,
      steps,
    }
  }
  return {
    outerWidth: width + 2 * mw,
    outerHeight: height + 2 * mw,
    pocketWidth: width + 2 * rw,
    pocketHeight: height + 2 * rw,
    glassWidth: width + 2 * rw - clearance,
    glassHeight: height + 2 * rw - clearance,
    effectiveRabbetDepth: depth,
    stackTotal: stackTotal(params),
    effectiveLipWidth: effectiveLipWidth(params),
    totalRabbetDepth: totalDepth,
    steps,
  }
}

export function validateParams(params: FrameParams): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { width, height } = effectiveSight(params)
  const depth = effectiveRabbetDepth(params)

  if (isRadiusShape(params.shape)) {
    if (!(params.sightWidth > 0)) issues.push({ field: 'sightWidth', message: 'Radius must be positive.' })
  } else {
    if (!(width > 0)) issues.push({ field: 'sightWidth', message: 'Artwork width must be positive.' })
    if (!(height > 0)) issues.push({ field: 'sightHeight', message: 'Artwork height must be positive.' })
  }
  if (!(params.mouldingWidth > 0)) {
    issues.push({ field: 'mouldingWidth', message: 'Moulding width must be positive.' })
  }
  if (!(params.mouldingHeight > 0)) {
    issues.push({ field: 'mouldingHeight', message: 'Moulding height must be positive.' })
  }
  if (!(params.rabbetWidth > 0)) {
    issues.push({ field: 'rabbetWidth', message: 'Rabbet width must be positive.' })
  } else if (!params.backlight.enabled && params.rabbetWidth >= params.mouldingWidth) {
    issues.push({
      field: 'rabbetWidth',
      message: 'Rabbet width must be smaller than moulding width.',
    })
  }
  if (!(depth > 0)) {
    issues.push({ field: 'rabbetDepth', message: 'Rabbet depth must be positive.' })
  } else if (!params.backlight.enabled && depth >= params.mouldingHeight) {
    issues.push({
      field: 'rabbetDepth',
      message: 'Rabbet depth must be smaller than moulding height.',
    })
  }
  if (params.fitClearance < 0) {
    issues.push({ field: 'fitClearance', message: 'Fit clearance cannot be negative.' })
  }
  if (params.lipWidth < 0) {
    issues.push({ field: 'lipWidth', message: 'Lip width cannot be negative.' })
  } else if (params.mouldingWidth > 0 && params.lipWidth >= params.mouldingWidth) {
    issues.push({
      field: 'lipWidth',
      message: 'Lip width must be smaller than moulding width.',
    })
  }
  const c = params.chamfer
  for (const [field, value] of [
    ['chamferSight', c.sight],
    ['chamferBackOuter', c.backOuter],
    ['chamferRabbetMouth', c.rabbetMouth],
  ] as const) {
    if (!(value >= 0)) issues.push({ field, message: 'Chamfers cannot be negative.' })
    else if (value > 3) issues.push({ field, message: 'Chamfers are capped at 3 mm.' })
  }
  if (params.backlight.enabled) issues.push(...validateBacklight(params))
  if (params.faceDepth < 0 || params.faceDepth > 1) {
    issues.push({ field: 'faceDepth', message: 'Face depth must be between 0 and 1.' })
  }
  if (params.rabbetStack.enabled) {
    const s = params.rabbetStack
    for (const [field, value] of [
      ['glass', s.glass],
      ['mat', s.mat],
      ['backing', s.backing],
      ['stackClearance', s.clearance],
    ] as const) {
      if (value < 0) issues.push({ field, message: `${field} cannot be negative.` })
    }
  }
  return issues
}

function validateBacklight(params: FrameParams): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const b = params.backlight
  const positive: [string, number, string][] = [
    ['acrylicThickness', b.acrylicThickness, 'Acrylic thickness'],
    ['ledStripWidth', b.ledStripWidth, 'LED strip width'],
    ['ledGap', b.ledGap, 'LED gap'],
    ['scorePitch', b.scorePitch, 'Score pitch'],
    ['panelThickness', b.panelThickness, 'Back panel thickness'],
    ['panelOverlap', b.panelOverlap, 'Back panel overlap'],
    ['wireWidth', b.wireWidth, 'Wire passthrough width'],
    ['wireDepth', b.wireDepth, 'Wire passthrough depth'],
  ]
  for (const [field, value, label] of positive) {
    if (!(value > 0)) issues.push({ field, message: `${label} must be positive.` })
  }
  if (!(b.panelFit >= 0)) issues.push({ field: 'panelFit', message: 'Back panel fit cannot be negative.' })
  if (b.scorePitch > 0 && b.scorePitch < 0.5) {
    issues.push({ field: 'scorePitch', message: 'Score pitch below 0.5 mm melts the acrylic surface.' })
  }
  const steps = rabbetSteps(params)
  const litho = steps[0]!
  const acrylic = steps[1]!
  if (acrylic.u <= litho.u + 0.2) {
    issues.push({
      field: 'ledGap',
      message: 'LED gap must be larger than the lithophane fit clearance so the LED wall steps out behind the lithophane rabbet.',
    })
  }
  if (b.wireDepth <= b.panelOverlap + params.backlight.panelFit) {
    issues.push({
      field: 'wireDepth',
      message: 'Wire passthrough must cut past the panel overlap to reach the LED gap.',
    })
  }
  if (b.kickstand) {
    if (!(b.kickstandTilt >= 5 && b.kickstandTilt <= 35)) {
      issues.push({ field: 'kickstandTilt', message: 'Kickstand tilt must be between 5° and 35°.' })
    }
    if (!(b.kickstandWidth >= 6)) issues.push({ field: 'kickstandWidth', message: 'Kickstand width must be at least 6 mm.' })
    if (!(b.kickstandThickness >= 2.5)) {
      issues.push({ field: 'kickstandThickness', message: 'Kickstand thickness must be at least 2.5 mm.' })
    }
  }
  if (!(Number.isInteger(b.buttonCount) && b.buttonCount >= 0 && b.buttonCount <= 12)) {
    issues.push({ field: 'buttonCount', message: 'Turn-button count must be a whole number from 0 to 12.' })
  }
  if (params.mouldingWidth > 0 && params.mouldingWidth < minMouldingWidth(params)) {
    issues.push({
      field: 'mouldingWidth',
      message: `Moulding width must be at least ${Math.ceil(minMouldingWidth(params) * 10) / 10} mm to fit the backlight rabbets${b.buttonCount > 0 ? ' and turn-buttons' : ''}.`,
    })
  }
  if (params.mouldingHeight > 0 && params.mouldingHeight < minMouldingHeight(params)) {
    issues.push({
      field: 'mouldingHeight',
      message: `Moulding height must be at least ${Math.ceil(minMouldingHeight(params) * 10) / 10} mm to fit the lithophane, acrylic, and back panel.`,
    })
  }
  return issues
}
