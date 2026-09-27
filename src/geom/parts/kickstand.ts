import type { BacklightParams, PlanVertex } from '../types.ts'

/** Leg angle from vertical when the frame stands (degrees). Wider = steadier, and a steeper socket prints cleaner. */
export const KICK_SPLAY_DEG = 35
/** Socket clearance per side (mm). */
export const POCKET_CLEARANCE_MM = 0.2
/** How far the leg's tongue sits in the socket (mm). */
export const POCKET_DEPTH_MM = 9
/** Socket boss wall (mm). */
export const BOSS_WALL_MM = 2.4
/** Panel material kept in front of the socket's deepest corner (mm). */
export const PANEL_SKIN_MM = 1.2

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/**
 * Plug-in kickstand geometry, in the back panel's assembly frame (x/y as seen
 * from the front, z = 0 the frame back face, the boss protruding to −z).
 *
 * The socket axis leaves the panel at `alpha = tilt + splay` to the panel
 * plane, so with the frame leaning back by `tilt` the leg meets the table at
 * `splay` from vertical. Its foot is cut level with the table.
 */
export interface KickstandLayout {
  alpha: number
  tilt: number
  splay: number
  /** Socket mouth centre (on the boss face). */
  mouth: Vec3Like
  /** Unit axis out of the socket toward the foot (y, z). */
  dir: { y: number; z: number }
  /** Unit thickness direction (y, z). */
  perp: { y: number; z: number }
  pocketWidth: number
  pocketThickness: number
  pocketDepth: number
  legWidth: number
  legThickness: number
  /** Axis length from the mouth to the table. */
  legReach: number
  /** Side profile in (a, b): a along the leg from the tongue tip, b across its thickness. */
  profile: PlanVertex[]
  /** Frame lean when standing, and the leg's footprint behind the frame's back edge (mm). */
  footBehind: number
}

export function kickstandLayout(
  b: BacklightParams,
  socket: { x: number; y: number },
  frameBottomY: number,
): KickstandLayout {
  const tilt = (b.kickstandTilt * Math.PI) / 180
  const splay = (KICK_SPLAY_DEG * Math.PI) / 180
  const alpha = tilt + splay
  const ca = Math.cos(alpha)
  const sa = Math.sin(alpha)
  const pocketWidth = b.kickstandWidth + 2 * POCKET_CLEARANCE_MM
  const pocketThickness = b.kickstandThickness + 2 * POCKET_CLEARANCE_MM
  const D = POCKET_DEPTH_MM
  // Deepest pocket corner stays PANEL_SKIN in front of the panel's front face.
  const mz = b.panelThickness - PANEL_SKIN_MM - (pocketThickness / 2) * ca - D * sa
  const mouth = { x: socket.x, y: socket.y, z: mz }

  // Standing: pivot on the frame's back-bottom edge, lean back by tilt.
  const s = socket.y - frameBottomY
  const dP = -mz
  const yP = s * Math.cos(tilt) - dP * Math.sin(tilt)
  const hP = s * Math.sin(tilt) + dP * Math.cos(tilt)
  const cphi = Math.cos(splay)
  const sphi = Math.sin(splay)
  const legReach = Math.max(1, yP / cphi)
  const t = b.kickstandThickness
  const end = (bb: number) => D + (yP + bb * sphi) / cphi
  const tip = Math.min(0.6, t * 0.2)
  const profile: PlanVertex[] = [
    { x: tip, y: -t / 2 },
    { x: end(-t / 2), y: -t / 2 },
    { x: end(t / 2), y: t / 2 },
    { x: tip, y: t / 2 },
    { x: 0, y: t / 2 - tip },
    { x: 0, y: -t / 2 + tip },
  ]
  return {
    alpha,
    tilt,
    splay,
    mouth,
    dir: { y: -ca, z: -sa },
    perp: { y: sa, z: -ca },
    pocketWidth,
    pocketThickness,
    pocketDepth: D,
    legWidth: b.kickstandWidth,
    legThickness: t,
    legReach,
    profile,
    footBehind: hP + legReach * sphi,
  }
}

/** Column-major 4×4 mapping socket-local (X across, Y thickness, Z into the boss) to panel coordinates. */
export function socketMatrix(k: KickstandLayout): number[] {
  const ca = Math.cos(k.alpha)
  const sa = Math.sin(k.alpha)
  return [1, 0, 0, 0, 0, sa, -ca, 0, 0, ca, sa, 0, k.mouth.x, k.mouth.y, k.mouth.z, 1]
}

/** Column-major 4×4 placing the kickstand mesh (profile in XY, width along Z) into the socket. */
export function legMatrix(k: KickstandLayout): number[] {
  const D = k.pocketDepth
  const tx = k.mouth.x - k.legWidth / 2
  const ty = k.mouth.y - D * k.dir.y
  const tz = k.mouth.z - D * k.dir.z
  return [0, k.dir.y, k.dir.z, 0, 0, k.perp.y, k.perp.z, 0, 1, 0, 0, 0, tx, ty, tz, 1]
}
