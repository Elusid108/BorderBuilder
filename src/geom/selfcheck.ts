import { deriveSizes } from './derived.ts'
import { buildProfile } from './profiles.ts'
import { buildRectFrame } from './rectFrame.ts'
import { meshToBinaryStl } from './stl.ts'
import { DEFAULT_PARAMS, type FrameParams, type ProfileId } from './types.ts'
import { inspectMesh } from './validate.ts'

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

function nearly(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps
}

function check(params: FrameParams, label: string): void {
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

const profiles: ProfileId[] = ['flat', 'cove', 'ogee', 'chamfer']
for (const profile of profiles) {
  check({ ...DEFAULT_PARAMS, profile }, profile)
}

check(
  { ...DEFAULT_PARAMS, shape: 'square', sightWidth: 80, sightHeight: 999, profile: 'flat' },
  'square-lock',
)

check(
  {
    ...DEFAULT_PARAMS,
    rabbetStack: { enabled: true, glass: 2, mat: 1, backing: 1.5, clearance: 0.5 },
    profile: 'ogee',
  },
  'stacked-rabbet',
)

console.log('geometry self-check passed')
