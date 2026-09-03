import JSZip from 'jszip'
import { deriveSizes } from './derived.ts'
import { buildFrame } from './frame.ts'
import { centerFlipY, extractMaskPolygons, maskInsideFromImage, NEAR_BLACK_LUM, sightFromMaskImage } from './maskTrace.ts'
import { offsetLoop } from './offset.ts'
import { sweepOffsetLoft } from './offsetLoft.ts'
import { asPolygonCorners, classifyPolygonLoops, ensureCcw, hypot, isPolygonalOutline, loopBounds, minEdgeDistance, pointInPoly, sub } from './plan.ts'
import { compositeArtworkRgba } from '../preview/artwork.ts'
import { buildProfile } from './profiles.ts'
import { buildRectFrame, presetOuterLoop, suggestedImportedOuter } from './rectFrame.ts'
import { meshToBinaryStl } from './stl.ts'
import { DEFAULT_PARAMS, PROFILE_DEFS, type FrameParams, type Mesh, type PlanVertex, type ProfileId } from './types.ts'
import { inspectMesh } from './validate.ts'
import { mapPackToFrameParams, PACK_XY_FIT_MM, packOutlineFromPlan, pocketRingFromPack, unpackLitholabPack, type ProjectJsonV1 } from '../import/litholabPack.ts'

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

function nearly(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps
}

function checkRect(params: FrameParams, label: string): void {
  const mesh = buildRectFrame(params)
  const report = inspectMesh(mesh)
  const derived = deriveSizes(params)
  const { min, max } = report.bounds
  assert(report.triangleCount > 8, `${label}: too few triangles`)
  assert(report.watertight, `${label}: mesh is not watertight (open=${report.openEdges}, nm=${report.nonManifoldEdges})`)
  assert(nearly(max.x - min.x, derived.outerWidth), `${label}: outer width ${max.x - min.x} != ${derived.outerWidth}`)
  assert(nearly(max.y - min.y, derived.outerHeight), `${label}: outer height ${max.y - min.y} != ${derived.outerHeight}`)
  assert(min.z >= -1e-4, `${label}: back should sit at z≈0`)
  assert(max.z <= params.mouldingHeight + 1e-3, `${label}: taller than moulding height`)

  const profile = buildProfile(params)
  const minU = Math.min(...profile.map((p) => p.u))
  assert(nearly(minU, 0), `${label}: inner profile u should reach the sight edge`)

  const stl = meshToBinaryStl(mesh, 'selfcheck')
  const view = new DataView(stl)
  assert(view.getUint32(80, true) === mesh.triangles.length, `${label}: STL count mismatch`)
  assert(stl.byteLength === 84 + mesh.triangles.length * 50, `${label}: STL size mismatch`)
  console.log(`ok  ${label}: ${report.triangleCount} tris, ${derived.outerWidth}×${derived.outerHeight} mm`)
}

function circleImage(size = 64, radius = 26): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inside = (x - c) * (x - c) + (y - c) * (y - c) <= radius * radius
      const v = inside ? 255 : 0
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

function circlePoly(radius: number, n = 96): PlanVertex[] {
  const out: PlanVertex[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) })
  }
  return ensureCcw(out)
}

function heartPoly(scale = 3.4, n = 200): PlanVertex[] {
  const pts: PlanVertex[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const s = Math.sin(t)
    const x = 16 * s * s * s
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    pts.push({ x: x * scale, y: y * scale })
  }
  return ensureCcw(pts)
}

function dartPoly(): PlanVertex[] {
  return ensureCcw([
    { x: 0, y: 42 },
    { x: 8, y: 18 },
    { x: 36, y: 22 },
    { x: 12, y: 0 },
    { x: 22, y: -38 },
    { x: 0, y: -18 },
    { x: -22, y: -38 },
    { x: -12, y: 0 },
    { x: -36, y: 22 },
    { x: -8, y: 18 },
  ])
}

/** Shallow gear: valleys survive a 3.4 mm offset but fill at a 20 mm moulding offset. */
function gearPoly(rInner = 32, rOuter = 48, teeth = 8): PlanVertex[] {
  const pts: PlanVertex[] = []
  const step = (Math.PI * 2) / teeth
  const toothFrac = 0.42
  const nPer = 6
  for (let t = 0; t < teeth; t++) {
    const a0 = t * step
    const aTooth = a0 + step * toothFrac
    const a1 = a0 + step
    for (let i = 0; i <= nPer; i++) {
      const a = a0 + (aTooth - a0) * (i / nPer)
      pts.push({ x: rOuter * Math.cos(a), y: rOuter * Math.sin(a) })
    }
    for (let i = 1; i <= nPer; i++) {
      const a = aTooth + (a1 - aTooth) * (i / nPer)
      pts.push({ x: rInner * Math.cos(a), y: rInner * Math.sin(a) })
    }
  }
  return ensureCcw(pts)
}

function trianglePoly(): PlanVertex[] {
  return ensureCcw([
    { x: 0, y: 50 },
    { x: 62, y: -42 },
    { x: -62, y: -42 },
  ])
}

