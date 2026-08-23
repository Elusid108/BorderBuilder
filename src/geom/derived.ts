import type { DerivedSizes, FrameParams, ValidationIssue } from './types.ts'

export function stackTotal(params: FrameParams): number {
  const s = params.rabbetStack
  return s.glass + s.mat + s.backing + s.clearance
}

export function effectiveRabbetDepth(params: FrameParams): number {
  return params.rabbetStack.enabled ? stackTotal(params) : params.rabbetDepth
}

export function effectiveSight(params: FrameParams): { width: number; height: number } {
  const width = params.sightWidth
  const height = params.shape === 'square' ? params.sightWidth : params.sightHeight
  return { width, height }
}

export function deriveSizes(params: FrameParams): DerivedSizes {
  const { width, height } = effectiveSight(params)
  const mw = params.mouldingWidth
  const rw = params.rabbetWidth
  const clearance = Math.max(0, params.fitClearance)
  const depth = effectiveRabbetDepth(params)
  return {
    outerWidth: width + 2 * mw,
    outerHeight: height + 2 * mw,
    pocketWidth: width + 2 * rw,
    pocketHeight: height + 2 * rw,
    glassWidth: width + 2 * rw - clearance,
    glassHeight: height + 2 * rw - clearance,
    effectiveRabbetDepth: depth,
    stackTotal: stackTotal(params),
  }
}

export function validateParams(params: FrameParams): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { width, height } = effectiveSight(params)
  const depth = effectiveRabbetDepth(params)

  if (!(width > 0)) issues.push({ field: 'sightWidth', message: 'Artwork width must be positive.' })
  if (!(height > 0)) issues.push({ field: 'sightHeight', message: 'Artwork height must be positive.' })
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
