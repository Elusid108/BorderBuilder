import { deriveSizes, maxLipWidth, validateParams } from './geom/derived.ts'
import { buildFrame, downloadName, frameSummary, importedFrameSummary } from './geom/frame.ts'
import { extractMaskPolygons, sightFromMaskImage, sightFromPixelLoops } from './geom/maskTrace.ts'
import { buildProfile } from './geom/profiles.ts'
import { downloadStl, meshToBinaryStl } from './geom/stl.ts'
import { DEFAULT_PARAMS, PROFILE_DEFS, PROFILE_GROUPS, type FrameParams, type Mesh, type PlanVertex } from './geom/types.ts'
import { isPolygonalOutline } from './geom/plan.ts'
import { inspectMesh } from './geom/validate.ts'
import { rgbaFromBlob } from './import/imageData.ts'
import { mapPackToFrameParams, silhouetteSizeMm, unpackLitholabPack } from './import/litholabPack.ts'
import { FrameViewer } from './preview/viewer.ts'
import { readParams, writeParams } from './ui/params.ts'
import { renderProfileSketch } from './ui/profileSketch.ts'
import { APP_LABEL, STL_HEADER } from './version.ts'
import './style.css'

interface ImportState {
  name: string
  sourceFile: string
  sight: PlanVertex[]
  silhouetteWidth: number
  silhouetteHeight: number
  artworkUrl: string | null
}

function requireEl<T extends Element>(el: T | null, name: string): T {
  if (!el) throw new Error(`BorderBuilder markup is missing #${name}.`)
  return el
}

const form = requireEl(document.querySelector<HTMLFormElement>('#controls'), 'controls')
const previewHost = requireEl(document.querySelector<HTMLElement>('#preview'), 'preview')
const statusEl = requireEl(document.querySelector<HTMLElement>('#status'), 'status')
const issuesEl = requireEl(document.querySelector<HTMLElement>('#issues'), 'issues')
const downloadBtn = requireEl(document.querySelector<HTMLButtonElement>('#download'), 'download')
const resetBtn = document.querySelector<HTMLButtonElement>('#reset')
const profileSelect = requireEl(document.querySelector<HTMLSelectElement>('#profile'), 'profile')
const profileHint = document.querySelector<HTMLElement>('#profile-hint')
const profileSvg = document.querySelector<SVGSVGElement>('#profile-sketch')
const heightInput = document.querySelector<HTMLInputElement>('#sight-height')
const widthInput = document.querySelector<HTMLInputElement>('#sight-width')
const heightField = document.querySelector<HTMLElement>('#sight-height-field')
const widthField = widthInput?.closest('.field')
const stackPanel = document.querySelector<HTMLElement>('#stack-fields')
const depthInput = document.querySelector<HTMLInputElement>('#rabbet-depth')
const stackEnabled = document.querySelector<HTMLInputElement>('#stack-enabled')
const lipInput = document.querySelector<HTMLInputElement>('#lip-width')
const faceDepthInput = document.querySelector<HTMLInputElement>('#face-depth')
const lipReadout = document.querySelector<HTMLElement>('#lip-width-readout')
const faceDepthReadout = document.querySelector<HTMLElement>('#face-depth-readout')
const packInput = document.querySelector<HTMLInputElement>('#pack-input')
const importBtn = document.querySelector<HTMLButtonElement>('#import-pack')
const clearImportBtn = document.querySelector<HTMLButtonElement>('#clear-import')
const importStatus = document.querySelector<HTMLElement>('#import-status')
const shapeGroup = document.querySelector<HTMLElement>('#shape-group')
const importedLabel = document.querySelector<HTMLElement>('#shape-imported-label')
const importedNameEl = document.querySelector<HTMLElement>('#shape-imported-name')
const versionEl = document.querySelector<HTMLElement>('#app-version')
if (versionEl) versionEl.textContent = APP_LABEL
const versionFoot = document.querySelector<HTMLElement>('#app-version-foot')
if (versionFoot) versionFoot.textContent = APP_LABEL
document.title = `BorderBuilder ${APP_LABEL}`

for (const group of PROFILE_GROUPS) {
  const og = document.createElement('optgroup')
  og.label = group.label
  for (const def of PROFILE_DEFS.filter((d) => d.group === group.id)) {
    const opt = document.createElement('option')
    opt.value = def.id
    opt.textContent = def.label
    og.appendChild(opt)
  }
  profileSelect.appendChild(og)
}

writeParams(form, DEFAULT_PARAMS)

