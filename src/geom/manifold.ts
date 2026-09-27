import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import type { IndexedMesh } from './indexed.ts'
import type { PlanVertex } from './types.ts'

export type Wasm = ManifoldToplevel
export type Manifold = InstanceType<Wasm['Manifold']>
export type CrossSection = InstanceType<Wasm['CrossSection']>

let wasmUrl: string | null = null
let ready: Promise<Wasm> | null = null
let loaded: Wasm | null = null

/** Browser builds pass the bundled `manifold.wasm` URL; Node finds it next to the module. */
export function setManifoldWasmUrl(url: string): void {
  wasmUrl = url
}

export function loadManifold(): Promise<Wasm> {
  if (!ready) {
    ready = Module(wasmUrl ? { locateFile: () => wasmUrl! } : undefined).then((wasm) => {
      wasm.setup()
      loaded = wasm
      return wasm
    })
  }
  return ready
}

export function toPolygon(loop: PlanVertex[]): [number, number][] {
  return loop.map((p) => [p.x, p.y])
}

export function fromPolygon(poly: readonly (readonly number[])[]): PlanVertex[] {
  return poly.map((p) => ({ x: p[0]!, y: p[1]! }))
}

export function manifoldToIndexed(m: Manifold): IndexedMesh {
  const mesh = m.getMesh()
  const np = mesh.numProp
  const nv = mesh.vertProperties.length / np
  let positions: Float32Array
  if (np === 3) {
    positions = new Float32Array(mesh.vertProperties)
  } else {
    positions = new Float32Array(nv * 3)
    for (let i = 0; i < nv; i++) {
      positions[i * 3] = mesh.vertProperties[i * np]!
      positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]!
      positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]!
    }
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) }
}

/** Throws if the mesh is not an oriented 2-manifold. */
export function indexedToManifold(wasm: Wasm, mesh: IndexedMesh): Manifold {
  const m = new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })
  m.merge()
  return new wasm.Manifold(m)
}

/** The kernel if `loadManifold()` already resolved (lets sync code take the exact path). */
export function loadedManifold(): Wasm | null {
  return loaded
}

/**
 * Exact outward offset with miter joins (Clipper2). Swallowtails in concave
 * corners are unioned away, which a per-vertex miter cannot do. Returns the
 * largest resulting loop, CCW.
 */
export function clipperOffset(wasm: Wasm, loop: PlanVertex[], delta: number, miterLimit = 4): PlanVertex[] | null {
  const cs = new wasm.CrossSection([toPolygon(loop)], 'Positive')
  const off = cs.offset(delta, 'Miter', miterLimit)
  let best: PlanVertex[] | null = null
  let bestArea = 0
  for (const poly of off.toPolygons()) {
    let a = 0
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!
      const q = poly[(i + 1) % poly.length]!
      a += p[0] * q[1] - q[0] * p[1]
    }
    if (a > bestArea) {
      bestArea = a
      best = fromPolygon(poly)
    }
  }
  cs.delete()
  off.delete()
  return best
}
