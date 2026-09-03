import { deriveSizes, maxLipWidth, validateParams } from './geom/derived.ts'
import { buildFrame, downloadName, frameSummary, importedFrameSummary } from './geom/frame.ts'
import {
  extractMaskPolygons,
  sightFromMaskImage,
  sightFromPixelLoops,
  platePlanFromTrimmed,
  trimMaskLoops,
  unsmoothedPlanFromMaskImage,
} from './geom/maskTrace.ts'
import { compositeArtworkRgba, rgbaToPngBlob } from './preview/artwork.ts'
import { buildProfile } from './geom/profiles.ts'
import { downloadStl, meshToBinaryStl } from './geom/stl.ts'
import {
  DEFAULT_PARAMS,
  PROFILE_DEFS,
  PROFILE_GROUPS,
  isRadiusShape,
  type FrameParams,
  type Mesh,
  type PlanVertex,
  type ShapeKind,
} from './geom/types.ts'
import { isPolygonalOutline } from './geom/plan.ts'
import { inspectMesh } from './geom/validate.ts'
import { rgbaFromBlob } from './import/imageData.ts'
import {
  MIN_MOULDING_OVER_RABBET_MM,
  PACK_XY_FIT_MM,
  mapPackToFrameParams,
  packOutlineFromPlan,
  pocketRingFromPack,
  silhouetteSizeMm,
  unpackLitholabPack,
} from './import/litholabPack.ts'
import { suggestedImportedOuter, validateImportedOuter } from './geom/rectFrame.ts'
import { FrameViewer } from './preview/viewer.ts'
import { readParams, writeParams } from './ui/params.ts'
import { renderProfileSketch } from './ui/profileSketch.ts'
import { APP_LABEL, STL_HEADER } from './version.ts'
import './style.css'

