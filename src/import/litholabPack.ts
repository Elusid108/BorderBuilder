import JSZip from 'jszip'
import type { FrameParams } from '../geom/types.ts'

export const PROJECT_SCHEMA_VERSION = 1
export const LITHOPHANE_DEPTH_SLACK_MM = 0.4
/** Minimum XY gap added to LithoLab rabbet width so imported packs are not press-fit. */
export const PACK_XY_FIT_MM = 0.4
export const MIN_MOULDING_OVER_RABBET_MM = 8

export interface ProjectExportSettings {
  width: number
  height: number
  border: number
  pixelSizeMm: number
  borderHeightMm: number
  borderOverlapMm: number
  borderProfile: unknown
}

export interface ProjectGenerationSettings {
  plateThickness: number
  colorPixelWidth: number
  layerThickness: number
  layerCount: number
  pixelMode: string
  colorDistance: string
  maxColors: number
  minThickness: number
  maxThickness: number
}

export interface ProjectJsonV1 {
  version: number
  name: string
  unit: string
  photo: { file: string } | null
  mask: { file: string } | null
  export: ProjectExportSettings
  generation: ProjectGenerationSettings
}

export interface PackAssets {
  json: ProjectJsonV1
  name: string
  maskBlob: Blob | null
  maskedPngBlob: Blob | null
  photoBlob: Blob | null
}

