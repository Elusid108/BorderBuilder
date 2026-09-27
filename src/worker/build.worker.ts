/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildKitPackage } from '../export/kitPackage.ts'
import { frameIssues } from '../geom/frame.ts'
import { creasedNormals, inspectIndexed, type IndexedMesh } from '../geom/indexed.ts'
import { loadManifold, setManifoldWasmUrl } from '../geom/manifold.ts'
import { buildKit, drillPilotHoles, type Kit } from '../geom/parts/kit.ts'
import { isPolygonalOutline, loopBounds } from '../geom/plan.ts'
import { indexedToBinaryStl } from '../geom/stl.ts'
import type { FrameParams } from '../geom/types.ts'
import type { BuildResult, ImportGeometry, MeshData, WorkerRequest, WorkerResponse } from './protocol.ts'

setManifoldWasmUrl(wasmUrl)
// Load the kernel up front so sync ring offsets can use Clipper2 from the first build.
void loadManifold()

const ctx = self as unknown as DedicatedWorkerGlobalScope
// Imported geometry lives here so the ring / offset caches (keyed by array identity) survive rebuilds.
let geometry: ImportGeometry | null = null
let last: { kit: Kit; params: FrameParams; drilled?: IndexedMesh } | null = null

/** The export frame (with pilot holes), computed once per build. */
async function exportKit(): Promise<Kit> {
  if (!last) throw new Error('Nothing built yet.')
  last.drilled ??= await drillPilotHoles(last.kit)
  return { ...last.kit, frame: last.drilled }
}

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer)
}

function copyMesh(m: IndexedMesh, transfer: Transferable[]): MeshData {
  const positions = new Float32Array(m.positions)
  const indices = new Uint32Array(m.indices)
  transfer.push(positions.buffer, indices.buffer)
  return { positions, indices }
}

async function build(id: number, params: FrameParams): Promise<void> {
  const t0 = performance.now()
  await loadManifold()
  const issues = frameIssues(params, geometry?.sight)
  if (issues.length > 0) {
    const result: BuildResult = {
      issues: issues.map((i) => i.message),
      frame: null,
      triangleCount: 0,
      watertight: false,
      backlight: null,
      warnings: [],
      ms: performance.now() - t0,
    }
    post({ type: 'built', id, result })
    return
  }
  const kit = await buildKit(
    { params, sight: geometry?.sight, holes: geometry?.holes, packOutline: geometry?.packOutline },
    { skipValidation: true },
  )
  last = { kit, params }
  const report = inspectIndexed(kit.frame)
  const transfer: Transferable[] = []
  const bl = kit.backlight
  let backlight: BuildResult['backlight'] = null
  if (bl) {
    const score = new Float32Array(bl.scoreSegments.length * 4)
    bl.scoreSegments.forEach((s, i) => score.set([s.a.x, s.a.y, s.b.x, s.b.y], i * 4))
    transfer.push(score.buffer)
    const ab = loopBounds(bl.acrylicOutline)
    const pb = loopBounds(bl.panelOutline)
    backlight = {
      panel: copyMesh(bl.panel, transfer),
      acrylic: copyMesh(bl.preview.acrylic, transfer),
      led: copyMesh(bl.preview.led, transfer),
      kickstand: bl.preview.kickstand ? copyMesh(bl.preview.kickstand, transfer) : null,
      buttons: bl.preview.buttons ? copyMesh(bl.preview.buttons, transfer) : null,
      score,
      bands: bl.bands,
      acrylicSize: [ab.maxX - ab.minX, ab.maxY - ab.minY],
      panelSize: [pb.maxX - pb.minX, pb.maxY - pb.minY],
      ledStripLength: bl.ledStripLength,
      scoreLines: bl.scoreSegments.length,
      buttonCount: bl.buttonPivots.length,
      kickstandLength: bl.kickstandLayout ? bl.kickstandLayout.pocketDepth + bl.kickstandLayout.legReach : null,
    }
  }
  // Organic frames and circles preview with creased smooth normals (computed here, off the UI thread).
  const smooth = params.shape === 'circle' || (!!geometry && !isPolygonalOutline(geometry.sight))
  let frame: MeshData
  if (smooth) {
    const { positions, normals } = creasedNormals(kit.frame)
    transfer.push(positions.buffer, normals.buffer)
    frame = { positions, indices: new Uint32Array(0), normals }
  } else {
    frame = copyMesh(kit.frame, transfer)
  }
  const result: BuildResult = {
    issues: [],
    frame,
    triangleCount: report.triangleCount,
    watertight: report.watertight,
    backlight,
    warnings: kit.warnings,
    ms: performance.now() - t0,
  }
  post({ type: 'built', id, result }, transfer)
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'import':
        geometry = msg.geometry
        last = null
        return
      case 'build':
        await build(msg.id, msg.params)
        return
      case 'package': {
        const kit = await exportKit()
        const zip = await buildKitPackage({ kit, params: last!.params, baseName: msg.baseName, header: msg.header })
        post({ type: 'package', id: msg.id, zip }, [zip.buffer])
        return
      }
      case 'stl': {
        const kit = await exportKit()
        const stl = indexedToBinaryStl(kit.frame, msg.header)
        post({ type: 'stl', id: msg.id, stl }, [stl])
        return
      }
    }
  } catch (err) {
    const id = 'id' in msg ? msg.id : -1
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) })
  }
}