const viewer = new FrameViewer(previewHost)
let lastMesh: Mesh | null = null
let lastParams: FrameParams | null = null
let imported: ImportState | null = null
let timer = 0

function syncShapeLock(): void {
  const shape = form.querySelector<HTMLInputElement>('input[name="shape"]:checked')?.value
  const importedOn = shape === 'imported'
  const square = shape === 'square'
  if (widthInput) widthInput.disabled = importedOn
  if (heightInput) heightInput.disabled = importedOn || square
  widthField?.classList.toggle('is-locked', importedOn)
  heightField?.classList.toggle('is-locked', importedOn || square)
  if (square && !importedOn && heightInput && widthInput) {
    heightInput.value = widthInput.value
  }
}

function syncImportUi(): void {
  const on = imported !== null
  shapeGroup?.classList.toggle('is-imported', on)
  if (importedLabel) importedLabel.hidden = !on
  if (importedNameEl) importedNameEl.textContent = imported?.name ?? 'Imported'
  if (clearImportBtn) clearImportBtn.hidden = !on
  if (importStatus) {
    if (on && imported) {
      importStatus.hidden = false
      importStatus.classList.remove('is-error')
      importStatus.textContent = `${imported.sourceFile} · ${formatMm(imported.silhouetteWidth)} × ${formatMm(imported.silhouetteHeight)} mm silhouette`
    } else if (!importStatus.classList.contains('is-error')) {
      importStatus.hidden = true
      importStatus.textContent = ''
    }
  }
}

function syncFaceSliders(): void {
  const mouldingWidth = Number(form.querySelector<HTMLInputElement>('#moulding-width')?.value)
  const maxLip = maxLipWidth(Number.isFinite(mouldingWidth) ? mouldingWidth : DEFAULT_PARAMS.mouldingWidth)
  if (lipInput) {
    lipInput.max = String(Math.round(maxLip * 10) / 10)
    const current = lipInput.valueAsNumber
    if (Number.isFinite(current) && current > maxLip) lipInput.value = String(maxLip)
    if (lipReadout) {
      const used = Number.isFinite(lipInput.valueAsNumber) ? lipInput.valueAsNumber : 0
      lipReadout.textContent = `${formatMm(used)} mm`
    }
  }
  if (faceDepthInput && faceDepthReadout) {
    const depth = Number.isFinite(faceDepthInput.valueAsNumber) ? faceDepthInput.valueAsNumber : 0
    faceDepthReadout.textContent = `${Math.round(depth * 100)}%`
  }
}

function syncStackLock(): void {
  const on = stackEnabled?.checked ?? false
  stackPanel?.classList.toggle('is-open', on)
  if (depthInput) depthInput.disabled = on
  if (on && depthInput) {
    const params = readParams(form)
    const derived = deriveSizes(params)
    depthInput.value = formatMm(derived.effectiveRabbetDepth)
  }
}

