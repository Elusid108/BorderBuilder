import { BUTTON_PIVOT_OFFSET_MM, backRabbetU, lithoEdgeU, rabbetSteps } from '../derived.ts'
import { buildFrame, frameIssues } from '../frame.ts'
import { indexedBounds, weld, type IndexedMesh } from '../indexed.ts'
import {
  indexedToManifold,
  loadManifold,
  manifoldToIndexed,
  toPolygon,
  type Manifold,
  type Wasm,
} from '../manifold.ts'
import { ensureCcw, loopBounds, minEdgeDistance, perimeter, pointInPoly, simplifyClosed } from '../plan.ts'
import { buildProfile } from '../profiles.ts'
import { scoreGrid, type Segment } from '../scoreGrid.ts'
import { sightLoop, wallRing, type FrameInput } from '../rings.ts'
import type { FrameParams, PlanVertex, ProfilePoint } from '../types.ts'
import { BOSS_WALL_MM, kickstandLayout, legMatrix, socketMatrix, type KickstandLayout } from './kickstand.ts'

/** Pilot hole diameters for self-tapping screws into PLA / PETG (mm). */
export const PILOT_DIAMETER: Record<'M3' | 'M2.5', number> = { M3: 2.5, 'M2.5': 2.05 }
/** Clearance + countersink for the turn-button screw (mm). */
const BUTTON_HOLE: Record<'M3' | 'M2.5', { clear: number; head: number }> = {
  M3: { clear: 3.4, head: 6.4 },
  'M2.5': { clear: 2.9, head: 5.4 },
}
export const BUTTON_WIDTH_MM = 8
export const BUTTON_LENGTH_MM = 18
export const BUTTON_THICKNESS_MM = 2.5
const PILOT_MAX_DEPTH_MM = 7
const ACRYLIC_SIMPLIFY_MM = 0.01
const PILOT_MIN_DEPTH_MM = 3
const PILOT_TOP_SKIN_MM = 1.2

export interface WireNotch {
  /** Where the notch meets the panel edge. */
  at: PlanVertex
  /** Outward normal there. */
  normal: PlanVertex
  width: number
  depth: number
}

export interface Kit {
  /** Frame as shown in the preview (pilot holes are cut by `drillPilotHoles` at export). */
  frame: IndexedMesh
  /** Present when backlight is on. */
  backlight: BacklightKit | null
  warnings: string[]
}

export interface BacklightKit {
  /** Acrylic cut line (= lithophane size), front view. */
  acrylicOutline: PlanVertex[]
  /** Score region (= visible opening) and its holes. */
  scoreRegion: PlanVertex[]
  scoreHoles: PlanVertex[][]
  /** Score lines, front view (the DXF mirrors them when scoring the back face). */
  scoreSegments: Segment[]
  /** LED wall ring and the strip length along it. */
  ledRing: PlanVertex[]
  ledStripLength: number
  panel: IndexedMesh
  panelOutline: PlanVertex[]
  notch: WireNotch
  kickstand: IndexedMesh | null
  kickstandLayout: KickstandLayout | null
  button: IndexedMesh | null
  buttonPivots: PlanVertex[]
  pilotHoles: { at: PlanVertex; diameter: number; depth: number }[]
  /** Preview-only solids in assembly coordinates. */
  preview: { acrylic: IndexedMesh; led: IndexedMesh; kickstand: IndexedMesh | null; buttons: IndexedMesh | null }
  /** Z bands of each layer in assembly coordinates (back = 0). */
  bands: { panel: [number, number]; acrylic: [number, number]; litho: [number, number] }
  acrylicThickness: number
}

function loopCentre(loop: PlanVertex[]): PlanVertex {
  const b = loopBounds(loop)
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/** First crossing of the ray `o + t·d` with the loop, with the edge's outward normal (CCW loop). */
function rayHit(o: PlanVertex, d: PlanVertex, loop: PlanVertex[]): { p: PlanVertex; n: PlanVertex } | null {
  let bestT = Infinity
  let best: { p: PlanVertex; n: PlanVertex } | null = null
  const n = loop.length
  for (let i = 0; i < n; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % n]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const det = d.x * -ey - d.y * -ex
    if (Math.abs(det) < 1e-12) continue
    const rx = a.x - o.x
    const ry = a.y - o.y
    const t = (rx * -ey - ry * -ex) / det
    const u = (d.x * ry - d.y * rx) / det
    if (t > 1e-9 && u >= 0 && u <= 1 && t < bestT) {
      bestT = t
      const len = Math.hypot(ex, ey) || 1
      best = { p: { x: o.x + d.x * t, y: o.y + d.y * t }, n: { x: ey / len, y: -ex / len } }
    }
  }
  return best
}

