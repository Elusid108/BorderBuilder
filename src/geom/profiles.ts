import { effectiveLipWidth, effectiveRabbetDepth } from './derived.ts'
import type { FrameParams, ProfileId, ProfilePoint } from './types.ts'

const CURVE_SEGMENTS = 18

export interface FaceLayout {
  width: number
  height: number
  rw: number
  rd: number
  lip: number
  depth: number
  span: number
  room: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function resolveFaceLayout(params: FrameParams): FaceLayout {
  const width = params.mouldingWidth
  const height = params.mouldingHeight
  const rw = params.rabbetWidth
  const rd = effectiveRabbetDepth(params)
  const lip = effectiveLipWidth(params)
  const depth = clamp(params.faceDepth, 0, 1)
  const span = Math.max(0, width - lip)
  const room = Math.max(0.5, height - rd - 0.8)
  return { width, height, rw, rd, lip, depth, span, room }
}

function drop(layout: FaceLayout, portion: number): number {
  return layout.room * portion * layout.depth
}

function line(u0: number, v0: number, u1: number, v1: number): ProfilePoint[] {
  return [
    { u: u0, v: v0 },
    { u: u1, v: v1 },
  ]
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

function arc(cx: number, cy: number, r: number, a0: number, a1: number, segments: number): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  const n = Math.max(4, segments)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = a0 + (a1 - a0) * t
    pts.push({ u: cx + r * Math.cos(a), v: cy + r * Math.sin(a) })
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

function clampFace(points: ProfilePoint[], layout: FaceLayout): ProfilePoint[] {
  return points.map((p) => ({
    u: clamp(p.u, 0, layout.width),
    v: clamp(p.v, 0, layout.height),
  }))
}

function startLip(layout: FaceLayout): ProfilePoint[] {
  return [
    { u: 0, v: layout.height },
    { u: layout.lip, v: layout.height },
  ]
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

function flatFace(layout: FaceLayout): ProfilePoint[] {
  return line(0, layout.height, layout.width, layout.height)
}

function chamferFace(layout: FaceLayout): ProfilePoint[] {
  const endV = layout.height - drop(layout, 0.62)
  return [...startLip(layout), { u: layout.width, v: endV }]
}

function reverseChamferFace(layout: FaceLayout): ProfilePoint[] {
  const d = drop(layout, 0.55)
  const pts = startLip(layout)
  pts.push({ u: layout.lip, v: layout.height - d })
  pts.push({ u: layout.width, v: layout.height })
  return pts
}

function stepFace(layout: FaceLayout): ProfilePoint[] {
  const shelf = layout.height - drop(layout, 0.5)
  return [...startLip(layout), { u: layout.lip, v: shelf }, { u: layout.width, v: shelf }]
}

function coveFace(layout: FaceLayout, portion = 0.55): ProfilePoint[] {
  const pts = startLip(layout)
  const sag = Math.min(drop(layout, portion), layout.span * 0.7)
  if (sag < 0.4 || layout.span < 0.4) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  const midU = layout.lip + layout.span * 0.55
  append(
    pts,
    cubic(
      { u: layout.lip, v: layout.height },
      { u: layout.lip + layout.span * 0.2, v: layout.height },
      { u: midU, v: layout.height - sag },
      { u: layout.width, v: layout.height - sag * 0.45 },
      CURVE_SEGMENTS,
    ),
  )
  return pts
}

function scoopFace(layout: FaceLayout): ProfilePoint[] {
  return coveFace(layout, 0.92)
}

function scotiaFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  const r = Math.min(layout.span, drop(layout, 0.85))
  if (r < 0.5) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  append(pts, arc(layout.lip + r, layout.height, r, Math.PI, (Math.PI * 3) / 2, CURVE_SEGMENTS))
  if (layout.lip + r < layout.width - 1e-6) {
    pts.push({ u: layout.width, v: layout.height - r })
  }
  return pts
}

function ovoloFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  const r = Math.min(layout.span, drop(layout, 0.7))
  if (r < 0.5) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  const startU = layout.width - r
  if (startU > layout.lip + 1e-6) pts.push({ u: startU, v: layout.height })
  append(pts, arc(layout.width - r, layout.height - r, r, Math.PI / 2, 0, CURVE_SEGMENTS))
  return pts
}

function quarterRoundFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  const r = Math.min(layout.span, drop(layout, 1))
  if (r < 0.5) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  const startU = layout.width - r
  if (startU > layout.lip + 1e-6) pts.push({ u: startU, v: layout.height })
  append(pts, arc(layout.width - r, layout.height - r, r, Math.PI / 2, 0, CURVE_SEGMENTS))
  return pts
}

function bullnoseFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  const r = Math.min(layout.span / 2, drop(layout, 0.7))
  if (r < 0.5) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  const inner = layout.width - 2 * r
  if (inner > layout.lip + 1e-6) pts.push({ u: inner, v: layout.height })
  append(pts, arc(layout.width - r, layout.height, r, Math.PI, Math.PI * 2, CURVE_SEGMENTS))
  return pts
}

function beadFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  const r = Math.min(1.1 + 2.8 * layout.depth, layout.span * 0.22, drop(layout, 0.45))
  if (r < 0.5) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  const shelf = layout.height - r
  pts.push({ u: layout.lip, v: shelf })
  append(pts, arc(layout.lip + r, shelf, r, Math.PI, 0, CURVE_SEGMENTS))
  pts.push({ u: layout.width, v: shelf })
  return pts
}

function ogeeFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  if (layout.span < 0.4 || layout.depth < 0.02) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  const midV = layout.height - drop(layout, 0.38)
  const endV = layout.height - drop(layout, 0.52)
  const midU = layout.lip + layout.span * 0.5
  append(
    pts,
    cubic(
      { u: layout.lip, v: layout.height },
      { u: layout.lip + layout.span * 0.28, v: layout.height },
      { u: layout.lip + layout.span * 0.28, v: midV },
      { u: midU, v: midV },
      Math.ceil(CURVE_SEGMENTS / 2),
    ),
  )
  append(
    pts,
    cubic(
      { u: midU, v: midV },
      { u: layout.lip + layout.span * 0.72, v: midV },
      { u: layout.lip + layout.span * 0.72, v: endV },
      { u: layout.width, v: endV },
      Math.ceil(CURVE_SEGMENTS / 2),
    ),
  )
  return pts
}

function reverseOgeeFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  if (layout.span < 0.4 || layout.depth < 0.02) {
    pts.push({ u: layout.width, v: layout.height })
    return pts
  }
  const midV = layout.height - drop(layout, 0.62)
  const endV = layout.height - drop(layout, 0.28)
  const midU = layout.lip + layout.span * 0.48
  append(
    pts,
    cubic(
      { u: layout.lip, v: layout.height },
      { u: layout.lip + layout.span * 0.18, v: layout.height - drop(layout, 0.2) },
      { u: layout.lip + layout.span * 0.32, v: midV },
      { u: midU, v: midV },
      Math.ceil(CURVE_SEGMENTS / 2),
    ),
  )
  append(
    pts,
    cubic(
      { u: midU, v: midV },
      { u: layout.lip + layout.span * 0.68, v: midV },
      { u: layout.lip + layout.span * 0.78, v: endV },
      { u: layout.width, v: endV },
      Math.ceil(CURVE_SEGMENTS / 2),
    ),
  )
  return pts
}

function coveBeadFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  const beadR = Math.min(1 + 2.4 * layout.depth, layout.span * 0.2, drop(layout, 0.35))
  const coveEndU = layout.width - Math.max(beadR * 2, 0)
  const sag = Math.min(drop(layout, 0.58), Math.max(0.4, coveEndU - layout.lip) * 0.65)
  if (sag < 0.4 || coveEndU <= layout.lip + 0.4) return coveFace(layout)
  append(
    pts,
    cubic(
      { u: layout.lip, v: layout.height },
      { u: layout.lip + (coveEndU - layout.lip) * 0.25, v: layout.height },
      { u: layout.lip + (coveEndU - layout.lip) * 0.6, v: layout.height - sag },
      { u: coveEndU, v: layout.height - sag * 0.35 },
      CURVE_SEGMENTS,
    ),
  )
  if (beadR >= 0.5) {
    const shelf = layout.height - sag * 0.35
    const cy = Math.min(shelf, layout.height - beadR)
    append(pts, arc(layout.width - beadR, cy, beadR, Math.PI, 0, 14))
  } else {
    pts.push({ u: layout.width, v: layout.height - sag * 0.35 })
  }
  return pts
}

function ogeeFilletFace(layout: FaceLayout): ProfilePoint[] {
  const fillet = Math.min(layout.span * 0.22, 4)
  const endU = layout.width - fillet
  const inner: FaceLayout = { ...layout, width: endU, span: Math.max(0, endU - layout.lip) }
  const pts = ogeeFace(inner)
  const last = pts[pts.length - 1]
  const shelf = last?.v ?? layout.height - drop(layout, 0.5)
  pts.push({ u: endU, v: shelf })
  pts.push({ u: layout.width, v: shelf })
  return pts
}

function galleryFace(layout: FaceLayout): ProfilePoint[] {
  const pts = startLip(layout)
  const r = Math.min(layout.span * 0.28, drop(layout, 0.55))
  const scoopW = layout.span - r
  const sag = Math.min(drop(layout, 0.78), scoopW * 0.8)
  if (scoopW < 0.8 || sag < 0.4) return ovoloFace(layout)
  const scoopEnd = layout.lip + scoopW
  append(
    pts,
    cubic(
      { u: layout.lip, v: layout.height },
      { u: layout.lip + scoopW * 0.22, v: layout.height },
      { u: layout.lip + scoopW * 0.55, v: layout.height - sag },
      { u: scoopEnd, v: layout.height - sag * 0.25 },
      CURVE_SEGMENTS,
    ),
  )
  if (r >= 0.5) {
    const cy = Math.min(layout.height - sag * 0.25, layout.height - r)
    append(pts, arc(layout.width - r, cy, r, Math.PI, 0, CURVE_SEGMENTS))
  } else {
    pts.push({ u: layout.width, v: layout.height - sag * 0.25 })
  }
  return pts
}

function facePolyline(id: ProfileId, layout: FaceLayout): ProfilePoint[] {
  switch (id) {
    case 'chamfer':
      return chamferFace(layout)
    case 'reverseChamfer':
      return reverseChamferFace(layout)
    case 'step':
      return stepFace(layout)
    case 'cove':
      return coveFace(layout)
    case 'scoop':
      return scoopFace(layout)
    case 'scotia':
      return scotiaFace(layout)
    case 'ovolo':
      return ovoloFace(layout)
    case 'quarterRound':
      return quarterRoundFace(layout)
    case 'bullnose':
      return bullnoseFace(layout)
    case 'bead':
      return beadFace(layout)
    case 'ogee':
      return ogeeFace(layout)
    case 'reverseOgee':
      return reverseOgeeFace(layout)
    case 'coveBead':
      return coveBeadFace(layout)
    case 'ogeeFillet':
      return ogeeFilletFace(layout)
    case 'gallery':
      return galleryFace(layout)
    case 'flat':
    default:
      return flatFace(layout)
  }
}

/**
 * Closed moulding cross-section in (u, v):
 * u = 0 at the sight edge, increasing toward the outer edge;
 * v = 0 at the back, increasing toward the front face.
 * The rabbet is the notch at the back-inner corner.
 */
export function buildProfile(params: FrameParams): ProfilePoint[] {
  const layout = resolveFaceLayout(params)
  const face = clampFace(facePolyline(params.profile, layout), layout)
  const rest = rabbetAndInner(layout.width, layout.height, layout.rw, layout.rd)
  return dedupe([...face, ...rest])
}