interface ImportState {
  name: string
  sourceFile: string
  sight: PlanVertex[]
  holes: PlanVertex[][]
  packOutline: PlanVertex[]
  packBorder: number
  destWidth: number
  destHeight: number
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
const widthLabel = document.querySelector<HTMLElement>('#sight-width-label')
const heightLabel = document.querySelector<HTMLElement>('#sight-height-label')
const sightSizeHint = document.querySelector<HTMLElement>('#sight-size-hint')
const sightSizeHeading = document.querySelector<HTMLElement>('#sight-size-heading')
const shapeHint = document.querySelector<HTMLElement>('#shape-hint')
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
const previewBusy = document.querySelector<HTMLElement>('#preview-busy')
const previewBusyLabel = document.querySelector<HTMLElement>('#preview-busy-label')
const mouldingWidthInput = document.querySelector<HTMLInputElement>('#moulding-width')
const mouldingHeightInput = document.querySelector<HTMLInputElement>('#moulding-height')
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
if (previewBusy) previewHost.appendChild(previewBusy)
let lastMesh: Mesh | null = null
let lastParams: FrameParams | null = null
let imported: ImportState | null = null
let lastShape: ShapeKind | null = null
let timer = 0
let rebuildGen = 0

function syncShapeLock(): void {
  const shape = (form.querySelector<HTMLInputElement>('input[name="shape"]:checked')?.value ??
    'rectangle') as ShapeKind
  const importedFollow = shape === 'imported'
  const hasImport = imported !== null
  const geometricOuter = hasImport && !importedFollow
  const radius = isRadiusShape(shape)
  if (widthInput) widthInput.disabled = importedFollow
  if (heightInput) heightInput.disabled = importedFollow || radius
  widthField?.classList.toggle('is-locked', importedFollow)
  heightField?.classList.toggle('is-locked', importedFollow)
  if (heightField) heightField.hidden = radius && !importedFollow
  if (sightSizeHeading) {
    sightSizeHeading.textContent = geometricOuter ? 'Outer size' : 'Artwork / sight size'
  }
  if (widthLabel) {
    if (geometricOuter && radius) widthLabel.textContent = 'Outer radius (mm)'
    else if (geometricOuter) widthLabel.textContent = 'Outer width (mm)'
    else if (radius) widthLabel.textContent = 'Radius (mm)'
    else widthLabel.textContent = 'Width (mm)'
  }
  if (heightLabel) heightLabel.textContent = geometricOuter ? 'Outer height (mm)' : 'Height (mm)'
  if (sightSizeHint) {
    if (geometricOuter && radius) {
      sightSizeHint.textContent =
        'Outer circumradius (centre to vertex). The lithophane opening stays the imported mask.'
    } else if (geometricOuter) {
      sightSizeHint.textContent =
        'Outer size of the frame. The lithophane opening stays the imported mask.'
    } else if (radius) {
      sightSizeHint.textContent =
        'Opening circumradius (centre to vertex). Height matches the bounding diameter.'
    } else {
      sightSizeHint.textContent = 'Visible opening. The frame is sized from this plus moulding width.'
    }
  }
  if (shapeHint) {
    shapeHint.textContent = hasImport
      ? 'The pack name follows the lithophane outline. Rectangle, hexagon, octagon, and circle set the outer edge only.'
      : 'Rectangle, hexagon, octagon, or circle. Import a LithoLab pack to follow a custom opening.'
  }
  if (radius && !importedFollow && heightInput && widthInput) {
    const r = widthInput.valueAsNumber
    if (Number.isFinite(r)) heightInput.value = formatMm(2 * r)
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
  const geometric = imported != null && params.shape !== 'imported'
  const d = deriveSizes(params, {
    geometricOuter: geometric,
    destWidth: imported?.destWidth,
    destHeight: imported?.destHeight,
  })
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
  lastShape = null
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

function importedPocket(params: FrameParams): PlanVertex[] | null {
  if (!imported?.packOutline.length) return null
  return pocketRingFromPack(imported.packOutline, params.fitClearance)
}

function syncImportedFit(params: FrameParams): FrameParams {
  if (!imported) return params
  const fit = Math.max(PACK_XY_FIT_MM, params.fitClearance)
  const rw = Math.max(0.1, imported.packBorder + fit)
  let mouldingWidth = params.mouldingWidth
  if (mouldingWidth <= rw) mouldingWidth = rw + MIN_MOULDING_OVER_RABBET_MM
  const rabbet = form.querySelector<HTMLInputElement>('#rabbet-width')
  const fitInput = form.querySelector<HTMLInputElement>('#fit-clearance')
  const moulding = form.querySelector<HTMLInputElement>('#moulding-width')
  if (fitInput && Math.abs(params.fitClearance - fit) > 1e-6) fitInput.value = formatMm(fit)
  if (rabbet && Math.abs(params.rabbetWidth - rw) > 1e-6) rabbet.value = formatMm(rw)
  if (moulding && Math.abs(params.mouldingWidth - mouldingWidth) > 1e-6) moulding.value = formatMm(mouldingWidth)
  return { ...params, fitClearance: fit, rabbetWidth: rw, mouldingWidth }
}

function applyImportedShapeSize(shape: ShapeKind): void {
  if (!imported || !widthInput || !heightInput) return
  const moulding = Number(form.querySelector<HTMLInputElement>('#moulding-width')?.value)
  const mw = Number.isFinite(moulding) ? moulding : DEFAULT_PARAMS.mouldingWidth
  if (shape === 'imported') {
    widthInput.value = formatMm(imported.destWidth)
    heightInput.value = formatMm(imported.destHeight)
    return
  }
  if (lastShape === 'imported' || lastShape == null) {
    const suggested = suggestedImportedOuter(imported.sight, mw, shape)
    widthInput.value = formatMm(suggested.sightWidth)
    heightInput.value = formatMm(suggested.sightHeight)
    return
  }
  if (lastShape === shape) return
  const prevRadius = isRadiusShape(lastShape)
  const nextRadius = isRadiusShape(shape)
  if (!prevRadius && nextRadius) {
    const w = widthInput.valueAsNumber
    const h = heightInput.valueAsNumber
    if (Number.isFinite(w) && Number.isFinite(h)) {
      const r = Math.hypot(w / 2, h / 2)
      widthInput.value = formatMm(r)
      heightInput.value = formatMm(2 * r)
    }
  } else if (prevRadius && !nextRadius) {
    const r = widthInput.valueAsNumber
    if (Number.isFinite(r)) {
      widthInput.value = formatMm(2 * r)
      heightInput.value = formatMm(2 * r)
    }
  }
}

function isMouldingField(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.id === 'moulding-width' || el.id === 'moulding-height')
}

function shapeLabel(shape: ShapeKind): string {
  if (shape === 'imported') return imported?.name ?? 'imported'
  return shape
}

function updateProfileSketchLive(): void {
  syncFaceSliders()
  const params = readParams(form)
  const def = PROFILE_DEFS.find((p) => p.id === params.profile)
  if (profileHint) profileHint.textContent = def?.description ?? ''
  if (profileSvg) renderProfileSketch(profileSvg, buildProfile(params))
}

function setBusy(phase: string | null): void {
  if (phase) {
    previewHost.setAttribute('aria-busy', 'true')
    if (previewBusy) {
      previewBusy.hidden = false
      if (previewBusyLabel) previewBusyLabel.textContent = phase
    }
    statusEl.textContent = phase
    downloadBtn.disabled = true
    return
  }
  previewHost.setAttribute('aria-busy', 'false')
  if (previewBusy) previewBusy.hidden = true
}

function yieldPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function runRebuild(note?: string, phase = 'Building frame…'): Promise<void> {
  const id = ++rebuildGen
  window.clearTimeout(timer)
  setBusy(phase)
  await yieldPaint()
  if (id !== rebuildGen) return
  try {
    rebuild(note)
  } finally {
    if (id === rebuildGen) setBusy(null)
  }
}

function rebuild(fitNote?: string): void {
  const shape = (form.querySelector<HTMLInputElement>('input[name="shape"]:checked')?.value ??
    'rectangle') as ShapeKind
  if (imported) applyImportedShapeSize(shape)
  lastShape = shape

  syncShapeLock()
  syncStackLock()
  syncFaceSliders()
  let params = readParams(form)
  if (imported) params = syncImportedFit(params)
  const issues = [
    ...validateParams(params),
    ...(imported && params.shape !== 'imported' ? validateImportedOuter(params, imported.sight) : []),
  ]
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
    const mesh = buildFrame(params, imported?.sight, importedPocket(params))
    const report = inspectMesh(mesh)
    viewer.setMesh(mesh, {
      smooth:
        params.shape === 'circle' ||
        (!!imported && !isPolygonalOutline(imported.sight)),
    })
    syncArtwork(params)
    lastMesh = mesh
    lastParams = params
    downloadBtn.disabled = false
    setIssues(report.watertight ? [] : ['Mesh is not watertight — check profile parameters.'])
    const extra = fitNote ? ` ${fitNote}` : ''
    const summary =
      imported
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
  const id = ++rebuildGen
  window.clearTimeout(timer)
  try {
    setBusy(`Reading ${file.name}…`)
    await yieldPaint()
    if (id !== rebuildGen) return
    const assets = await unpackLitholabPack(file)
    if (id !== rebuildGen) return

    const current = readParams(form)
    const base: FrameParams = {
      ...current,
      shape: current.shape === 'imported' ? 'rectangle' : current.shape,
    }
    const params = mapPackToFrameParams(assets.json, base)
    const destW = assets.json.export.width
    const destH = assets.json.export.height

    setBusy('Tracing mask…')
    await yieldPaint()
    if (id !== rebuildGen) return

    let maskedImg = assets.maskedPngBlob ? await rgbaFromBlob(assets.maskedPngBlob) : null
    let sight: PlanVertex[]
    let artSight: PlanVertex[]
    let holes: PlanVertex[][]
    if (assets.maskBlob) {
      const maskImg = await rgbaFromBlob(assets.maskBlob)
      const trace = sightFromMaskImage(maskImg, destW, destH)
      holes = trace.holes
      artSight = trace.sight
      sight = unsmoothedPlanFromMaskImage(maskImg, destW, destH)
    } else if (maskedImg) {
      const px = assets.json.export.pixelSizeMm || 0.2
      const loops = extractMaskPolygons(maskedImg, { smoothIters: 0 })
      const trace = sightFromPixelLoops(loops, px)
      holes = trace.holes
      artSight = trace.sight
      const trim = trimMaskLoops(loops)
      if (!trim) throw new Error('Could not trace a silhouette from the masked image.')
      sight = platePlanFromTrimmed(trim, trim.trimW * px, trim.trimH * px)
    } else {
      throw new Error('This pack has no mask or original-masked.png to trace.')
    }

    const packBorder = Math.max(0, assets.json.export.border)
    const packOutline = packOutlineFromPlan(sight, packBorder)

    const sil = silhouetteSizeMm(
      assets.json,
      maskedImg ? { width: maskedImg.width, height: maskedImg.height } : null,
    )

    setBusy('Preparing artwork…')
    await yieldPaint()
    if (id !== rebuildGen) return

    if (imported?.artworkUrl) URL.revokeObjectURL(imported.artworkUrl)
    let artworkUrl: string | null = null
    if (maskedImg) {
      const composited = compositeArtworkRgba(maskedImg, {
        widthMm: sil.width,
        heightMm: sil.height,
        sight: artSight,
        holes,
      })
      artworkUrl = URL.createObjectURL(await rgbaToPngBlob(composited))
    } else if (assets.photoBlob) {
      artworkUrl = URL.createObjectURL(assets.photoBlob)
    }
    imported = {
      name: assets.name,
      sourceFile: file.name,
      sight,
      holes,
      packOutline,
      packBorder,
      destWidth: destW,
      destHeight: destH,
      silhouetteWidth: sil.width,
      silhouetteHeight: sil.height,
      artworkUrl,
    }

    lastShape = 'imported'

    writeParams(form, params)
    if (importStatus) importStatus.classList.remove('is-error')
    syncImportUi()

    setBusy('Building frame…')
    await yieldPaint()
    if (id !== rebuildGen) return
    rebuild(`· from ${file.name}`)
  } catch (err: unknown) {
    if (id === rebuildGen) {
      const message = err instanceof Error ? err.message : 'Could not import that pack.'
      setImportError(message)
      statusEl.textContent = 'Import failed'
      downloadBtn.disabled = !lastMesh
    }
  } finally {
    if (id === rebuildGen) setBusy(null)
  }
}

form.addEventListener('input', (e) => {
  if (isMouldingField(e.target)) {
    updateProfileSketchLive()
    return
  }
  if (e.target instanceof HTMLInputElement && e.target.name === 'shape') return
  if (e.target instanceof HTMLSelectElement && e.target.id === 'profile') return
  scheduleRebuild()
})

form.addEventListener('change', (e) => {
  const t = e.target
  if (t instanceof HTMLSelectElement && t.id === 'profile') {
    const def = PROFILE_DEFS.find((p) => p.id === t.value)
    void runRebuild(undefined, `Applying ${def?.label ?? t.value} profile…`)
    return
  }
  if (t instanceof HTMLInputElement && t.name === 'shape') {
    const shape = t.value as ShapeKind
    const phase =
      imported && shape !== 'imported'
        ? `Building ${shapeLabel(shape)} outer…`
        : `Building ${shapeLabel(shape)}…`
    void runRebuild(undefined, phase)
    return
  }
  if (isMouldingField(t)) {
    void runRebuild(undefined, 'Updating moulding…')
    return
  }
  scheduleRebuild()
})

for (const el of [mouldingWidthInput, mouldingHeightInput]) {
  el?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    el.blur()
  })
}

downloadBtn.addEventListener('click', () => {
  if (!lastMesh || !lastParams) return
  const name = downloadName(lastParams, imported?.name)
  downloadStl(meshToBinaryStl(lastMesh, STL_HEADER), name)
})

resetBtn?.addEventListener('click', () => {
  clearImport(false)
  writeParams(form, DEFAULT_PARAMS)
  void runRebuild(undefined, 'Building frame…')
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
    downloadBtn.disabled = !lastMesh
  })
})

clearImportBtn?.addEventListener('click', () => {
  clearImport(true)
  void runRebuild(undefined, 'Building frame…')
})

syncImportUi()
rebuild()