function pointAtArc(loop: PlanVertex[], s: number): PlanVertex {
  const perim = perimeter(loop)
  let t = ((s % perim) + perim) % perim
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % loop.length]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (t <= len || i === loop.length - 1) {
      const u = len < 1e-12 ? 0 : t / len
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
    t -= len
  }
  return loop[0]!
}

function arcParamOf(loop: PlanVertex[], p: PlanVertex): number {
  let best = Infinity
  let bestS = 0
  let acc = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % loop.length]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
    const d = Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t)
    const len = Math.sqrt(len2)
    if (d < best) {
      best = d
      bestS = acc + t * len
    }
    acc += len
  }
  return bestS
}

/** Highest point of the section at `u` (the face above the back). */
export function faceHeightAt(profile: ProfilePoint[], u: number): number {
  let top = -Infinity
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i]!
    const b = profile[(i + 1) % profile.length]!
    const lo = Math.min(a.u, b.u)
    const hi = Math.max(a.u, b.u)
    if (u < lo - 1e-9 || u > hi + 1e-9) continue
    const v = hi - lo < 1e-9 ? Math.max(a.v, b.v) : a.v + ((u - a.u) / (b.u - a.u)) * (b.v - a.v)
    if (v > top) top = v
  }
  return top
}

function wireNotch(outline: PlanVertex[], params: FrameParams): WireNotch {
  const b = params.backlight
  const a = (b.wireAngleDeg * Math.PI) / 180
  const dir = { x: Math.sin(a), y: -Math.cos(a) }
  const c = loopCentre(outline)
  const hit = rayHit(c, dir, outline) ?? { p: outline[0]!, n: dir }
  return { at: hit.p, normal: hit.n, width: b.wireWidth, depth: b.wireDepth }
}

function notchPolygon(n: WireNotch): [number, number][] {
  const t = { x: -n.normal.y, y: n.normal.x }
  const hw = n.width / 2
  const out = 2
  const pts = [
    { x: n.at.x + n.normal.x * out - t.x * hw, y: n.at.y + n.normal.y * out - t.y * hw },
    { x: n.at.x + n.normal.x * out + t.x * hw, y: n.at.y + n.normal.y * out + t.y * hw },
    { x: n.at.x - n.normal.x * n.depth + t.x * hw, y: n.at.y - n.normal.y * n.depth + t.y * hw },
    { x: n.at.x - n.normal.x * n.depth - t.x * hw, y: n.at.y - n.normal.y * n.depth - t.y * hw },
  ]
  return toPolygon(ensureCcw(pts))
}

function boxAt(wasm: Wasm, size: [number, number, number], origin: [number, number, number], m: number[]): Manifold {
  return wasm.Manifold.cube(size).translate(origin).transform(m as never)
}

/** Pick a socket spot inside the panel so the whole boss footprint clears the edge. */
function placeSocket(
  outline: PlanVertex[],
  params: FrameParams,
  frameBottomY: number,
): KickstandLayout | null {
  const b = loopBounds(outline)
  const cx = (b.minX + b.maxX) / 2
  const h = b.maxY - b.minY
  const candidates = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7]
  for (const f of candidates) {
    for (const dx of [0, -0.15, 0.15, -0.3, 0.3]) {
      const socket = { x: cx + dx * (b.maxX - b.minX), y: b.minY + f * h }
      const k = kickstandLayout(params.backlight, socket, frameBottomY)
      if (bossFootprint(k).every((p) => pointInPoly(p, outline) && minEdgeDistance(p, outline) >= 1)) return k
    }
  }
  return null
}

function bossFootprint(k: KickstandLayout): PlanVertex[] {
  const m = socketMatrix(k)
  const hx = k.pocketWidth / 2 + BOSS_WALL_MM
  const hy = k.pocketThickness / 2 + BOSS_WALL_MM
  const out: PlanVertex[] = []
  for (const X of [-hx, hx]) {
    for (const Y of [-hy, hy]) {
      for (const Z of [0, k.pocketDepth + BOSS_WALL_MM]) {
        out.push({ x: m[0]! * X + m[4]! * Y + m[8]! * Z + m[12]!, y: m[1]! * X + m[5]! * Y + m[9]! * Z + m[13]! })
      }
    }
  }
  return out
}

