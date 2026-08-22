import { deriveSizes, validateParams } from './geom/derived.ts'
import { buildProfile } from './geom/profiles.ts'
import { buildRectFrame, frameSummary } from './geom/rectFrame.ts'
import { downloadStl, meshToBinaryStl } from './geom/stl.ts'
import { DEFAULT_PARAMS, PROFILE_DEFS, type FrameParams, type Mesh } from './geom/types.ts'
import { inspectMesh } from './geom/validate.ts'
import { FrameViewer } from './preview/viewer.ts'
import { readParams, writeParams } from './ui/params.ts'
import { renderProfileSketch } from './ui/profileSketch.ts'
import './style.css'

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
const heightField = document.querySelector<HTMLElement>('#sight-height-field')
const stackPanel = document.querySelector<HTMLElement>('#stack-fields')
const depthInput = document.querySelector<HTMLInputElement>('#rabbet-depth')
const stackEnabled = document.querySelector<HTMLInputElement>('#stack-enabled')

for (const def of PROFILE_DEFS) {
  const opt = document.createElement('option')
  opt.value = def.id
  opt.textContent = def.label
  profileSelect.appendChild(opt)
}

writeParams(form, DEFAULT_PARAMS)

const viewer = new FrameViewer(previewHost)
let lastMesh: Mesh | null = null
let lastParams: FrameParams | null = null
let timer = 0

function syncShapeLock(): void {
  const square = form.querySelector<HTMLInputElement>('input[name="shape"]:checked')?.value === 'square'
  if (heightInput) heightInput.disabled = square
  heightField?.classList.toggle('is-locked', square)
  if (square && heightInput) {
    const width = form.querySelector<HTMLInputElement>('#sight-width')
    if (width) heightInput.value = width.value
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

function rebuild(fitNote?: string): void {
  syncShapeLock()
  syncStackLock()
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
    const mesh = buildRectFrame(params)
    const report = inspectMesh(mesh)
    viewer.setMesh(mesh)
    lastMesh = mesh
    lastParams = params
    downloadBtn.disabled = false
    setIssues(report.watertight ? [] : ['Mesh is not watertight — check profile parameters.'])
    const extra = fitNote ? ` ${fitNote}` : ''
    statusEl.textContent = `${frameSummary(params)} · ${report.triangleCount} triangles${extra}`
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

form.addEventListener('input', scheduleRebuild)
form.addEventListener('change', scheduleRebuild)

downloadBtn.addEventListener('click', () => {
  if (!lastMesh || !lastParams) return
  const { sightWidth, sightHeight, profile, shape } = lastParams
  const h = shape === 'square' ? sightWidth : sightHeight
  const name = `border-${formatMm(sightWidth)}x${formatMm(h)}-${profile}.stl`
  downloadStl(meshToBinaryStl(lastMesh, 'BorderBuilder'), name)
})

resetBtn?.addEventListener('click', () => {
  writeParams(form, DEFAULT_PARAMS)
  rebuild()
})

rebuild()
