import { effectiveSight } from './derived.ts'
import { miterOffset } from './miterSweep.ts'
import { offsetLoop } from './offset.ts'
import { asPolygonCorners, ensureCcw, removeDegen } from './plan.ts'
import { circleSight, rectangleSightPolygon, regularPolygonSight } from './rectFrame.ts'
import type { FrameParams, PlanVertex } from './types.ts'
import { packRing } from '../import/litholabPack.ts'

/** Everything a frame build needs besides the params. */
export interface FrameInput {
  params: FrameParams
  /** Imported mask plate (front opening). */
  sight?: PlanVertex[] | null
  /** Mask holes (letter counters) — left unscored on the acrylic. */
  holes?: PlanVertex[][] | null
  /** LithoLab pack outline (mask + border). */
  packOutline?: PlanVertex[] | null
}

function hasLoop(loop: PlanVertex[] | null | undefined): loop is PlanVertex[] {
  return !!loop && loop.length >= 3
}

/** The front opening (u = 0) as a CCW loop. */
export function sightLoop(input: FrameInput): PlanVertex[] {
  const { params, sight } = input
  if (hasLoop(sight)) return ensureCcw(removeDegen(sight))
  switch (params.shape) {
    case 'hexagon':
      return regularPolygonSight(6, params.sightWidth, 0)
    case 'octagon':
      return regularPolygonSight(8, params.sightWidth, Math.PI / 8)
    case 'circle':
      return circleSight(params.sightWidth, 192)
    default: {
      const { width, height } = effectiveSight(params)
      return rectangleSightPolygon(width, height)
    }
  }
}

function miterRing(corners: PlanVertex[], u: number): PlanVertex[] {
  const n = corners.length
  return corners.map((c, i) => miterOffset(corners[(i - 1 + n) % n]!, c, corners[(i + 1) % n]!, u))
}

/**
 * The plan loop at profile offset `u` — the same family the frame builder uses
 * for its rabbet walls (true miters for polygons, pack parallels for LithoLab
 * imports, disk offsets otherwise).
 */
export function wallRing(input: FrameInput, u: number): PlanVertex[] {
  const { params, sight, packOutline } = input
  if (hasLoop(sight)) {
    const corners = params.shape === 'imported' ? asPolygonCorners(sight) : null
    if (corners) return miterRing(corners, u)
    if (hasLoop(packOutline)) {
      const edge = params.packBorder ?? Math.max(0, params.rabbetWidth - params.fitClearance)
      const delta = u - edge
      if (delta >= 0) return ensureCcw(packRing(packOutline, delta))
    }
    return ensureCcw(offsetLoop(sight, u, { spacing: 0.35 }) ?? sight)
  }
  if (params.shape === 'circle') return circleSight(params.sightWidth + u, 192)
  return miterRing(sightLoop(input), u)
}