function buildPanel(
  wasm: Wasm,
  outline: PlanVertex[],
  notch: WireNotch,
  params: FrameParams,
  kick: KickstandLayout | null,
): Manifold {
  const b = params.backlight
  let cs = new wasm.CrossSection([toPolygon(ensureCcw(outline))])
  cs = cs.subtract(new wasm.CrossSection([notchPolygon(notch)]))
  let panel = cs.extrude(b.panelThickness)
  if (kick) {
    const m = socketMatrix(kick)
    const w = kick.pocketWidth
    const t = kick.pocketThickness
    const D = kick.pocketDepth
    const wall = BOSS_WALL_MM
    const boss = boxAt(wasm, [w + 2 * wall, t + 2 * wall, D + wall], [-(w / 2 + wall), -(t / 2 + wall), 0], m)
    const slab = wasm.Manifold.cube([4000, 4000, 200]).translate([-2000, -2000, b.panelThickness - 200])
    const pocket = boxAt(wasm, [w, t, D + 1], [-w / 2, -t / 2, -1], m)
    panel = panel.add(boss.intersect(slab)).subtract(pocket)
  }
  return panel
}

function buildButton(wasm: Wasm, params: FrameParams): Manifold {
  const r = BUTTON_WIDTH_MM / 2
  const reach = BUTTON_LENGTH_MM - 2 * r
  const outline = wasm.CrossSection.hull([wasm.CrossSection.circle(r, 48), wasm.CrossSection.circle(r, 48).translate(reach, 0)])
  const hole = BUTTON_HOLE[params.backlight.screw]
  const T = BUTTON_THICKNESS_MM
  const sink = Math.min(T - 0.8, (hole.head - hole.clear) / 2)
  const bore = wasm.Manifold.cylinder(T + 2, hole.clear / 2, hole.clear / 2, 32).translate([0, 0, -1])
  const cone = wasm.Manifold.cylinder(sink + 0.01, hole.clear / 2, hole.head / 2, 32).translate([0, 0, T - sink])
  return outline.extrude(T).subtract(bore).subtract(cone)
}

function ledBand(wasm: Wasm, ring: PlanVertex[], width: number, z0: number): Manifold {
  const outer = new wasm.CrossSection([toPolygon(ensureCcw(ring))])
  const inner = outer.offset(-1.6, 'Miter')
  return outer.subtract(inner).extrude(width).translate([0, 0, z0])
}

