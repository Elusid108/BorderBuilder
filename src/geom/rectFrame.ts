import { deriveSizes, effectiveSight, validateParams } from './derived.ts'
import { sweepMiteredProfile } from './miterSweep.ts'
import { sweepOffsetLoft } from './offsetLoft.ts'
import { buildProfile } from './profiles.ts'
import { isRadiusShape, type FrameParams, type Mesh, type PlanVertex } from './types.ts'

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

/** Regular n-gon with circumradius `radius`. `rotation` radians added to each vertex angle. */
export function regularPolygonSight(sides: number, radius: number, rotation = 0): PlanVertex[] {
  const n = Math.max(3, Math.floor(sides))
  const out: PlanVertex[] = []
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * Math.PI * 2
    out.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) })
  }
  return out
}

export function circleSight(radius: number, n = 96): PlanVertex[] {
  return regularPolygonSight(n, radius)
}

/**
 * Build a watertight preset frame: rectangle, hex, oct (miters) or circle (offset loft).
 */
export function buildPresetFrame(params: FrameParams): Mesh {
  const issues = validateParams(params)
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join(' '))
  }
  const profile = buildProfile(params)
  if (params.shape === 'hexagon') {
    return sweepMiteredProfile(regularPolygonSight(6, params.sightWidth, 0), profile)
  }
  if (params.shape === 'octagon') {
    return sweepMiteredProfile(regularPolygonSight(8, params.sightWidth, Math.PI / 8), profile)
  }
  if (params.shape === 'circle') {
    return sweepOffsetLoft(circleSight(params.sightWidth), profile)
  }
  const { width, height } = effectiveSight(params)
  return sweepMiteredProfile(rectangleSightPolygon(width, height), profile)
}

/** @deprecated Use buildPresetFrame */
export function buildRectFrame(params: FrameParams): Mesh {
  return buildPresetFrame(params)
}

export function frameSummary(params: FrameParams): string {
  const d = deriveSizes(params)
  if (isRadiusShape(params.shape)) {
    return `${params.shape} r${params.sightWidth} mm, ${d.outerWidth}×${d.outerHeight} mm outer, ${params.profile}`
  }
  const { width, height } = effectiveSight(params)
  return `${width}×${height} mm sight, ${d.outerWidth}×${d.outerHeight} mm outer, ${params.profile}`
}
