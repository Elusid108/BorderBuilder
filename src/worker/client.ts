import type { FrameParams } from '../geom/types.ts'
import type { BuildResult, ImportGeometry, WorkerRequest, WorkerResponse } from './protocol.ts'

/**
 * Main-thread handle on the geometry worker. Builds are latest-wins: while one
 * runs, only the newest request waits; anything older is dropped.
 */
export class BuildClient {
  private readonly worker: Worker
  private nextId = 1
  private busy = false
  private pending: { params: FrameParams; resolve: (r: BuildResult | null) => void } | null = null
  private readonly waiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  constructor() {
    this.worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data)
  }

  setImport(geometry: ImportGeometry | null): void {
    this.send({ type: 'import', geometry })
  }

  /** Resolves with the result, or null when a newer build superseded this one. */
  build(params: FrameParams): Promise<BuildResult | null> {
    return new Promise((resolve) => {
      if (this.busy) {
        this.pending?.resolve(null)
        this.pending = { params, resolve }
        return
      }
      this.start(params, resolve)
    })
  }

  packageKit(baseName: string, header: string): Promise<Uint8Array> {
    const id = this.nextId++
    return this.request(id, { type: 'package', id, baseName, header }) as Promise<Uint8Array>
  }

  frameStl(header: string): Promise<ArrayBuffer> {
    const id = this.nextId++
    return this.request(id, { type: 'stl', id, header }) as Promise<ArrayBuffer>
  }

  private start(params: FrameParams, resolve: (r: BuildResult | null) => void): void {
    this.busy = true
    const id = this.nextId++
    this.request(id, { type: 'build', id, params })
      .then((r) => resolve(r as BuildResult))
      .catch((err: Error) =>
        resolve({ issues: [err.message], frame: null, triangleCount: 0, watertight: false, backlight: null, warnings: [], ms: 0 }),
      )
      .finally(() => {
        this.busy = false
        const next = this.pending
        this.pending = null
        if (next) this.start(next.params, next.resolve)
      })
  }

  private request(id: number, msg: WorkerRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
      this.send(msg)
    })
  }

  private send(msg: WorkerRequest): void {
    this.worker.postMessage(msg)
  }

  private onMessage(msg: WorkerResponse): void {
    const w = this.waiters.get(msg.id)
    if (!w) return
    this.waiters.delete(msg.id)
    if (msg.type === 'error') w.reject(new Error(msg.message))
    else if (msg.type === 'built') w.resolve(msg.result)
    else if (msg.type === 'package') w.resolve(msg.zip)
    else w.resolve(msg.stl)
  }
}
