import type { Mesh, Vec3 } from './types.ts'

function normalOf(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const uz = b.z - a.z
  const vx = c.x - a.x
  const vy = c.y - a.y
  const vz = c.z - a.z
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-12) return { x: 0, y: 0, z: 0 }
  return { x: nx / len, y: ny / len, z: nz / len }
}

function writeVec(view: DataView, offset: number, v: Vec3): void {
  view.setFloat32(offset, v.x, true)
  view.setFloat32(offset + 4, v.y, true)
  view.setFloat32(offset + 8, v.z, true)
}

export function meshToBinaryStl(mesh: Mesh, header = 'BorderBuilder'): ArrayBuffer {
  const count = mesh.triangles.length
  const buffer = new ArrayBuffer(84 + count * 50)
  const view = new DataView(buffer)
  const bytes = new TextEncoder().encode(header)
  for (let i = 0; i < 80; i++) view.setUint8(i, i < bytes.length ? bytes[i]! : 0x20)
  view.setUint32(80, count, true)

  let offset = 84
  for (const t of mesh.triangles) {
    writeVec(view, offset, normalOf(t.a, t.b, t.c))
    writeVec(view, offset + 12, t.a)
    writeVec(view, offset + 24, t.b)
    writeVec(view, offset + 36, t.c)
    view.setUint16(offset + 48, 0, true)
    offset += 50
  }
  return buffer
}

export function downloadStl(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'model/stl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
