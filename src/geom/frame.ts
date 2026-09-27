import { deriveSizes, validateParams } from './derived.ts'
import { sweepMiteredProfile } from './miterSweep.ts'
import { IMPORTED_LOFT_MAX_VERTS, IMPORTED_LOFT_SPACING, sweepOffsetLoft } from './offsetLoft.ts'
import { asPolygonCorners } from './plan.ts'
import { buildProfile, rabbetWallUs } from './profiles.ts'
import { buildPresetFrame, buildPresetFrameUnchecked, presetOuterLoop, validateImportedOuter } from './rectFrame.ts'
import { packRing, pocketRingFromPack } from '../import/litholabPack.ts'
import { isRadiusShape, type FrameParams, type Mesh, type PlanVertex, type ValidationIssue } from './types.ts'

export { frameSummary } from './rectFrame.ts'

/** Validation for a build (params + imported outer clearance). */
export function frameIssues(params: FrameParams, importedSight?: PlanVertex[] | null): ValidationIssue[] {
  const issues = validateParams(params)
  if (importedSight && importedSight.length >= 3 && params.shape !== 'imported') {
    issues.push(...validateImportedOuter(params, importedSight))
  }
  return issues
}

/** Fill `packBorder` from the rabbet when a pack outline is given without one. */
export function withPackBorder(params: FrameParams, packOutline?: PlanVertex[] | null): FrameParams {
  if (!packOutline || packOutline.length < 3 || params.packBorder != null) return params
  return { ...params, packBorder: Math.max(0, params.rabbetWidth - params.fitClearance) }
}

/**
 * Build a frame from the current params and optional imported sight / pack outline.
 * With a pack outline, every rabbet wall (lithophane, acrylic, back panel) follows
 * a parallel of that outline.
 */
export function buildFrame(
  params: FrameParams,
  importedSight?: PlanVertex[] | null,
  packOutline?: PlanVertex[] | null,
  opts: { skipValidation?: boolean } = {},
): Mesh {
  params = withPackBorder(params, packOutline)
  if (!opts.skipValidation) {
    const issues = frameIssues(params, importedSight)
    if (issues.length > 0) throw new Error(issues.map((i) => i.message).join(' '))
  }
  if (importedSight && importedSight.length >= 3) {
    const profile = buildProfile(params)
    const outerRing = params.shape === 'imported' ? undefined : presetOuterLoop(params)
    const corners = asPolygonCorners(importedSight)
    if (corners && !outerRing) return sweepMiteredProfile(corners, profile)
    const hasPack = !!(packOutline && packOutline.length >= 3)
    const forcedRings = hasPack
      ? rabbetWallUs(params).map((w, i) => ({
          u: w.u,
          // The lithophane step keeps the 0.8 mm import floor.
          ring: i === 0 ? pocketRingFromPack(packOutline!, w.packDelta) : packRing(packOutline!, w.packDelta),
        }))
      : undefined
    const litho = hasPack || !!outerRing
    return sweepOffsetLoft(importedSight, profile, {
      forcedRings,
      outerRing,
      spacing: litho ? IMPORTED_LOFT_SPACING : undefined,
      maxVerts: litho ? IMPORTED_LOFT_MAX_VERTS : undefined,
      keepPlateVerts: litho,
    })
  }
  if (!opts.skipValidation) return buildPresetFrame(params)
  return buildPresetFrameUnchecked(params)
}

function fmt(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

export function importedFrameSummary(params: FrameParams, packName: string): string {
  const d = deriveSizes(params, { geometricOuter: params.shape !== 'imported' })
  if (params.shape !== 'imported') {
    if (isRadiusShape(params.shape)) {
      return `${packName}: imported opening, ${params.shape} r${fmt(params.sightWidth)} mm outer, ${params.profile}`
    }
    return `${packName}: imported opening, ${fmt(params.sightWidth)}×${fmt(params.sightHeight)} mm outer, ${params.profile}`
  }
  return `${packName}: ${fmt(params.sightWidth)}×${fmt(params.sightHeight)} mm dest, ${fmt(d.outerWidth)}×${fmt(d.outerHeight)} mm outer, ${params.profile}`
}

export function downloadName(params: FrameParams, packName?: string | null): string {
  if (packName) {
    if (params.shape === 'imported') return `border-${packName}-${params.profile}.stl`
    return `border-${packName}-${params.shape}-${params.profile}.stl`
  }
  if (isRadiusShape(params.shape)) {
    return `border-${params.shape}-r${params.sightWidth}-${params.profile}.stl`
  }
  return `border-${params.sightWidth}x${params.sightHeight}-${params.profile}.stl`
}