/** Dense stair-stepped triangle, as if traced from a low-res mask. */
function stairTriangle(): PlanVertex[] {
  const corners = trianglePoly()
  const out: PlanVertex[] = []
  for (let i = 0; i < 3; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % 3]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    const nx = -dy / len
    const ny = dx / len
    const steps = 36
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const jag = s % 2 === 0 ? 0.18 : -0.18
      out.push({ x: a.x + dx * t + nx * jag, y: a.y + dy * t + ny * jag })
    }
  }
  return ensureCcw(out)
}

function triangleImage(size = 320): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4)
  const poly = [
    { x: size / 2, y: 3 },
    { x: size - 3, y: size - 3 },
    { x: 3, y: size - 3 },
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const v = pointInPoly({ x, y }, poly) ? 255 : 0
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

/** Convex teardrop: dense semicircle plus a point. */
function waterdropPoly(r = 40, n = 48): PlanVertex[] {
  const pts: PlanVertex[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) })
  }
  pts.push({ x: 0, y: -r * 1.35 })
  return ensureCcw(pts)
}

function waterdropImage(size = 320): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4)
  const poly = waterdropPoly(size * 0.32, 48).map((p) => ({ x: p.x + size / 2, y: size / 2 - p.y }))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const v = pointInPoly({ x, y }, poly) ? 255 : 0
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

/** Bold A: gray body (below 128, above near-black) with a black triangular counter. */
function letterAPolys(size: number): { outer: PlanVertex[]; hole: PlanVertex[] } {
  const outer: PlanVertex[] = [
    { x: size * 0.18, y: size * 0.92 },
    { x: size * 0.5, y: size * 0.08 },
    { x: size * 0.82, y: size * 0.92 },
    { x: size * 0.68, y: size * 0.92 },
    { x: size * 0.58, y: size * 0.58 },
    { x: size * 0.42, y: size * 0.58 },
    { x: size * 0.32, y: size * 0.92 },
  ]
  const hole: PlanVertex[] = [
    { x: size * 0.5, y: size * 0.22 },
    { x: size * 0.58, y: size * 0.5 },
    { x: size * 0.42, y: size * 0.5 },
  ]
  return { outer, hole }
}

