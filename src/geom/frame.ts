import { deriveSizes, validateParams } from './derived.ts'
import { sweepMiteredProfile } from './miterSweep.ts'
import { IMPORTED_LOFT_MAX_VERTS, IMPORTED_LOFT_SPACING, sweepOffsetLoft } from './offsetLoft.ts'
import { asPolygonCorners } from './plan.ts'
import { buildProfile } from './profiles.ts'
import { buildPresetFrame, presetOuterLoop, validateImportedOuter } from './rectFrame.ts'
import { isRadiusShape, type FrameParams, type Mesh, type PlanVertex } from './types.ts'

export { frameSummary } from './rectFrame.ts'

/** Build a frame from the current params and optional imported sight / pack pocket. */
export function buildFrame(
  params: FrameParams,
  importedSight?: PlanVertex[] | null,
  pocketRing?: PlanVertex[] | null,
): Mesh {
  const issues = validateParams(params)
  if (importedSight && importedSight.length >= 3 && params.shape !== 'imported') {
    issues.push(...validateImportedOuter(params, importedSight))
  }
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join(' '))
  }
  if (importedSight && importedSight.length >= 3) {
    const profile = buildProfile(params)
    const outerRing = params.shape === 'imported' ? undefined : presetOuterLoop(params)
    const corners = asPolygonCorners(importedSight)
    if (corners && !outerRing) return sweepMiteredProfile(corners, profile)
    const litho = !!(pocketRing && pocketRing.length >= 3) || !!outerRing
    return sweepOffsetLoft(importedSight, profile, {
      pocketRing: pocketRing ?? undefined,
      pocketU: pocketRing && pocketRing.length >= 3 ? params.rabbetWidth : undefined,
      outerRing,
      spacing: litho ? IMPORTED_LOFT_SPACING : undefined,
      maxVerts: litho ? IMPORTED_LOFT_MAX_VERTS : undefined,
      keepPlateVerts: litho,
    })
  }
  return buildPresetFrame(params)
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
