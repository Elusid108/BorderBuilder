import JSZip from 'jszip'
import { deriveSizes } from './derived.ts'
import { buildFrame } from './frame.ts'
import { extractMaskPolygons, sightFromMaskImage } from './maskTrace.ts'
import { sweepTransportedProfile } from './pathSweep.ts'
import { ensureCcw } from './plan.ts'
import { buildProfile } from './profiles.ts'
import { buildRectFrame } from './rectFrame.ts'
import { meshToBinaryStl } from './stl.ts'
import { DEFAULT_PARAMS, PROFILE_DEFS, type FrameParams, type PlanVertex, type ProfileId } from './types.ts'
import { inspectMesh } from './validate.ts'
import { mapPackToFrameParams, unpackLitholabPack, type ProjectJsonV1 } from '../import/litholabPack.ts'

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

/** Classic cardioid-style heart, plus a V-notch dart for a sharp cleft. */
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

function checkOrganic(label: string, sight: PlanVertex[], params: FrameParams, expectOuter: number): void {
  const mesh = sweepTransportedProfile(sight, buildProfile(params))
  const report = inspectMesh(mesh)
  assert(report.triangleCount > 32, `${label}: too few triangles`)
  assert(
    report.watertight,
    `${label}: mesh is not watertight (open=${report.openEdges}, nm=${report.nonManifoldEdges})`,
  )
  const { min, max } = report.bounds
  const w = max.x - min.x
  const h = max.y - min.y
  assert(nearly(w, expectOuter, 1.2), `${label}: outer width ${w} != ~${expectOuter}`)
  assert(nearly(h, expectOuter, 1.2) || h > params.sightHeight, `${label}: unexpected outer height ${h}`)
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
  assert(nearly(mapped.rabbetWidth, 3 + DEFAULT_PARAMS.fitClearance), 'map: rabbet width = border + fit')
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
  const sight = sightFromMaskImage(img, dest, dest)
  assert(sight.length >= 16, 'mask trace: too few verts')
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

const profiles: ProfileId[] = PROFILE_DEFS.map((d) => d.id)
for (const profile of profiles) {
  checkRect({ ...DEFAULT_PARAMS, profile }, profile)
  checkRect({ ...DEFAULT_PARAMS, profile, faceDepth: 0 }, `${profile}-flat-face`)
  checkRect({ ...DEFAULT_PARAMS, profile, faceDepth: 1, lipWidth: 0 }, `${profile}-full-no-lip`)
}

checkRect(
  { ...DEFAULT_PARAMS, shape: 'square', sightWidth: 80, sightHeight: 999, profile: 'flat' },
  'square-lock',
)

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
checkOrganic('circle-transport', circlePoly(50), organicParams, 100 + 2 * 12)

const dartParams: FrameParams = { ...organicParams, sightWidth: 72, sightHeight: 84, profile: 'chamfer' }
const dartMesh = buildFrame({ ...dartParams, shape: 'imported' }, dartPoly())
const dartReport = inspectMesh(dartMesh)
assert(dartReport.watertight, `dart: not watertight open=${dartReport.openEdges} nm=${dartReport.nonManifoldEdges}`)
assert(dartReport.triangleCount > 32, 'dart: too few triangles')
console.log(`ok  dart-transport: ${dartReport.triangleCount} tris`)

await checkPackRoundtrip()

console.log('geometry self-check passed')
