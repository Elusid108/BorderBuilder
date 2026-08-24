import { deriveSizes, validateParams } from './derived.ts'
import { sweepMiteredProfile } from './miterSweep.ts'
import { sweepOffsetLoft } from './offsetLoft.ts'
import { asPolygonCorners } from './plan.ts'
import { buildProfile } from './profiles.ts'
import { buildPresetFrame } from './rectFrame.ts'
import { isRadiusShape, type FrameParams, type Mesh, type PlanVertex } from './types.ts'

export { frameSummary } from './rectFrame.ts'

/** Build a frame from the current params and optional imported sight / pack pocket. */
export function buildFrame(
  params: FrameParams,
  importedSight?: PlanVertex[] | null,
  pocketRing?: PlanVertex[] | null,
): Mesh {
  const issues = validateParams(params)
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join(' '))
  }
  if (params.shape === 'imported') {
    if (!importedSight || importedSight.length < 3) {
      throw new Error('Imported pack is missing a usable mask outline.')
    }
    const profile = buildProfile(params)
    const corners = asPolygonCorners(importedSight)
    if (corners) return sweepMiteredProfile(corners, profile)
    return sweepOffsetLoft(importedSight, profile, {
      pocketRing: pocketRing ?? undefined,
      pocketU: params.rabbetWidth,
    })
  }
  return buildPresetFrame(params)
}

function fmt(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

export function importedFrameSummary(params: FrameParams, packName: string): string {
  const d = deriveSizes(params)
  return `${packName}: ${fmt(params.sightWidth)}×${fmt(params.sightHeight)} mm dest, ${fmt(d.outerWidth)}×${fmt(d.outerHeight)} mm outer, ${params.profile}`
}

export function downloadName(params: FrameParams, packName?: string | null): string {
  if (params.shape === 'imported' && packName) {
    return `border-${packName}-${params.profile}.stl`
  }
  if (isRadiusShape(params.shape)) {
    return `border-${params.shape}-r${params.sightWidth}-${params.profile}.stl`
  }
  return `border-${params.sightWidth}x${params.sightHeight}-${params.profile}.stl`
}
