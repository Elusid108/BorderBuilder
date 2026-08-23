import { deriveSizes, validateParams } from './derived.ts'
import { sweepTransportedProfile } from './pathSweep.ts'
import { buildProfile } from './profiles.ts'
import { buildRectFrame } from './rectFrame.ts'
import type { FrameParams, Mesh, PlanVertex } from './types.ts'

export { frameSummary } from './rectFrame.ts'

/** Build a frame from the current params and optional imported sight polygon. */
export function buildFrame(params: FrameParams, importedSight?: PlanVertex[] | null): Mesh {
  const issues = validateParams(params)
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join(' '))
  }
  if (params.shape === 'imported') {
    if (!importedSight || importedSight.length < 3) {
      throw new Error('Imported pack is missing a usable mask outline.')
    }
    return sweepTransportedProfile(importedSight, buildProfile(params))
  }
  return buildRectFrame(params)
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
  const h = params.shape === 'square' ? params.sightWidth : params.sightHeight
  if (params.shape === 'imported' && packName) {
    return `border-${packName}-${params.profile}.stl`
  }
  return `border-${params.sightWidth}x${h}-${params.profile}.stl`
}
