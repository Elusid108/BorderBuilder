import type { FrameParams, ProfileId, ProfilePoint } from './types.ts'
import { effectiveRabbetDepth } from './derived.ts'

const CURVE_SEGMENTS = 18

function line(u0: number, v0: number, u1: number, v1: number): ProfilePoint[] {
  return [
    { u: u0, v: v0 },
    { u: u1, v: v1 },
  ]
}

function arc(
  cx: number,
  cy: number,
  radius: number,
  a0: number,
  a1: number,
  segments: number,
): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = a0 + (a1 - a0) * t
    pts.push({ u: cx + radius * Math.cos(a), v: cy + radius * Math.sin(a) })
  }
  return pts
}

function cubic(
  p0: ProfilePoint,
  p1: ProfilePoint,
  p2: ProfilePoint,
  p3: ProfilePoint,
  segments: number,
): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const it = 1 - t
    const a = it * it * it
    const b = 3 * it * it * t
    const c = 3 * it * t * t
    const d = t * t * t
    pts.push({
      u: a * p0.u + b * p1.u + c * p2.u + d * p3.u,
      v: a * p0.v + b * p1.v + c * p2.v + d * p3.v,
    })
  }
  return pts
}

function dedupe(points: ProfilePoint[], eps = 1e-6): ProfilePoint[] {
  const out: ProfilePoint[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.u - last.u, p.v - last.v) > eps) out.push(p)
  }
  if (out.length > 2) {
    const first = out[0]
    const last = out[out.length - 1]
    if (first && last && Math.hypot(first.u - last.u, first.v - last.v) <= eps) out.pop()
  }
  return out
}

function append(target: ProfilePoint[], extra: ProfilePoint[]): void {
  for (const p of extra) target.push(p)
}

function rabbetAndInner(width: number, height: number, rw: number, rd: number): ProfilePoint[] {
  return [
    { u: width, v: 0 },
    { u: rw, v: 0 },
    { u: rw, v: rd },
    { u: 0, v: rd },
    { u: 0, v: height },
  ]
}

function flatFace(width: number, height: number): ProfilePoint[] {
  return line(0, height, width, height)
}

function coveFace(width: number, height: number, rw: number, rd: number): ProfilePoint[] {
  const pts: ProfilePoint[] = [{ u: 0, v: height }]
  const lip = Math.min(rw, width * 0.35)
  pts.push({ u: lip, v: height })
  const face = width - lip
  const sag = Math.min(height - rd - 1, height * 0.38, face * 0.55)
  const midU = lip + face * 0.55
  append(
    pts,
    cubic(
      { u: lip, v: height },
      { u: lip + face * 0.2, v: height },
      { u: midU, v: height - sag },
      { u: width, v: height - sag * 0.45 },
      CURVE_SEGMENTS,
    ),
  )
  return pts
}

function ogeeFace(width: number, height: number, rw: number): ProfilePoint[] {
  const pts: ProfilePoint[] = [{ u: 0, v: height }]
  const lip = Math.min(rw, width * 0.28)
  pts.push({ u: lip, v: height })
  const face = width - lip
  const midV = height * 0.62
  const endV = height * 0.48
  append(
    pts,
    cubic(
      { u: lip, v: height },
      { u: lip + face * 0.28, v: height },
      { u: lip + face * 0.28, v: midV },
      { u: lip + face * 0.5, v: midV },
      Math.ceil(CURVE_SEGMENTS / 2),
    ),
  )
  append(
    pts,
    cubic(
      { u: lip + face * 0.5, v: midV },
      { u: lip + face * 0.72, v: midV },
      { u: lip + face * 0.72, v: endV },
      { u: width, v: endV },
      Math.ceil(CURVE_SEGMENTS / 2),
    ),
  )
  return pts
}

function chamferFace(width: number, height: number, rw: number): ProfilePoint[] {
  const lip = Math.min(rw, width * 0.35)
  const outerTop = height * 0.38
  return [
    { u: 0, v: height },
    { u: lip, v: height },
    { u: width, v: outerTop },
  ]
}

/**
 * Closed moulding cross-section in (u, v):
 * u = 0 at the sight edge, increasing toward the outer edge;
 * v = 0 at the back, increasing toward the front face.
 * The rabbet is the notch at the back-inner corner.
 */
export function buildProfile(params: FrameParams): ProfilePoint[] {
  const w = params.mouldingWidth
  const h = params.mouldingHeight
  const rw = params.rabbetWidth
  const rd = effectiveRabbetDepth(params)
  const face = facePolyline(params.profile, w, h, rw, rd)
  const rest = rabbetAndInner(w, h, rw, rd)
  return dedupe([...face, ...rest])
}

function facePolyline(
  id: ProfileId,
  width: number,
  height: number,
  rw: number,
  rd: number,
): ProfilePoint[] {
  switch (id) {
    case 'cove':
      return coveFace(width, height, rw, rd)
    case 'ogee':
      return ogeeFace(width, height, rw)
    case 'chamfer':
      return chamferFace(width, height, rw)
    case 'flat':
    default:
      return flatFace(width, height)
  }
}

/** Sample a circular bead — kept for later profile-editor experiments. */
export function quarterRound(
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number,
): ProfilePoint[] {
  return arc(cx, cy, radius, start, end, CURVE_SEGMENTS)
}