/** Frame (optionally with turn-button pilot holes) plus, with backlight on, every kit part. */
export async function buildKit(input: FrameInput, opts: { skipValidation?: boolean } = {}): Promise<Kit> {
  const params = input.params
  if (!opts.skipValidation) {
    const issues = frameIssues(params, input.sight)
    if (issues.length > 0) throw new Error(issues.map((i) => i.message).join(' '))
  }
  const frameSoup = buildFrame(params, input.sight, input.packOutline, { skipValidation: true })
  const frame = weld(frameSoup)
  const warnings: string[] = []
  if (!params.backlight.enabled) return { frame, backlight: null, warnings }

  const wasm = await loadManifold()
  const b = params.backlight
  const steps = rabbetSteps(params)
  const [litho, acrylic, panelStep] = [steps[0]!, steps[1]!, steps[2]!]
  const r3 = backRabbetU(params)
  const frameBounds = indexedBounds(frame)

  // The Chaikin-smoothed pack trace carries ~0.01 mm vertex spacing; 0.01 mm DP is far below laser kerf.
  const acrylicOutline = ensureCcw(simplifyClosed(wallRing(input, lithoEdgeU(params)), ACRYLIC_SIMPLIFY_MM))
  const scoreRegion = sightLoop(input)
  const scoreHoles = (input.holes ?? []).filter((h) => h.length >= 3)
  const scoreSegments = scoreGrid([scoreRegion, ...scoreHoles], b.scorePitch)
  const ledRing = wallRing(input, acrylic.u)
  const panelOutline = wallRing(input, r3 - b.panelFit)
  const notch = wireNotch(panelOutline, params)

  let kick: KickstandLayout | null = null
  if (b.kickstand) {
    kick = placeSocket(panelOutline, params, frameBounds.min.y)
    if (!kick) warnings.push('No room for the kickstand socket on this back panel — kickstand skipped.')
  }
  const panelM = buildPanel(wasm, panelOutline, notch, params, kick)
  const panel = manifoldToIndexed(panelM)
  panelM.delete()

  let kickstand: IndexedMesh | null = null
  let kickPreview: IndexedMesh | null = null
  if (kick) {
    const leg = new wasm.CrossSection([toPolygon(ensureCcw(kick.profile))]).extrude(kick.legWidth)
    kickstand = manifoldToIndexed(leg)
    const placed = leg.transform(legMatrix(kick) as never)
    kickPreview = manifoldToIndexed(placed)
    leg.delete()
    placed.delete()
  }

  // Turn-buttons: evenly spaced on the pivot ring, starting half a pitch from the wire notch.
  const buttonPivots: PlanVertex[] = []
  const pilotHoles: { at: PlanVertex; diameter: number; depth: number }[] = []
  let button: IndexedMesh | null = null
  let buttonsPreview: IndexedMesh | null = null
  if (b.buttonCount > 0) {
    const pivotU = r3 + BUTTON_PIVOT_OFFSET_MM
    const pivotRing = wallRing(input, pivotU)
    const perim = perimeter(pivotRing)
    const s0 = arcParamOf(pivotRing, notch.at)
    for (let i = 0; i < b.buttonCount; i++) {
      buttonPivots.push(pointAtArc(pivotRing, s0 + ((i + 0.5) * perim) / b.buttonCount))
    }
    const profile = buildProfile(params)
    const dia = PILOT_DIAMETER[b.screw]
    let top = Infinity
    for (let du = -dia / 2 - 0.5; du <= dia / 2 + 0.5 + 1e-9; du += 0.25) top = Math.min(top, faceHeightAt(profile, pivotU + du))
    const depth = Math.min(PILOT_MAX_DEPTH_MM, top - PILOT_TOP_SKIN_MM)
    if (depth >= PILOT_MIN_DEPTH_MM) {
      for (const at of buttonPivots) pilotHoles.push({ at, diameter: dia, depth })
    } else {
      warnings.push('The face is too thin over the turn-button ring for pilot holes — use a flatter profile or glue the buttons.')
    }
    const btn = buildButton(wasm, params)
    button = manifoldToIndexed(btn)
    const placed = wasm.Manifold.union(
      buttonPivots.map((p) => {
        // Rotate each button so it reaches inward across the panel edge.
        const c = loopCentre(panelOutline)
        const ang = (Math.atan2(c.y - p.y, c.x - p.x) * 180) / Math.PI
        return btn.rotate([0, 0, ang]).translate([p.x, p.y, -BUTTON_THICKNESS_MM])
      }),
    )
    buttonsPreview = manifoldToIndexed(placed)
    btn.delete()
    placed.delete()
  }

  const acrylicBand: [number, number] = [panelStep.depth, panelStep.depth + acrylic.depth]
  const acrylicZ0 = acrylicBand[1] - b.acrylicThickness
  const acrylicM = new wasm.CrossSection([toPolygon(ensureCcw(acrylicOutline))])
    .extrude(b.acrylicThickness)
    .translate([0, 0, acrylicZ0])
  const ledM = ledBand(wasm, ledRing, Math.min(b.ledStripWidth, acrylic.depth), acrylicBand[0] + (acrylic.depth - Math.min(b.ledStripWidth, acrylic.depth)) / 2)
  const preview = {
    acrylic: manifoldToIndexed(acrylicM),
    led: manifoldToIndexed(ledM),
    kickstand: kickPreview,
    buttons: buttonsPreview,
  }
  acrylicM.delete()
  ledM.delete()

  return {
    frame,
    warnings,
    backlight: {
      acrylicOutline,
      scoreRegion,
      scoreHoles,
      scoreSegments,
      ledRing,
      ledStripLength: perimeter(ledRing),
      panel,
      panelOutline,
      notch,
      kickstand,
      kickstandLayout: kick,
      button,
      buttonPivots,
      pilotHoles,
      preview,
      bands: {
        panel: [0, panelStep.depth],
        acrylic: acrylicBand,
        litho: [acrylicBand[1], acrylicBand[1] + litho.depth],
      },
      acrylicThickness: b.acrylicThickness,
    },
  }
}

/**
 * The frame with turn-button pilot holes cut in (export only — the CSG on a
 * full organic frame costs more than the rest of a rebuild). Adds a warning to
 * `kit.warnings` and returns the undrilled frame if the mesh is rejected.
 */
export async function drillPilotHoles(kit: Kit): Promise<IndexedMesh> {
  const holes = kit.backlight?.pilotHoles ?? []
  if (holes.length === 0) return kit.frame
  const wasm = await loadManifold()
  try {
    const frameM = indexedToManifold(wasm, kit.frame)
    const cutters = wasm.Manifold.union(
      holes.map((h) => wasm.Manifold.cylinder(h.depth + 1, h.diameter / 2, h.diameter / 2, 24).translate([h.at.x, h.at.y, -1])),
    )
    const drilled = frameM.subtract(cutters)
    const out = manifoldToIndexed(drilled)
    frameM.delete()
    cutters.delete()
    drilled.delete()
    return out
  } catch {
    const h = holes[0]!
    kit.warnings.push(
      `Could not cut pilot holes into this frame mesh — drill ${h.diameter} mm × ${h.depth.toFixed(0)} mm holes at the turn-button marks.`,
    )
    return kit.frame
  }
}