function letterAImage(size = 160, bodyGray = 80): { width: number; height: number; data: Uint8ClampedArray } {
  const { outer, hole } = letterAPolys(size)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inBody = pointInPoly({ x, y }, outer) && !pointInPoly({ x, y }, hole)
      const v = inBody ? bodyGray : 0
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

function sampleProject(): ProjectJsonV1 {
  return {
    version: 1,
    name: 'TestHeart',
    unit: 'mm',
    photo: null,
    mask: { file: 'mask.png' },
    export: {
      width: 140,
      height: 132.6,
      border: 3,
      pixelSizeMm: 0.2,
      borderHeightMm: 3,
      borderOverlapMm: 0.4,
      borderProfile: null,
    },
    generation: {
      plateThickness: 0.15,
      colorPixelWidth: 0.4,
      layerThickness: 0.05,
      layerCount: 10,
      pixelMode: 'ADDITIVE',
      colorDistance: 'CIELab',
      maxColors: 0,
      minThickness: 0.8,
      maxThickness: 2.7,
    },
  }
}

/** Back-face vertices on the rabbet hole (z≈0, about `rw` out from the sight). */
function pocketWallXY(mesh: Mesh, sight: PlanVertex[], rw: number): PlanVertex[] {
  const out: PlanVertex[] = []
  const seen = new Set<string>()
  const lo = Math.max(0.6, rw * 0.45)
  const hi = rw * 1.7 + 0.8
  for (const t of mesh.triangles) {
    for (const v of [t.a, t.b, t.c]) {
      if (v.z > 0.05) continue
      const pt = { x: v.x, y: v.y }
      const d = minEdgeDistance(pt, sight)
      if (d < lo || d > hi) continue
      const key = `${Math.round(v.x * 50)}|${Math.round(v.y * 50)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(pt)
    }
  }
  return out
}

function nearestDist(pt: PlanVertex, pts: PlanVertex[]): number {
  let best = Infinity
  for (const q of pts) {
    const d = Math.hypot(pt.x - q.x, pt.y - q.y)
    if (d < best) best = d
  }
  return best
}

function checkRabbetFollowsPack(sight: PlanVertex[], border: number, fit: number, moulding: number, label: string): void {
  const pack = packOutlineFromPlan(sight, border)
  const pocket = pocketRingFromPack(pack, fit)
  const outer = offsetLoop(sight, moulding)
  if (pack.length < 12) throw new Error(`${label}: missing pack outline`)
  if (pocket.length < 12) throw new Error(`${label}: missing pocket ring`)
  if (!outer || outer.length < 12) throw new Error(`${label}: missing outer offset`)

  const valleys = pocket.filter((p) => minEdgeDistance(p, outer) > 4)
  assert(
    valleys.length >= 8,
    `${label}: expected pocket valleys that the outer offset fills, got ${valleys.length}`,
  )

  const rw = border + fit
  const params: FrameParams = {
    ...DEFAULT_PARAMS,
    shape: 'imported',
    sightWidth: 96,
    sightHeight: 96,
    mouldingWidth: moulding,
    mouldingHeight: 15,
    rabbetWidth: rw,
    rabbetDepth: 4,
    fitClearance: fit,
    profile: 'flat',
  }
  const mesh = buildFrame(params, sight, pocket)
  const report = inspectMesh(mesh)
  assert(report.watertight, `${label}: not watertight open=${report.openEdges} nm=${report.nonManifoldEdges}`)

  const wall = pocketWallXY(mesh, sight, rw)
  assert(wall.length >= 32, `${label}: too few pocket-wall verts (${wall.length})`)

  let clips = 0
  for (const p of wall) {
    if (pointInPoly(p, pack) && minEdgeDistance(p, pack) > 0.7) clips++
  }
  assert(clips === 0, `${label}: ${clips} pocket-wall verts clip the pack/border`)

  let maxValley = 0
  let minValleyToOuter = Infinity
  for (const p of valleys) {
    const d = nearestDist(p, wall)
    if (d > maxValley) maxValley = d
    const toOuter = minEdgeDistance(p, outer)
    if (toOuter < minValleyToOuter) minValleyToOuter = toOuter
  }
  assert(
    maxValley < 2,
    `${label}: pocket wall misses a pack valley by ${maxValley.toFixed(2)} mm`,
  )
  assert(
    maxValley < minValleyToOuter * 0.4,
    `${label}: valley gap ${maxValley.toFixed(2)} mm is too close to the outer offset (${minValleyToOuter.toFixed(2)} mm)`,
  )

  const loose = pocketRingFromPack(pack, fit * 2)
  const rTight = pocket.reduce((s, p) => s + Math.hypot(p.x, p.y), 0) / pocket.length
  const rLoose = loose.reduce((s, p) => s + Math.hypot(p.x, p.y), 0) / loose.length
  assert(rLoose > rTight + 0.3, `${label}: larger fit should grow the pack pocket (${rLoose.toFixed(2)} vs ${rTight.toFixed(2)})`)

  let maxFitErr = 0
  for (const p of pocket) {
    const err = Math.abs(minEdgeDistance(p, pack) - fit)
    if (err > maxFitErr) maxFitErr = err
  }
  assert(maxFitErr < 0.15, `${label}: pack-parallel gap error ${maxFitErr.toFixed(2)} mm (want ${fit} mm)`)

  let maxWall = 0
  for (const p of wall) {
    const d = minEdgeDistance(p, pocket)
    if (d > maxWall) maxWall = d
  }
  assert(maxWall < 0.25, `${label}: pocket wall strays ${maxWall.toFixed(2)} mm from pack+fit`)

  console.log(
    `ok  ${label}: ${wall.length} wall verts, valley gap ${maxValley.toFixed(2)} mm, wall error ${maxWall.toFixed(2)} mm, fit error ${maxFitErr.toFixed(2)} mm`,
  )
}

/** Front-face inner-wall vertices (u=0 ring at z≈moulding height, matched to the shelf at z≈rabbet depth). */
function frontInnerXY(mesh: Mesh, mouldingHeight: number, rabbetDepth: number): PlanVertex[] {
  const top = new Map<string, PlanVertex>()
  const shelf = new Set<string>()
  const keyOf = (x: number, y: number) => `${Math.round(x * 50)}|${Math.round(y * 50)}`
  for (const t of mesh.triangles) {
    for (const v of [t.a, t.b, t.c]) {
      const key = keyOf(v.x, v.y)
      if (Math.abs(v.z - mouldingHeight) <= 0.08) {
        if (!top.has(key)) top.set(key, { x: v.x, y: v.y })
      }
      if (Math.abs(v.z - rabbetDepth) <= 0.08) shelf.add(key)
    }
  }
  const out: PlanVertex[] = []
  for (const [key, pt] of top) {
    if (shelf.has(key)) out.push(pt)
  }
  return out
}

function checkFrontFollowsMask(sight: PlanVertex[], border: number, fit: number, moulding: number, label: string): void {
  const pack = packOutlineFromPlan(sight, border)
  const pocket = pocketRingFromPack(pack, fit)
  const rw = border + fit
  const mh = 15
  const rd = 4
  const params: FrameParams = {
    ...DEFAULT_PARAMS,
    shape: 'imported',
    sightWidth: 96,
    sightHeight: 96,
    mouldingWidth: moulding,
    mouldingHeight: mh,
    rabbetWidth: rw,
    rabbetDepth: rd,
    fitClearance: fit,
    profile: 'flat',
  }
  const mesh = buildFrame(params, sight, pocket)
  const report = inspectMesh(mesh)
  assert(report.watertight, `${label}: not watertight open=${report.openEdges} nm=${report.nonManifoldEdges}`)

  const rim = frontInnerXY(mesh, mh, rd)
  assert(rim.length >= 32, `${label}: too few front-inner verts (${rim.length})`)

  const ringLimit = border * 0.4
  let maxMask = 0
  let minPack = Infinity
  let outsidePack = 0
  let inBorderRing = 0
  for (const p of rim) {
    const toMask = minEdgeDistance(p, sight)
    if (toMask > maxMask) maxMask = toMask
    const toPack = minEdgeDistance(p, pack)
    if (toPack < minPack) minPack = toPack
    if (!pointInPoly(p, pack)) outsidePack++
    if (toPack < ringLimit) inBorderRing++
  }
  assert(maxMask < 0.6, `${label}: front inner strays ${maxMask.toFixed(2)} mm from the unsmoothed mask`)
  assert(outsidePack === 0, `${label}: ${outsidePack} front-inner verts sit outside the pack`)
  assert(inBorderRing === 0, `${label}: ${inBorderRing} front-inner verts sit in the pack border ring`)
  assert(
    minPack > ringLimit,
    `${label}: front inner is ${minPack.toFixed(2)} mm from the pack (expected ~${border} mm, inside the plate)`,
  )
  console.log(
    `ok  ${label}: ${rim.length} front verts, mask error ${maxMask.toFixed(2)} mm, pack clearance ${minPack.toFixed(2)} mm`,
  )
}

function checkImportedGeometricOuter(
  sight: PlanVertex[],
  shape: FrameParams['shape'],
  border: number,
  fit: number,
  moulding: number,
  label: string,
): void {
  const pack = packOutlineFromPlan(sight, border)
  const pocket = pocketRingFromPack(pack, fit)
  const suggested = suggestedImportedOuter(sight, moulding, shape)
  const rw = border + fit
  const params: FrameParams = {
    ...DEFAULT_PARAMS,
    shape,
    sightWidth: suggested.sightWidth,
    sightHeight: suggested.sightHeight,
    mouldingWidth: moulding,
    mouldingHeight: 15,
    rabbetWidth: rw,
    rabbetDepth: 4,
    fitClearance: fit,
    profile: 'flat',
  }
  const mesh = buildFrame(params, sight, pocket)
  const report = inspectMesh(mesh)
  assert(report.watertight, `${label}: not watertight open=${report.openEdges} nm=${report.nonManifoldEdges}`)
  const spanX = report.bounds.max.x - report.bounds.min.x
  const spanY = report.bounds.max.y - report.bounds.min.y
  const outer = presetOuterLoop(params)
  const ob = loopBounds(outer)
  assert(nearly(spanX, ob.maxX - ob.minX, 1.5), `${label}: outer width ${spanX.toFixed(2)} != ${ob.maxX - ob.minX}`)
  assert(nearly(spanY, ob.maxY - ob.minY, 1.5), `${label}: outer height ${spanY.toFixed(2)} != ${ob.maxY - ob.minY}`)
  const rim = frontInnerXY(mesh, 15, 4)
  assert(rim.length >= 16, `${label}: too few front-inner verts (${rim.length})`)
  let maxMask = 0
  let minR = Infinity
  let maxR = 0
  for (const p of rim) {
    const d = minEdgeDistance(p, sight)
    if (d > maxMask) maxMask = d
    const r = Math.hypot(p.x, p.y)
    if (r < minR) minR = r
    if (r > maxR) maxR = r
  }
  assert(maxMask < 0.6, `${label}: front inner strays ${maxMask.toFixed(2)} mm from the imported opening`)
  if (shape === 'circle') {
    assert(
      maxR - minR > 8,
      `${label}: inner opening looks circular (radial span ${ (maxR - minR).toFixed(2) } mm) instead of the imported silhouette`,
    )
  }
  if (shape === 'hexagon' || shape === 'octagon') {
    checkEvenPresetOuter(mesh, outer, label)
  }
  console.log(
    `ok  ${label}: ${report.triangleCount} tris, outer ${spanX.toFixed(1)}×${spanY.toFixed(1)} mm, mask error ${maxMask.toFixed(2)} mm`,
  )
}

function checkEvenPresetOuter(mesh: Mesh, expected: PlanVertex[], label: string): void {
  const n = expected.length
  const snapped: PlanVertex[] = []
  for (const c of expected) {
    let best = Infinity
    let bestP = c
    for (const t of mesh.triangles) {
      for (const v of [t.a, t.b, t.c]) {
        if (v.z > 0.2) continue
        const d = Math.hypot(v.x - c.x, v.y - c.y)
        if (d < best) {
          best = d
          bestP = { x: v.x, y: v.y }
        }
      }
    }
    assert(
      best < 0.4,
      `${label}: missing outer corner at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) d=${best.toFixed(2)}`,
    )
    snapped.push(bestP)
  }
  const lens: number[] = []
  for (let i = 0; i < n; i++) {
    const a = snapped[i]!
    const b = snapped[(i + 1) % n]!
    lens.push(Math.hypot(b.x - a.x, b.y - a.y))
  }
  const mean = lens.reduce((a, b) => a + b, 0) / n
  for (let i = 0; i < n; i++) {
    assert(
      Math.abs(lens[i]! - mean) < 0.3,
      `${label}: side ${i} length ${lens[i]!.toFixed(2)} vs mean ${mean.toFixed(2)}`,
    )
  }
}

function intrusionCount(mesh: Mesh, sight: PlanVertex[], zMin: number, inset: number): number {
  let n = 0
  for (const t of mesh.triangles) {
    const cx = (t.a.x + t.b.x + t.c.x) / 3
    const cy = (t.a.y + t.b.y + t.c.y) / 3
    const cz = (t.a.z + t.b.z + t.c.z) / 3
    if (cz < zMin) continue
    const pt = { x: cx, y: cy }
    if (pointInPoly(pt, sight) && minEdgeDistance(pt, sight) > inset) n++
  }
  return n
}

function maxTurnDeg(poly: PlanVertex[]): number {
  let max = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]!
    const b = poly[i]!
    const c = poly[(i + 1) % n]!
    const ab = sub(b, a)
    const bc = sub(c, b)
    const lab = hypot(ab)
    const lbc = hypot(bc)
    if (lab < 1e-9 || lbc < 1e-9) continue
    const dot = (ab.x * bc.x + ab.y * bc.y) / (lab * lbc)
    const ang = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
    if (ang > max) max = ang
  }
  return max
}

function checkOrganic(label: string, sight: PlanVertex[], params: FrameParams, expectOuter: number): void {
  const mesh = sweepOffsetLoft(sight, buildProfile(params))
  const report = inspectMesh(mesh)
  assert(report.triangleCount > 32, `${label}: too few triangles`)
  assert(
    report.watertight,
    `${label}: mesh is not watertight (open=${report.openEdges}, nm=${report.nonManifoldEdges})`,
  )
  const { min, max } = report.bounds
  const w = max.x - min.x
  const h = max.y - min.y
  assert(nearly(w, expectOuter, 1.0), `${label}: outer width ${w} != ~${expectOuter}`)
  assert(nearly(h, expectOuter, 1.0) || h > params.sightHeight, `${label}: unexpected outer height ${h}`)
  assert(min.z >= -1e-3, `${label}: back should sit at z≈0`)
  assert(max.z <= params.mouldingHeight + 0.05, `${label}: taller than moulding height`)
  console.log(`ok  ${label}: ${report.triangleCount} tris, ${w.toFixed(2)}×${h.toFixed(2)} mm`)
}

async function checkPackRoundtrip(): Promise<void> {
  const json = sampleProject()
  const mapped = mapPackToFrameParams(json, DEFAULT_PARAMS)
  assert(mapped.shape === 'imported', 'map: shape should be imported')
  assert(nearly(mapped.sightWidth, 140), 'map: dest width')
  assert(nearly(mapped.sightHeight, 132.6), 'map: dest height')
  assert(nearly(mapped.rabbetWidth, 3 + Math.max(DEFAULT_PARAMS.fitClearance, PACK_XY_FIT_MM)), 'map: rabbet width = border + max(fit, 0.8)')
  const tight = mapPackToFrameParams(json, { ...DEFAULT_PARAMS, fitClearance: 0 })
  assert(nearly(tight.rabbetWidth, 3 + PACK_XY_FIT_MM), 'map: zero fit still gets 0.8 mm XY gap')
  assert(nearly(mapped.fitClearance, PACK_XY_FIT_MM) || mapped.fitClearance >= PACK_XY_FIT_MM, 'map: fit floor 0.8')
  assert(mapped.rabbetDepth > 3.5 && mapped.rabbetDepth < 6, `map: rabbet depth ${mapped.rabbetDepth}`)
  assert(mapped.mouldingHeight > mapped.rabbetDepth, 'map: moulding taller than rabbet')
  assert(!mapped.rabbetStack.enabled, 'map: stack should be off')
  console.log(
    `ok  pack-map: ${mapped.sightWidth}×${mapped.sightHeight} sight, rabbet ${mapped.rabbetWidth}×${mapped.rabbetDepth}`,
  )

  const inner = new JSZip()
  inner.file('project.json', JSON.stringify(json, null, 2))
  inner.file('mask.png', new Uint8Array([137, 80, 78, 71]))
  const litholab = await inner.generateAsync({ type: 'uint8array' })

  const outer = new JSZip()
  outer.file('TestHeart.litholab', litholab)
  outer.file('originals/original-masked.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3]))
  outer.file('originals/original-mask.png', new Uint8Array([137, 80, 78, 71, 4, 5, 6]))
  outer.file('stl/layer-plate.stl', new Uint8Array([0]))
  const packed = await outer.generateAsync({ type: 'uint8array' })
  const assets = await unpackLitholabPack(packed)
  assert(assets.name === 'TestHeart', `unpack name ${assets.name}`)
  assert(assets.json.export.border === 3, 'unpack border')
  assert(assets.maskBlob !== null, 'unpack should find originals/original-mask.png')
  assert(assets.maskedPngBlob !== null, 'unpack should find originals/original-masked.png')
  console.log('ok  pack-unpack: foldered zip + nested .litholab')

  const bare = await unpackLitholabPack(litholab)
  assert(bare.name === 'TestHeart', 'bare .litholab name')
  assert(bare.maskBlob !== null, 'bare .litholab mask')
  console.log('ok  pack-unpack: bare .litholab')
}

function checkMaskTrace(): void {
  const img = circleImage()
  const dest = 100
  const { sight, holes } = sightFromMaskImage(img, dest, dest)
  assert(sight.length >= 16, 'mask trace: too few verts')
  assert(holes.length === 0, `mask trace: circle should have no holes, got ${holes.length}`)
  const xs = sight.map((p) => p.x)
  const ys = sight.map((p) => p.y)
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  assert(nearly(w, dest, 3), `mask trace: width ${w} != ${dest}`)
  assert(nearly(h, dest, 3), `mask trace: height ${h} != ${dest}`)
  const loops = extractMaskPolygons(img)
  assert(loops.length >= 1, 'mask trace: no loops')
  console.log(`ok  mask-trace: ${sight.length} verts, bbox ${w.toFixed(1)}×${h.toFixed(1)} mm`)
}

function sampleAt(img: { width: number; data: Uint8ClampedArray | Uint8Array }, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0]
}

function checkLetterAMask(): void {
  const size = 160
  const bodyGray = 80
  assert(bodyGray > NEAR_BLACK_LUM && bodyGray < 128, 'letter-A fixture gray should sit between cutoffs')
  const img = letterAImage(size, bodyGray)
  const { outer, hole } = letterAPolys(size)
  const bodyPt = { x: size * 0.28, y: size * 0.72 }
  const holePt = { x: size * 0.5, y: size * 0.38 }
  const outPt = { x: 8, y: 8 }
  assert(pointInPoly(bodyPt, outer) && !pointInPoly(bodyPt, hole), 'letter-A: body sample')
  assert(pointInPoly(holePt, hole), 'letter-A: hole sample')

  const inside = maskInsideFromImage(img)
  const at = (pt: PlanVertex) => inside[Math.round(pt.y) * size + Math.round(pt.x)] ?? 0
  assert(at(bodyPt) === 1, 'letter-A: gray body must stay inside at near-black cutoff')
  assert(at(holePt) === 0, 'letter-A: black counter must stay outside')
  assert(at(outPt) === 0, 'letter-A: background must stay outside')

  const loops = extractMaskPolygons(img, { smoothIters: 0 })
  const classified = classifyPolygonLoops(loops)
  assert(classified.outers.length === 1, `letter-A: expected 1 outer, got ${classified.outers.length}`)
  assert(classified.holes.length === 1, `letter-A: expected 1 hole, got ${classified.holes.length}`)

  const dest = size
  const trace = sightFromMaskImage(img, dest, dest)
  assert(trace.holes.length === 1, `letter-A trace: expected 1 hole, got ${trace.holes.length}`)
  assert(trace.sight.length > 12, `letter-A trace: expected traced letter outline, got ${trace.sight.length} verts`)
  assert(!isPolygonalOutline(trace.sight), 'letter-A trace: A outline should stay organic, not a hull polygon')

  const photo = letterAImage(size, 255)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inBody = pointInPoly({ x, y }, outer) && !pointInPoly({ x, y }, hole)
      if (inBody) {
        photo.data[i] = 220
        photo.data[i + 1] = 30
        photo.data[i + 2] = 40
        photo.data[i + 3] = 255
      } else {
        photo.data[i + 3] = 0
      }
    }
  }
  const planOuter = centerFlipY(outer, size, size)
  const planHole = centerFlipY(hole, size, size)
  const composited = compositeArtworkRgba(photo, {
    widthMm: dest,
    heightMm: dest,
    sight: planOuter,
    holes: [planHole],
  })
  const bodyPx = sampleAt(composited, Math.round(bodyPt.x), Math.round(bodyPt.y))
  const holePx = sampleAt(composited, Math.round(holePt.x), Math.round(holePt.y))
  const outPx = sampleAt(composited, Math.round(outPt.x), Math.round(outPt.y))
  assert(bodyPx[3] === 255, `letter-A art: body alpha ${bodyPx[3]}`)
  assert(bodyPx[0] > 180 && bodyPx[1] < 60, `letter-A art: body should keep photo RGB, got ${bodyPx.join(',')}`)
  assert(holePx[3] === 0, `letter-A art: counter should stay clear, alpha ${holePx[3]}`)
  assert(outPx[3] === 0, `letter-A art: outside alpha ${outPx[3]}`)

  const aParams: FrameParams = {
    ...DEFAULT_PARAMS,
    shape: 'imported',
    sightWidth: 100,
    sightHeight: 100,
    mouldingWidth: 20,
    rabbetWidth: 3.4,
    rabbetDepth: 4,
    profile: 'flat',
  }
  const tight = sightFromMaskImage(img, 100, 100)
  const aMesh = buildFrame(aParams, tight.sight)
  const aReport = inspectMesh(aMesh)
  assert(aReport.watertight, `letter-A loft: not watertight open=${aReport.openEdges} nm=${aReport.nonManifoldEdges}`)
  const aInside = intrusionCount(aMesh, tight.sight, aParams.rabbetDepth + 0.4, 1)
  assert(aInside === 0, `letter-A loft: ${aInside} face triangles sit inside the opening`)
  console.log(`ok  letter-A-mask: ${trace.sight.length} outer verts, ${trace.holes[0]?.length ?? 0} hole verts`)
}

const profiles: ProfileId[] = PROFILE_DEFS.map((d) => d.id)
for (const profile of profiles) {
  checkRect({ ...DEFAULT_PARAMS, profile }, profile)
  checkRect({ ...DEFAULT_PARAMS, profile, faceDepth: 0 }, `${profile}-flat-face`)
  checkRect({ ...DEFAULT_PARAMS, profile, faceDepth: 1, lipWidth: 0 }, `${profile}-full-no-lip`)
}

function checkRadiusPreset(shape: FrameParams['shape'], radius: number, label: string): void {
  const params: FrameParams = { ...DEFAULT_PARAMS, shape, sightWidth: radius, sightHeight: radius, profile: 'flat' }
  const mesh = buildFrame(params)
  const report = inspectMesh(mesh)
  assert(report.triangleCount > 24, `${label}: too few triangles`)
  assert(report.watertight, `${label}: not watertight open=${report.openEdges} nm=${report.nonManifoldEdges}`)
  const spanX = report.bounds.max.x - report.bounds.min.x
  const spanY = report.bounds.max.y - report.bounds.min.y
  const mw = params.mouldingWidth
  assert(spanX > 2 * radius + 2 * mw - 8, `${label}: outer width ${spanX.toFixed(2)} too small for r=${radius}`)
  assert(spanY > 1.4 * radius + 2 * mw - 8, `${label}: outer height ${spanY.toFixed(2)} too small for r=${radius}`)
  console.log(`ok  ${label}: ${report.triangleCount} tris, ${spanX.toFixed(1)}×${spanY.toFixed(1)} mm`)
}

checkRadiusPreset('hexagon', 50, 'hexagon-r50')
checkRadiusPreset('octagon', 50, 'octagon-r50')
checkRadiusPreset('circle', 50, 'circle-r50')

checkRect(
  {
    ...DEFAULT_PARAMS,
    rabbetStack: { enabled: true, glass: 2, mat: 1, backing: 1.5, clearance: 0.5 },
    profile: 'ogee',
    lipWidth: 8,
    faceDepth: 0.45,
  },
  'stacked-rabbet',
)

checkRect({ ...DEFAULT_PARAMS, profile: 'gallery', lipWidth: 12 }, 'wide-lip-gallery')

checkMaskTrace()

const organicParams: FrameParams = {
  ...DEFAULT_PARAMS,
  shape: 'imported',
  sightWidth: 100,
  sightHeight: 100,
  mouldingWidth: 12,
  mouldingHeight: 15,
  rabbetWidth: 3.5,
  rabbetDepth: 4,
  profile: 'flat',
}
checkOrganic('circle-offset-loft', circlePoly(50), organicParams, 100 + 2 * 12)

const circleOuter = offsetLoop(circlePoly(50), 12)
if (!circleOuter || circleOuter.length < 32) throw new Error('circle offset: missing loop')
const circleTurn = maxTurnDeg(circleOuter)
assert(circleTurn < 8, `circle offset: max turn ${circleTurn.toFixed(1)}° looks like grid stairs`)
console.log(`ok  circle-offset-smooth: ${circleOuter.length} verts, max turn ${circleTurn.toFixed(2)}°`)

const heartOuter = offsetLoop(heartPoly(), 20)
if (!heartOuter || heartOuter.length < 32) throw new Error('heart offset: missing loop')
const heartTurn = maxTurnDeg(heartOuter)
assert(heartTurn < 16, `heart offset: max turn ${heartTurn.toFixed(1)}° looks like grid stairs`)
console.log(`ok  heart-offset-smooth: ${heartOuter.length} verts, max turn ${heartTurn.toFixed(2)}°`)

const dartParams: FrameParams = { ...organicParams, sightWidth: 72, sightHeight: 84, profile: 'chamfer' }
const dartMesh = buildFrame({ ...dartParams, shape: 'imported' }, dartPoly())
const dartReport = inspectMesh(dartMesh)
assert(dartReport.watertight, `dart: not watertight open=${dartReport.openEdges} nm=${dartReport.nonManifoldEdges}`)
assert(dartReport.triangleCount > 32, 'dart: too few triangles')
console.log(`ok  dart-offset-loft: ${dartReport.triangleCount} tris`)

checkRabbetFollowsPack(gearPoly(), 3, 0.8, 20, 'gear-pack-rabbet')
checkFrontFollowsMask(gearPoly(), 3, 0.8, 20, 'gear-front-mask')

const heartSight = heartPoly()
const heartParams: FrameParams = {
  ...DEFAULT_PARAMS,
  shape: 'imported',
  sightWidth: 110,
  sightHeight: 100,
  mouldingWidth: 20,
  mouldingHeight: 15,
  rabbetWidth: 3.5,
  rabbetDepth: 4,
  profile: 'flat',
}
const heartPacked = buildFrame(
  { ...heartParams, rabbetWidth: 3.8, fitClearance: 0.8 },
  heartSight,
  pocketRingFromPack(packOutlineFromPlan(heartSight, 3), 0.8),
)
const heartPackedReport = inspectMesh(heartPacked)
assert(
  heartPackedReport.watertight,
  `heart-pack: not watertight open=${heartPackedReport.openEdges} nm=${heartPackedReport.nonManifoldEdges}`,
)
console.log(`ok  heart-pack-rabbet: ${heartPackedReport.triangleCount} tris`)
checkFrontFollowsMask(heartSight, 3, 0.8, 20, 'heart-front-mask')
checkImportedGeometricOuter(gearPoly(), 'circle', 3, 0.8, 20, 'gear-circle-outer')
checkImportedGeometricOuter(gearPoly(), 'hexagon', 3, 0.8, 20, 'gear-hexagon-outer')
checkImportedGeometricOuter(gearPoly(), 'octagon', 3, 0.8, 20, 'gear-octagon-outer')
checkImportedGeometricOuter(heartSight, 'rectangle', 3, 0.8, 20, 'heart-rect-outer')
const heartMesh = buildFrame(heartParams, heartSight)
const heartReport = inspectMesh(heartMesh)
assert(heartReport.watertight, `heart: not watertight open=${heartReport.openEdges} nm=${heartReport.nonManifoldEdges}`)
const inside = intrusionCount(heartMesh, heartSight, heartParams.rabbetDepth + 0.4, 2)
assert(inside === 0, `heart: ${inside} face triangles sit inside the sight opening (cleft collision)`)
console.log(`ok  heart-offset-loft: ${heartReport.triangleCount} tris, no cleft intrusion`)

assert(isPolygonalOutline(trianglePoly()), 'triangle: should classify as a polygon')
assert(!isPolygonalOutline(heartPoly()), 'heart: should stay organic')
assert(!isPolygonalOutline(dartPoly()), 'dart: concave, should stay organic')
const stairCorners = asPolygonCorners(stairTriangle())
assert(stairCorners !== null && stairCorners.length === 3, `stair triangle: expected 3 corners, got ${stairCorners?.length ?? 0}`)
if (!stairCorners || stairCorners.length !== 3) throw new Error('stair triangle: missing corners')
const tri = trianglePoly()
for (let i = 0; i < 3; i++) {
  const a = tri[i]!
  const b = tri[(i + 1) % 3]!
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  assert(minEdgeDistance(mid, stairCorners) < 0.8, 'triangle: mid-edge bowed inward after simplify')
}

const triParams: FrameParams = {
  ...DEFAULT_PARAMS,
  shape: 'imported',
  sightWidth: 140,
  sightHeight: 117,
  mouldingWidth: 20,
  mouldingHeight: 15,
  rabbetWidth: 3.4,
  rabbetDepth: 4.05,
  profile: 'bullnose',
}
const triSight = asPolygonCorners(tri)!
const triMesh = buildFrame(triParams, tri)
const triReport = inspectMesh(triMesh)
assert(triReport.watertight, `triangle: not watertight open=${triReport.openEdges} nm=${triReport.nonManifoldEdges}`)
const triInside = intrusionCount(triMesh, triSight, triParams.rabbetDepth + 0.4, 2)
assert(triInside === 0, `triangle: ${triInside} face triangles sit inside the sight opening`)
console.log(`ok  triangle-miter: ${triSight.length} verts, ${triReport.triangleCount} tris, no inner intrusion`)

const maskTri = sightFromMaskImage(triangleImage(), 140, 117)
assert(maskTri.sight.length === 3, `triangle mask: expected 3 verts, got ${maskTri.sight.length}`)
assert(maskTri.holes.length === 0, `triangle mask: expected no holes, got ${maskTri.holes.length}`)
assert(isPolygonalOutline(maskTri.sight), 'triangle mask: should classify as a polygon')
console.log(`ok  triangle-mask: ${maskTri.sight.length} verts`)

const drop = waterdropPoly()
assert(!isPolygonalOutline(drop), 'waterdrop: convex teardrop should stay organic')
const dropB = loopBounds(drop)
const dropW = dropB.maxX - dropB.minX
const dropH = dropB.maxY - dropB.minY
const dropShifted = drop.map((p) => ({ x: p.x - dropB.minX, y: p.y - dropB.minY }))
const dropSight = centerFlipY(dropShifted, dropW, dropH)
assert(dropSight.length > 12, `waterdrop: expected dense organic path, got ${dropSight.length} verts`)
assert(!isPolygonalOutline(dropSight), 'waterdrop: centered sight should stay organic')
const maskDrop = sightFromMaskImage(waterdropImage(), 140, 180)
assert(maskDrop.sight.length > 12, `waterdrop mask: expected many verts, got ${maskDrop.sight.length}`)
assert(maskDrop.holes.length === 0, `waterdrop mask: expected no holes, got ${maskDrop.holes.length}`)
assert(!isPolygonalOutline(maskDrop.sight), 'waterdrop mask: should stay organic')
const dropMesh = buildFrame(
  {
    ...DEFAULT_PARAMS,
    shape: 'imported',
    sightWidth: 140,
    sightHeight: 180,
    mouldingWidth: 20,
    rabbetWidth: 3.4,
    rabbetDepth: 4,
    profile: 'flat',
  },
  dropSight,
)
const dropReport = inspectMesh(dropMesh)
assert(dropReport.watertight, `waterdrop: not watertight open=${dropReport.openEdges} nm=${dropReport.nonManifoldEdges}`)
const dropSightB = loopBounds(dropSight)
const tipPad = Math.min(
  dropSightB.minY - dropReport.bounds.min.y,
  dropReport.bounds.max.y - dropSightB.maxY,
)
assert(tipPad > 18, `waterdrop: outer tip pad ${tipPad.toFixed(2)} mm looks flattened`)
console.log(`ok  waterdrop-organic: ${dropSight.length} verts, mask ${maskDrop.sight.length}, ${dropReport.triangleCount} tris`)

checkLetterAMask()

await checkPackRoundtrip()

console.log('geometry self-check passed')
