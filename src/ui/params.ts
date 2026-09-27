import {
  DEFAULT_PARAMS,
  isRadiusShape,
  type AcrylicPresetId,
  type BacklightParams,
  type FrameParams,
  type ProfileId,
  type ScrewSize,
  type ShapeKind,
} from '../geom/types.ts'

function num(input: HTMLInputElement | null, fallback: number): number {
  const v = input?.valueAsNumber ?? NaN
  return Number.isFinite(v) ? v : fallback
}

function field(form: HTMLFormElement, id: string): HTMLInputElement | null {
  return form.querySelector<HTMLInputElement>(`#${id}`)
}

function checked(form: HTMLFormElement, id: string, fallback: boolean): boolean {
  return field(form, id)?.checked ?? fallback
}

function selected<T extends string>(form: HTMLFormElement, id: string, fallback: T): T {
  return (form.querySelector<HTMLSelectElement>(`#${id}`)?.value as T | undefined) || fallback
}

function readBacklight(form: HTMLFormElement): BacklightParams {
  const d = DEFAULT_PARAMS.backlight
  const n = (id: string, fallback: number) => num(field(form, id), fallback)
  return {
    enabled: checked(form, 'bl-enabled', d.enabled),
    acrylicPreset: selected<AcrylicPresetId>(form, 'bl-acrylic', d.acrylicPreset),
    acrylicThickness: n('bl-acrylic-thickness', d.acrylicThickness),
    ledStripWidth: n('bl-led-width', d.ledStripWidth),
    ledGap: n('bl-led-gap', d.ledGap),
    scorePitch: n('bl-score-pitch', d.scorePitch),
    scoreFace: selected<'back' | 'front'>(form, 'bl-score-face', d.scoreFace),
    panelThickness: n('bl-panel-thickness', d.panelThickness),
    panelOverlap: n('bl-panel-overlap', d.panelOverlap),
    panelFit: n('bl-panel-fit', d.panelFit),
    wireAngleDeg: n('bl-wire-angle', d.wireAngleDeg),
    wireWidth: n('bl-wire-width', d.wireWidth),
    wireDepth: n('bl-wire-depth', d.wireDepth),
    kickstand: checked(form, 'bl-kickstand', d.kickstand),
    kickstandTilt: n('bl-kick-tilt', d.kickstandTilt),
    kickstandWidth: n('bl-kick-width', d.kickstandWidth),
    kickstandThickness: n('bl-kick-thickness', d.kickstandThickness),
    buttonCount: Math.round(n('bl-buttons', d.buttonCount)),
    screw: selected<ScrewSize>(form, 'bl-screw', d.screw),
  }
}

export function readParams(form: HTMLFormElement): FrameParams {
  const shape = (form.querySelector<HTMLInputElement>('input[name="shape"]:checked')?.value ??
    'rectangle') as ShapeKind
  const profile = (form.querySelector<HTMLSelectElement>('#profile')?.value ?? 'flat') as ProfileId
  const stackEnabled = form.querySelector<HTMLInputElement>('#stack-enabled')?.checked ?? false

  const sightWidth = num(form.querySelector('#sight-width')!, DEFAULT_PARAMS.sightWidth)
  const sightHeight = num(form.querySelector('#sight-height')!, DEFAULT_PARAMS.sightHeight)

  return {
    shape,
    sightWidth,
    sightHeight: isRadiusShape(shape) ? sightWidth : sightHeight,
    mouldingWidth: num(form.querySelector('#moulding-width')!, DEFAULT_PARAMS.mouldingWidth),
    mouldingHeight: num(form.querySelector('#moulding-height')!, DEFAULT_PARAMS.mouldingHeight),
    profile,
    lipWidth: num(form.querySelector('#lip-width')!, DEFAULT_PARAMS.lipWidth),
    faceDepth: num(form.querySelector('#face-depth')!, DEFAULT_PARAMS.faceDepth),
    rabbetWidth: num(form.querySelector('#rabbet-width')!, DEFAULT_PARAMS.rabbetWidth),
    rabbetDepth: num(form.querySelector('#rabbet-depth')!, DEFAULT_PARAMS.rabbetDepth),
    rabbetStack: {
      enabled: stackEnabled,
      glass: num(form.querySelector('#stack-glass')!, DEFAULT_PARAMS.rabbetStack.glass),
      mat: num(form.querySelector('#stack-mat')!, DEFAULT_PARAMS.rabbetStack.mat),
      backing: num(form.querySelector('#stack-backing')!, DEFAULT_PARAMS.rabbetStack.backing),
      clearance: num(form.querySelector('#stack-clearance')!, DEFAULT_PARAMS.rabbetStack.clearance),
    },
    fitClearance: num(form.querySelector('#fit-clearance')!, DEFAULT_PARAMS.fitClearance),
    chamfer: {
      sight: num(field(form, 'chamfer-sight'), DEFAULT_PARAMS.chamfer.sight),
      backOuter: num(field(form, 'chamfer-back'), DEFAULT_PARAMS.chamfer.backOuter),
      rabbetMouth: num(field(form, 'chamfer-mouth'), DEFAULT_PARAMS.chamfer.rabbetMouth),
    },
    backlight: readBacklight(form),
    packBorder: null,
  }
}

