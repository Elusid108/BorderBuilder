import JSZip from 'jszip'
import { rabbetSteps, totalRabbetDepth } from '../geom/derived.ts'
import { indexedBounds, transformIndexed, type IndexedMesh } from '../geom/indexed.ts'
import { BUTTON_LENGTH_MM, PILOT_DIAMETER, type Kit } from '../geom/parts/kit.ts'
import { loopBounds } from '../geom/plan.ts'
import { indexedToBinaryStl } from '../geom/stl.ts'
import { acrylicPreset, type FrameParams } from '../geom/types.ts'
import { acrylicDxf } from './dxf.ts'
import { buildThreeMf, type ThreeMfPart } from './threemf.ts'

export interface KitPackageInput {
  kit: Kit
  params: FrameParams
  /** File stem, e.g. `border-heart-ogee`. */
  baseName: string
  /** STL header / app label, e.g. `BorderBuilder v0.7.0`. */
  header: string
}

/** The back panel prints face-down (reflective side on the bed, socket boss up). */
export function panelForPrint(panel: IndexedMesh, thickness: number): IndexedMesh {
  return transformIndexed(panel, (x, y, z) => [-x, y, thickness - z])
}

function fmt(n: number, digits = 1): string {
  const f = 10 ** digits
  return String(Math.round(n * f) / f)
}

function wireSide(angleDeg: number): string {
  const a = ((angleDeg % 360) + 360) % 360
  const names = ['bottom', 'bottom-right', 'right', 'top-right', 'top', 'top-left', 'left', 'bottom-left']
  return names[Math.round(a / 45) % 8]!
}

export function cutSheet(input: KitPackageInput): string {
  const { kit, params } = input
  const bl = kit.backlight
  const b = params.backlight
  const lines: string[] = []
  const push = (s = '') => lines.push(s)
  push(`${input.header} — backlit frame kit`)
  push(`${input.baseName}`)
  push()
  if (!bl) {
    push('Backlight is off: this package holds the frame only.')
    return lines.join('\n')
  }
  const steps = rabbetSteps(params)
  const preset = acrylicPreset(b.acrylicPreset)
  const ab = loopBounds(bl.acrylicOutline)
  const pb = loopBounds(bl.panelOutline)
  push('STACK (front to back)')
  push(`  Lithophane rabbet   ${fmt(steps[0]!.depth, 2)} mm deep`)
  push(`  Acrylic + LED band  ${fmt(steps[1]!.depth, 2)} mm deep, LED wall ${fmt(b.ledGap)} mm outside the acrylic edge`)
  push(`  Back panel          ${fmt(steps[2]!.depth, 2)} mm, flush with the frame back`)
  push(`  Total rabbet depth  ${fmt(totalRabbetDepth(params), 2)} mm of ${fmt(params.mouldingHeight)} mm frame`)
  push()
  push('ACRYLIC (laser: acrylic.dxf)')
  push(`  Sheet        ${preset.system === 'custom' ? 'custom' : preset.label} clear cast acrylic, actual ${fmt(b.acrylicThickness, 2)} mm`)
  push(`  Cut size     ${fmt(ab.maxX - ab.minX)} × ${fmt(ab.maxY - ab.minY)} mm (same outline as the lithophane)`)
  push(`  Layer CUT    red, cut through`)
  push(`  Layer SCORE  blue, ${bl.scoreSegments.length} lines on a ${fmt(b.scorePitch, 2)} mm grid — light pass (score, not cut)`)
  push(`  Clear margin equals the lithophane border; counters in the mask stay unscored.`)
  if (b.scoreFace === 'back') {
    push('  The DXF is MIRRORED: lay the sheet with its back face up so the score ends up facing the back panel.')
  } else {
    push('  The DXF is as seen from the front: the scored face goes toward the lithophane.')
  }
  push('  Leave the protective film on while cutting; LightBurn kerf offset is optional (the LED gap absorbs it).')
  push()
  push('LED STRIP')
  push(`  Width        ${fmt(b.ledStripWidth)} mm, mounted on the rabbet wall facing the acrylic edge`)
  push(`  Length       ${fmt(bl.ledStripLength / 10)} cm around the wall`)
  for (const density of [30, 60, 144]) {
    push(`  ${String(density).padStart(3)} LED/m     ≈ ${Math.floor((bl.ledStripLength / 1000) * density)} LEDs`)
  }
  push(`  Wire exit    ${fmt(b.wireWidth)} × ${fmt(b.wireDepth)} mm notch in the back panel, ${wireSide(b.wireAngleDeg)} (${fmt(b.wireAngleDeg, 0)}°, seen from the front)`)
  push('  Start and end the strip at the notch.')
  push()
  push('PRINTED PARTS (parts.3mf has them all laid out)')
  push(`  frame.stl        exported back-down. With a flat face, flip it face-down: the rabbet steps then need no supports.`)
  push('                   Back-down (decorative faces), support the rabbet ledges.')
  push(`  back-panel.stl   ${fmt(pb.maxX - pb.minX)} × ${fmt(pb.maxY - pb.minY)} × ${fmt(b.panelThickness)} mm, front face on the bed — print it white, it is the reflector`)
  if (bl.kickstand && bl.kickstandLayout) {
    const k = bl.kickstandLayout
    push(`  kickstand.stl    prints on its side, ${fmt(k.pocketDepth + k.legReach)} mm long; leans the frame back ${fmt(b.kickstandTilt, 0)}°`)
    push('                   pull it out to hang the frame')
  }
  if (bl.button) {
    const dia = PILOT_DIAMETER[b.screw]
    push(`  turn-button.stl  print ${bl.buttonPivots.length}× (${BUTTON_LENGTH_MM} mm swivel clips)`)
    push(`                   screws: ${bl.buttonPivots.length}× ${b.screw} × 8 mm pan / countersunk, self-tapping`)
    if (bl.pilotHoles.length > 0) push(`                   pilot holes (${fmt(dia, 2)} mm) are already in the frame back`)
  }
  push()
  push('ASSEMBLY')
  push('  1. Drop the lithophane into the frame, face down.')
  push('  2. Stick the LED strip around the acrylic wall, LEDs facing inward; lead the wire to the notch.')
  push('  3. Lay the acrylic on the lithophane (film off, score facing the back if mirrored).')
  push('  4. Press the back panel in, then swing the turn-buttons over its edge.')
  if (kit.warnings.length) {
    push()
    push('WARNINGS')
    for (const w of kit.warnings) push(`  - ${w}`)
  }
  return lines.join('\n') + '\n'
}