function formatMm(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

function setReadout(id: string, value: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

function updateReadouts(params: FrameParams): void {
  const d = deriveSizes(params)
  setReadout('out-outer', `${formatMm(d.outerWidth)} × ${formatMm(d.outerHeight)} mm`)
  setReadout('out-pocket', `${formatMm(d.pocketWidth)} × ${formatMm(d.pocketHeight)} mm`)
  setReadout('out-glass', `${formatMm(d.glassWidth)} × ${formatMm(d.glassHeight)} mm`)
  setReadout('out-depth', `${formatMm(d.effectiveRabbetDepth)} mm`)
  setReadout('out-stack', `${formatMm(d.stackTotal)} mm`)
}

function setIssues(messages: string[]): void {
  issuesEl.replaceChildren()
  issuesEl.hidden = messages.length === 0
  for (const message of messages) {
    const li = document.createElement('li')
    li.textContent = message
    issuesEl.appendChild(li)
  }
}

function setImportError(message: string): void {
  if (!importStatus) return
  importStatus.hidden = false
  importStatus.classList.add('is-error')
  importStatus.textContent = message
}

function clearImport(writeDefaultShape = true): void {
  if (imported?.artworkUrl) URL.revokeObjectURL(imported.artworkUrl)
  imported = null
  viewer.clearArtwork()
  if (writeDefaultShape) {
    const rect = form.querySelector<HTMLInputElement>('input[name="shape"][value="rectangle"]')
    if (rect) rect.checked = true
  }
  syncImportUi()
}

function syncArtwork(params: FrameParams): void {
  if (!imported?.artworkUrl) {
    viewer.clearArtwork()
    return
  }
  const z = Math.max(0.05, deriveSizes(params).effectiveRabbetDepth - 0.05)
  viewer.setArtwork({
    url: imported.artworkUrl,
    width: imported.silhouetteWidth,
    height: imported.silhouetteHeight,
    z,
  })
}

function rebuild(fitNote?: string): void {
  const shape = form.querySelector<HTMLInputElement>('input[name="shape"]:checked')?.value
  if (shape !== 'imported' && imported) clearImport(false)

  syncShapeLock()
  syncStackLock()
  syncFaceSliders()
  const params = readParams(form)
  const issues = validateParams(params)
  updateReadouts(params)

  const def = PROFILE_DEFS.find((p) => p.id === params.profile)
  if (profileHint) profileHint.textContent = def?.description ?? ''
  if (profileSvg) renderProfileSketch(profileSvg, buildProfile(params))

  if (issues.length > 0) {
    setIssues(issues.map((i) => i.message))
    statusEl.textContent = 'Fix the highlighted sizes to rebuild the frame.'
    downloadBtn.disabled = true
    return
  }

  try {
    const mesh = buildFrame(params, imported?.sight)
    const report = inspectMesh(mesh)
    viewer.setMesh(mesh, { smooth: params.shape === 'imported' && !isPolygonalOutline(imported?.sight ?? []) })
    syncArtwork(params)
    lastMesh = mesh
    lastParams = params
    downloadBtn.disabled = false
    setIssues(report.watertight ? [] : ['Mesh is not watertight — check profile parameters.'])
    const extra = fitNote ? ` ${fitNote}` : ''
    const summary =
      params.shape === 'imported' && imported
        ? importedFrameSummary(params, imported.name)
        : frameSummary(params)
    statusEl.textContent = `${summary} · ${report.triangleCount} triangles${extra}`
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not build the frame.'
    setIssues([message])
    statusEl.textContent = 'Geometry error'
    downloadBtn.disabled = true
  }
}

function scheduleRebuild(): void {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => rebuild(), 60)
}

async function importPackFile(file: File): Promise<void> {
  statusEl.textContent = `Reading ${file.name}…`
  const assets = await unpackLitholabPack(file)
  const current = readParams(form)
  const base: FrameParams = {
    ...current,
    shape: current.shape === 'imported' ? 'rectangle' : current.shape,
  }
  const params = mapPackToFrameParams(assets.json, base)
  const destW = assets.json.export.width
  const destH = assets.json.export.height

  let maskedImg = assets.maskedPngBlob ? await rgbaFromBlob(assets.maskedPngBlob) : null
  let sight: PlanVertex[]
  if (assets.maskBlob) {
    sight = sightFromMaskImage(await rgbaFromBlob(assets.maskBlob), destW, destH)
  } else if (maskedImg) {
    sight = sightFromPixelLoops(extractMaskPolygons(maskedImg, { smoothIters: 0 }), assets.json.export.pixelSizeMm || 0.2)
  } else {
    throw new Error('This pack has no mask or original-masked.png to trace.')
  }

  const sil = silhouetteSizeMm(
    assets.json,
    maskedImg ? { width: maskedImg.width, height: maskedImg.height } : null,
  )

  if (imported?.artworkUrl) URL.revokeObjectURL(imported.artworkUrl)
  const artworkBlob = assets.maskedPngBlob ?? assets.photoBlob
  imported = {
    name: assets.name,
    sourceFile: file.name,
    sight,
    silhouetteWidth: sil.width,
    silhouetteHeight: sil.height,
    artworkUrl: artworkBlob ? URL.createObjectURL(artworkBlob) : null,
  }

  writeParams(form, params)
  if (importStatus) importStatus.classList.remove('is-error')
  syncImportUi()
  rebuild(`· from ${file.name}`)
}

form.addEventListener('input', scheduleRebuild)
form.addEventListener('change', scheduleRebuild)

downloadBtn.addEventListener('click', () => {
  if (!lastMesh || !lastParams) return
  const name = downloadName(lastParams, imported?.name)
  downloadStl(meshToBinaryStl(lastMesh, STL_HEADER), name)
})

resetBtn?.addEventListener('click', () => {
  clearImport(false)
  writeParams(form, DEFAULT_PARAMS)
  rebuild()
})

importBtn?.addEventListener('click', () => packInput?.click())
packInput?.addEventListener('change', () => {
  const file = packInput.files?.[0]
  packInput.value = ''
  if (!file) return
  void importPackFile(file).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'Could not import that pack.'
    setImportError(message)
    statusEl.textContent = 'Import failed'
  })
})

clearImportBtn?.addEventListener('click', () => {
  clearImport(true)
  rebuild()
})

syncImportUi()
rebuild()
