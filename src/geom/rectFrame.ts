import { deriveSizes, effectiveSight, validateParams } from './derived.ts'
import { sweepMiteredProfile } from './miterSweep.ts'
import { buildProfile } from './profiles.ts'
import type { FrameParams, Mesh, PlanVertex } from './types.ts'

export function rectangleSightPolygon(width: number, height: number): PlanVertex[] {
  const hx = width / 2
  const hy = height / 2
  return [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
    { x: -hx, y: hy },
  ]
}

/**
 * Build a watertight rectangular/square frame: four mitered sides, decorative
 * face from the profile preset, rabbet notch on the back-inner corner.
 */
export function buildRectFrame(params: FrameParams): Mesh {
  const issues = validateParams(params)
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join(' '))
  }
  const { width, height } = effectiveSight(params)
  const profile = buildProfile(params)
  return sweepMiteredProfile(rectangleSightPolygon(width, height), profile)
}

export function frameSummary(params: FrameParams): string {
  const { width, height } = effectiveSight(params)
  const d = deriveSizes(params)
  return `${width}×${height} mm sight, ${d.outerWidth}×${d.outerHeight} mm outer, ${params.profile}`
}