interface ZipEntry {
  path: string
  file: JSZip.JSZipObject
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function entriesOf(zip: JSZip): ZipEntry[] {
  return Object.keys(zip.files)
    .filter((path) => !zip.files[path]?.dir)
    .map((path) => ({ path: normalizePath(path), file: zip.files[path]! }))
}

function findFirst(list: ZipEntry[], re: RegExp): ZipEntry | undefined {
  return list.find((e) => re.test(e.path))
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

async function blobOf(file: JSZip.JSZipObject, mime: string): Promise<Blob> {
  return file.async('blob').then((b) => (b.type ? b : new Blob([b], { type: mime })))
}

function mimeFor(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

function asProjectJson(parsed: unknown): ProjectJsonV1 {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid project.json.')
  }
  const version = (parsed as { version?: unknown }).version
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported LithoLab project version (${String(version)}). This app reads version ${PROJECT_SCHEMA_VERSION}.`,
    )
  }
  const json = parsed as ProjectJsonV1
  if (!json.export || typeof json.export.width !== 'number' || typeof json.export.height !== 'number') {
    throw new Error('project.json is missing export width/height.')
  }
  return json
}

async function readProjectJson(list: ZipEntry[]): Promise<ProjectJsonV1 | null> {
  const entry = findFirst(list, /(^|\/)project\.json$/i)
  if (!entry) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(await entry.file.async('string')) as unknown
  } catch {
    throw new Error('Invalid project.json (could not parse).')
  }
  return asProjectJson(parsed)
}

function pickMask(outer: ZipEntry[], inner: ZipEntry[]): ZipEntry | undefined {
  return (
    findFirst(outer, /(^|\/)original-mask\.(png|jpe?g|webp)$/i) ??
    findFirst(inner, /(^|\/)mask\.(png|jpe?g|webp)$/i) ??
    findFirst(inner, /(^|\/)original-mask\.(png|jpe?g|webp)$/i) ??
    findFirst(outer, /(^|\/)mask\.(png|jpe?g|webp)$/i)
  )
}

function pickMasked(outer: ZipEntry[], inner: ZipEntry[]): ZipEntry | undefined {
  return (
    findFirst(outer, /(^|\/)original-masked\.png$/i) ?? findFirst(inner, /(^|\/)original-masked\.png$/i)
  )
}

function pickPhoto(outer: ZipEntry[], inner: ZipEntry[]): ZipEntry | undefined {
  return (
    findFirst(outer, /(^|\/)original-photo\.(png|jpe?g|webp)$/i) ??
    findFirst(inner, /(^|\/)photo\.(png|jpe?g|webp)$/i) ??
    findFirst(inner, /(^|\/)original-photo\.(png|jpe?g|webp)$/i)
  )
}

/**
 * Unpack a LithoLab STL zip (v2.5.10 folders or older flat layout) or a bare
 * `.litholab` project zip. Ignores `stl/` meshes.
 */
export async function unpackLitholabPack(data: Blob | ArrayBuffer | Uint8Array): Promise<PackAssets> {
  const outer = await JSZip.loadAsync(data)
  const outerList = entriesOf(outer)

  const rootProject = await readProjectJson(outerList)
  let innerList: ZipEntry[] = []
  let json = rootProject

  if (!json) {
    const litho = findFirst(outerList, /(?<!\/stl\/)[^/]+\.litholab$/i) ?? findFirst(outerList, /\.litholab$/i)
    if (!litho) {
      throw new Error('Not a LithoLab pack (missing .litholab project or project.json).')
    }
    const nested = await JSZip.loadAsync(await litho.file.async('arraybuffer'))
    innerList = entriesOf(nested)
    json = await readProjectJson(innerList)
  } else {
    innerList = outerList
  }

  if (!json) throw new Error('Not a valid LithoLab project (missing project.json).')

  const mask = pickMask(outerList, innerList)
  const masked = pickMasked(outerList, innerList)
  const photo = pickPhoto(outerList, innerList)

  const name = (json.name && json.name.trim()) || 'lithophane'

  return {
    json,
    name,
    maskBlob: mask ? await blobOf(mask.file, mimeFor(mask.path)) : null,
    maskedPngBlob: masked ? await blobOf(masked.file, 'image/png') : null,
    photoBlob: photo ? await blobOf(photo.file, mimeFor(photo.path)) : null,
  }
}

export function lithophaneStackHeightMm(json: ProjectJsonV1): number {
  const g = json.generation
  const plate = Number(g?.plateThickness) || 0
  const layers = Number(g?.layerCount) || 0
  const thick = Number(g?.layerThickness) || 0
  const texture = Number(g?.maxThickness) || 0
  const borderH = Number(json.export.borderHeightMm) || 0
  return plate + layers * thick + Math.max(texture, borderH)
}

function roundMm(n: number): number {
  return Math.round(n * 100) / 100
}

export function mapPackToFrameParams(json: ProjectJsonV1, current: FrameParams): FrameParams {
  const destW = roundMm(json.export.width)
  const destH = roundMm(json.export.height)
  const border = Math.max(0, json.export.border)
  const fit = Math.max(PACK_XY_FIT_MM, current.fitClearance)
  const rabbetWidth = Math.max(0.1, border + fit)
  const rabbetDepth = Math.max(0.1, lithophaneStackHeightMm(json) + LITHOPHANE_DEPTH_SLACK_MM)

  let mouldingWidth = current.mouldingWidth
  if (mouldingWidth <= rabbetWidth) {
    mouldingWidth = rabbetWidth + MIN_MOULDING_OVER_RABBET_MM
  }

  let mouldingHeight = current.mouldingHeight
  if (rabbetDepth >= mouldingHeight) {
    mouldingHeight = rabbetDepth + 4
  }

  return {
    ...current,
    shape: 'imported',
    sightWidth: destW,
    sightHeight: destH,
    rabbetWidth,
    rabbetDepth,
    rabbetStack: { ...current.rabbetStack, enabled: false },
    mouldingWidth,
    mouldingHeight,
  }
}

export function silhouetteSizeMm(
  json: ProjectJsonV1,
  maskedPixels?: { width: number; height: number } | null,
): { width: number; height: number } {
  const px = json.export.pixelSizeMm
  if (maskedPixels && px > 0) {
    return { width: maskedPixels.width * px, height: maskedPixels.height * px }
  }
  const border = Math.max(0, json.export.border)
  return { width: json.export.width + 2 * border, height: json.export.height + 2 * border }
}

export function packDisplayName(assets: PackAssets, fileName?: string): string {
  if (assets.name) return assets.name
  if (fileName) return stripExt(basename(fileName))
  return 'Imported'
}