/** ZIP with STLs, a 3MF of every printed part, the acrylic DXF, the cut sheet, and the settings. */
export async function buildKitPackage(input: KitPackageInput): Promise<Uint8Array> {
  const { kit, params, baseName, header } = input
  const zip = new JSZip()
  const parts: ThreeMfPart[] = [{ name: 'frame', mesh: kit.frame }]
  zip.file(`${baseName}-frame.stl`, indexedToBinaryStl(kit.frame, header))
  const bl = kit.backlight
  if (bl) {
    const panel = panelForPrint(bl.panel, params.backlight.panelThickness)
    zip.file(`${baseName}-back-panel.stl`, indexedToBinaryStl(panel, header))
    parts.push({ name: 'back-panel', mesh: panel })
    if (bl.kickstand) {
      zip.file(`${baseName}-kickstand.stl`, indexedToBinaryStl(bl.kickstand, header))
      parts.push({ name: 'kickstand', mesh: bl.kickstand })
    }
    if (bl.button) {
      zip.file(`${baseName}-turn-button.stl`, indexedToBinaryStl(bl.button, header))
      parts.push({ name: 'turn-button', mesh: bl.button, copies: bl.buttonPivots.length })
    }
    zip.file(
      `${baseName}-acrylic.dxf`,
      acrylicDxf({
        outline: bl.acrylicOutline,
        score: bl.scoreSegments,
        mirror: params.backlight.scoreFace === 'back',
      }),
    )
  }
  zip.file(`${baseName}-parts.3mf`, await buildThreeMf(parts))
  zip.file(`${baseName}-cut-sheet.txt`, cutSheet(input))
  zip.file(`${baseName}-settings.json`, JSON.stringify({ app: header, params }, null, 2))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export function partSize(mesh: IndexedMesh): string {
  const b = indexedBounds(mesh)
  return `${fmt(b.max.x - b.min.x)} × ${fmt(b.max.y - b.min.y)} × ${fmt(b.max.z - b.min.z)} mm`
}