export function writeParams(form: HTMLFormElement, params: FrameParams): void {
  const shapeInput = form.querySelector<HTMLInputElement>(`input[name="shape"][value="${params.shape}"]`)
  if (shapeInput) shapeInput.checked = true
  setValue(form, '#sight-width', params.sightWidth)
  setValue(form, '#sight-height', params.sightHeight)
  setValue(form, '#moulding-width', params.mouldingWidth)
  setValue(form, '#moulding-height', params.mouldingHeight)
  setValue(form, '#lip-width', params.lipWidth)
  setValue(form, '#face-depth', params.faceDepth)
  const profile = form.querySelector<HTMLSelectElement>('#profile')
  if (profile) profile.value = params.profile
  setValue(form, '#rabbet-width', params.rabbetWidth)
  setValue(form, '#rabbet-depth', params.rabbetDepth)
  const stack = form.querySelector<HTMLInputElement>('#stack-enabled')
  if (stack) stack.checked = params.rabbetStack.enabled
  setValue(form, '#stack-glass', params.rabbetStack.glass)
  setValue(form, '#stack-mat', params.rabbetStack.mat)
  setValue(form, '#stack-backing', params.rabbetStack.backing)
  setValue(form, '#stack-clearance', params.rabbetStack.clearance)
  setValue(form, '#fit-clearance', params.fitClearance)
  setValue(form, '#chamfer-sight', params.chamfer.sight)
  setValue(form, '#chamfer-back', params.chamfer.backOuter)
  setValue(form, '#chamfer-mouth', params.chamfer.rabbetMouth)
  const b = params.backlight
  setChecked(form, '#bl-enabled', b.enabled)
  setSelect(form, '#bl-acrylic', b.acrylicPreset)
  setValue(form, '#bl-acrylic-thickness', b.acrylicThickness)
  setValue(form, '#bl-led-width', b.ledStripWidth)
  setValue(form, '#bl-led-gap', b.ledGap)
  setValue(form, '#bl-score-pitch', b.scorePitch)
  setSelect(form, '#bl-score-face', b.scoreFace)
  setValue(form, '#bl-panel-thickness', b.panelThickness)
  setValue(form, '#bl-panel-overlap', b.panelOverlap)
  setValue(form, '#bl-panel-fit', b.panelFit)
  setValue(form, '#bl-wire-angle', b.wireAngleDeg)
  setValue(form, '#bl-wire-width', b.wireWidth)
  setValue(form, '#bl-wire-depth', b.wireDepth)
  setChecked(form, '#bl-kickstand', b.kickstand)
  setValue(form, '#bl-kick-tilt', b.kickstandTilt)
  setValue(form, '#bl-kick-width', b.kickstandWidth)
  setValue(form, '#bl-kick-thickness', b.kickstandThickness)
  setValue(form, '#bl-buttons', b.buttonCount)
  setSelect(form, '#bl-screw', b.screw)
}

function setChecked(form: HTMLFormElement, selector: string, value: boolean): void {
  const el = form.querySelector<HTMLInputElement>(selector)
  if (el) el.checked = value
}

function setSelect(form: HTMLFormElement, selector: string, value: string): void {
  const el = form.querySelector<HTMLSelectElement>(selector)
  if (el) el.value = value
}

function setValue(form: HTMLFormElement, selector: string, value: number): void {
  const el = form.querySelector<HTMLInputElement>(selector)
  if (el) el.value = String(value)
}
