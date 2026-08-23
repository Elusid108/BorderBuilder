import { DEFAULT_PARAMS, type FrameParams, type ProfileId, type ShapeKind } from '../geom/types.ts'

function num(input: HTMLInputElement, fallback: number): number {
  const v = input.valueAsNumber
  return Number.isFinite(v) ? v : fallback
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
    sightHeight: shape === 'square' ? sightWidth : sightHeight,
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
}

function setValue(form: HTMLFormElement, selector: string, value: number): void {
  const el = form.querySelector<HTMLInputElement>(selector)
  if (el) el.value = String(value)
}
