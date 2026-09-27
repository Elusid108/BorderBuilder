/**
 * Wall-clock timings for representative builds. `npm run bench:geom`.
 * Fixtures mirror selfcheck.ts; numbers are for before/after comparisons, not assertions.
 */
import { buildFrame } from './frame.ts'
import { ensureCcw } from './plan.ts'
import { suggestedImportedOuter } from './rectFrame.ts'
import { DEFAULT_PARAMS, type FrameParams, type PlanVertex, type ProfileId } from './types.ts'
import { packOutlineFromPlan } from '../import/litholabPack.ts'
import { loadManifold } from './manifold.ts'

await loadManifold()

function heartPoly(scale = 3.4, n = 200): PlanVertex[] {
  const pts: PlanVertex[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const s = Math.sin(t)
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    pts.push({ x: 16 * s * s * s * scale, y: y * scale })
  }
  return ensureCcw(pts)
}

function gearPoly(rInner = 32, rOuter = 48, teeth = 8): PlanVertex[] {
  const pts: PlanVertex[] = []
  const step = (Math.PI * 2) / teeth
  for (let t = 0; t < teeth; t++) {
    const a0 = t * step
    const aTooth = a0 + step * 0.42
    const a1 = a0 + step
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (aTooth - a0) * (i / 6)
      pts.push({ x: rOuter * Math.cos(a), y: rOuter * Math.sin(a) })
    }
    for (let i = 1; i <= 6; i++) {
      const a = aTooth + (a1 - aTooth) * (i / 6)
      pts.push({ x: rInner * Math.cos(a), y: rInner * Math.sin(a) })
    }
  }
  return ensureCcw(pts)
}

function letterA(size = 100): PlanVertex[] {
  return ensureCcw(
    [
      [0.18, 0.92],
      [0.5, 0.08],
      [0.82, 0.92],
      [0.68, 0.92],
      [0.58, 0.58],
      [0.42, 0.58],
      [0.32, 0.92],
    ].map(([x, y]) => ({ x: (x! - 0.5) * size, y: (0.5 - y!) * size })),
  )
}

const base: FrameParams = {
  ...DEFAULT_PARAMS,
  shape: 'imported',
  sightWidth: 110,
  sightHeight: 100,
  mouldingWidth: 20,
  mouldingHeight: 15,
  rabbetWidth: 3.8,
  rabbetDepth: 4,
  fitClearance: 0.8,
}

function time(label: string, fn: () => number): void {
  fn()
  const runs = 3
  const t0 = performance.now()
  let tris = 0
  for (let i = 0; i < runs; i++) tris = fn()
  const ms = (performance.now() - t0) / runs
  console.log(`${label.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms  ${tris} tris`)
}

const cases: { name: string; sight: PlanVertex[] }[] = [
  { name: 'heart', sight: heartPoly() },
  { name: 'gear', sight: gearPoly() },
  { name: 'letter-A', sight: letterA() },
]
const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
const extra = (argv[2] ?? '').split(',').filter(Boolean)

for (const c of cases) {
  const pack = packOutlineFromPlan(c.sight, 3)
  for (const profile of ['flat', 'ogee'] as ProfileId[]) {
    time(`${c.name} pack ${profile}`, () => buildFrame({ ...base, profile, packBorder: 3 }, c.sight, pack).triangles.length)
    if (extra.includes('backlight')) {
      time(`${c.name} pack ${profile} backlight`, () =>
        buildFrame({ ...base, profile, packBorder: 3, backlight: { ...base.backlight, enabled: true } }, c.sight, pack).triangles
          .length,
      )
    }
  }
  const rect = suggestedImportedOuter(c.sight, 20, 'rectangle')
  time(`${c.name} rect outer`, () =>
    buildFrame({ ...base, packBorder: 3, shape: "rectangle", ...rect }, c.sight, pack).triangles.length,
  )
}
