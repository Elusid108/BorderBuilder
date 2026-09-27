import JSZip from 'jszip'
import { indexedBounds, type IndexedMesh } from '../geom/indexed.ts'

export interface ThreeMfPart {
  name: string
  mesh: IndexedMesh
  /** Print copies (build items sharing one object). */
  copies?: number
}

function num(n: number): string {
  const r = Math.round(n * 10000) / 10000
  return Object.is(r, -0) ? '0' : String(r)
}

function objectXml(id: number, part: ThreeMfPart, shift: { x: number; y: number; z: number }): string {
  const p = part.mesh.positions
  const ix = part.mesh.indices
  const chunks: string[] = [`<object id="${id}" type="model" name="${part.name}"><mesh><vertices>`]
  for (let i = 0; i < p.length; i += 3) {
    chunks.push(`<vertex x="${num(p[i]! - shift.x)}" y="${num(p[i + 1]! - shift.y)}" z="${num(p[i + 2]! - shift.z)}"/>`)
  }
  chunks.push('</vertices><triangles>')
  for (let t = 0; t < ix.length; t += 3) {
    chunks.push(`<triangle v1="${ix[t]}" v2="${ix[t + 1]}" v3="${ix[t + 2]}"/>`)
  }
  chunks.push('</triangles></mesh></object>')
  return chunks.join('')
}

/**
 * Minimal 3MF (core spec, millimetres). Each part is re-based to sit on z = 0
 * with its footprint at the origin, then laid out left to right with a gap so
 * the plate opens ready to slice.
 */
export async function buildThreeMf(parts: ThreeMfPart[], gap = 8): Promise<Uint8Array> {
  const objects: string[] = []
  const items: string[] = []
  let cursor = 0
  parts.forEach((part, k) => {
    const id = k + 1
    const b = indexedBounds(part.mesh)
    objects.push(objectXml(id, part, b.min))
    const w = b.max.x - b.min.x
    const h = b.max.y - b.min.y
    const copies = Math.max(1, part.copies ?? 1)
    for (let c = 0; c < copies; c++) {
      items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(cursor)} ${num(c * (h + gap))} 0"/>`)
    }
    cursor += w + gap
  })
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<metadata name="Application">BorderBuilder</metadata>' +
    `<resources>${objects.join('')}</resources><build>${items.join('')}</build></model>`
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  )
  zip.file('3D/3dmodel.model', model)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
