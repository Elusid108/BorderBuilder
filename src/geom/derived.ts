import { isRadiusShape, type DerivedSizes, type FrameParams, type ValidationIssue } from './types.ts'

const MIN_OUTER_WALL = 1.2

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
  } else if (params.rabbetWidth >= params.mouldingWidth) {
    issues.push({
      field: 'rabbetWidth',
      message: 'Rabbet width must be smaller than moulding width.',
    })
  }
  if (!(depth > 0)) {
    issues.push({ field: 'rabbetDepth', message: 'Rabbet depth must be positive.' })
  } else if (depth >= params.mouldingHeight) {
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
