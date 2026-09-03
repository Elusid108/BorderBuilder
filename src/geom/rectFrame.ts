import { deriveSizes, effectiveSight, validateParams } from './derived.ts'
import { sweepMiteredProfile } from './miterSweep.ts'
import { offsetLoop } from './offset.ts'
import { sweepOffsetLoft } from './offsetLoft.ts'
import { loopBounds, minEdgeDistance, pointInPoly } from './plan.ts'
import { buildProfile } from './profiles.ts'
import { isRadiusShape, type FrameParams, type Mesh, type PlanVertex, type ValidationIssue } from './types.ts'

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

/** Outer loop for an imported lithophane whose frame edge is a preset shape. W/H or radius are the outer size. */
export function presetOuterLoop(params: FrameParams): PlanVertex[] {
  if (params.shape === 'hexagon') return regularPolygonSight(6, params.sightWidth, 0)
  if (params.shape === 'octagon') return regularPolygonSight(8, params.sightWidth, Math.PI / 8)
  if (params.shape === 'circle') return circleSight(params.sightWidth, 192)
  return rectangleSightPolygon(params.sightWidth, params.sightHeight)
}

/** Smallest preset outer that contains plate offset by moulding width. */
export function suggestedImportedOuter(
  plate: PlanVertex[],
  mouldingWidth: number,
  shape: FrameParams['shape'],
): { sightWidth: number; sightHeight: number } {
  const stock =
    offsetLoop(plate, mouldingWidth, { smoothRouted: false, smoothIters: 0, maxGrid: 2048 }) ?? plate
  const pad = 0.4
  let maxR = 0
  let maxX = 0
  let maxY = 0
  for (const p of stock) {
    const r = Math.hypot(p.x, p.y)
    if (r > maxR) maxR = r
    if (Math.abs(p.x) > maxX) maxX = Math.abs(p.x)
    if (Math.abs(p.y) > maxY) maxY = Math.abs(p.y)
  }
  if (shape === 'hexagon') {
    const r = maxR / Math.cos(Math.PI / 6) + pad
    return { sightWidth: r, sightHeight: 2 * r }
  }
  if (shape === 'octagon') {
    const r = maxR / Math.cos(Math.PI / 8) + pad
    return { sightWidth: r, sightHeight: 2 * r }
  }
  if (shape === 'circle') {
    const r = maxR + pad
    return { sightWidth: r, sightHeight: 2 * r }
  }
  const b = loopBounds(stock)
  const w = Math.max(b.maxX - b.minX, 2 * maxX) + pad
  const h = Math.max(b.maxY - b.minY, 2 * maxY) + pad
  return { sightWidth: w, sightHeight: h }
}

export function validateImportedOuter(params: FrameParams, plate: PlanVertex[]): ValidationIssue[] {
  if (params.shape === 'imported' || plate.length < 3) return []
  const outer = presetOuterLoop(params)
  const stock =
    offsetLoop(plate, params.mouldingWidth, { smoothRouted: false, smoothIters: 0, maxGrid: 2048 }) ?? plate
  let outside = 0
  for (const p of stock) {
    if (!pointInPoly(p, outer) && minEdgeDistance(p, outer) > 0.2) outside++
  }
  if (outside > 0) {
    return [
      {
        field: 'sightWidth',
        message: 'Outer shape is too small to clear the lithophane plus moulding width.',
      },
    ]
  }
  return []
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
