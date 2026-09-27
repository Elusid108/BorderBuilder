import type { Segment } from '../geom/scoreGrid.ts'
import type { PlanVertex } from '../geom/types.ts'

export interface AcrylicDxfInput {
  outline: PlanVertex[]
  score: Segment[]
  /** Mirror X so the layout reads as seen from the back (score on the back face). */
  mirror: boolean
}

function num(n: number): string {
  const r = Math.round(n * 10000) / 10000
  return Object.is(r, -0) ? '0' : String(r)
}

/**
 * R12 ASCII DXF (AC1009) in millimetres: a closed `CUT` polyline (red) and
 * `SCORE` lines (blue), shifted so the part sits at the origin. Score lines
 * alternate direction so the laser serpentines instead of jumping back.
 */
export function acrylicDxf(input: AcrylicDxfInput): string {
  const sx = input.mirror ? -1 : 1
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of input.outline) {
    const x = p.x * sx
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const X = (x: number) => num(x * sx - minX)
  const Y = (y: number) => num(y - minY)
  const out: string[] = []
  const g = (code: number, value: string | number) => {
    out.push(String(code), String(value))
  }

  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, 4)
  g(9, '$MEASUREMENT')
  g(70, 1)
  g(9, '$EXTMIN')
  g(10, 0)
  g(20, 0)
  g(30, 0)
  g(9, '$EXTMAX')
  g(10, num(maxX - minX))
  g(20, num(maxY - minY))
  g(30, 0)
  g(0, 'ENDSEC')

  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LTYPE')
  g(70, 1)
  g(0, 'LTYPE')
  g(2, 'CONTINUOUS')
  g(70, 0)
  g(3, 'Solid line')
  g(72, 65)
  g(73, 0)
  g(40, 0)
  g(0, 'ENDTAB')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, 2)
  for (const [name, color] of [
    ['CUT', 1],
    ['SCORE', 5],
  ] as const) {
    g(0, 'LAYER')
    g(2, name)
    g(70, 0)
    g(62, color)
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  g(0, 'SECTION')
  g(2, 'ENTITIES')
  g(0, 'POLYLINE')
  g(8, 'CUT')
  g(62, 1)
  g(66, 1)
  g(70, 1)
  g(10, 0)
  g(20, 0)
  g(30, 0)
  for (const p of input.outline) {
    g(0, 'VERTEX')
    g(8, 'CUT')
    g(10, X(p.x))
    g(20, Y(p.y))
    g(30, 0)
  }
  g(0, 'SEQEND')
  g(8, 'CUT')
  input.score.forEach((s, i) => {
    const [a, b] = i % 2 === 0 ? [s.a, s.b] : [s.b, s.a]
    g(0, 'LINE')
    g(8, 'SCORE')
    g(62, 5)
    g(10, X(a.x))
    g(20, Y(a.y))
    g(30, 0)
    g(11, X(b.x))
    g(21, Y(b.y))
    g(31, 0)
  })
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return out.join('\r\n') + '\r\n'
}

export interface ParsedDxf {
  cut: { x: number; y: number }[][]
  lines: { a: { x: number; y: number }; b: { x: number; y: number } }[]
}

/** Minimal reader for the files `acrylicDxf` writes (self-check round trip). */
export function parseAcrylicDxf(text: string): ParsedDxf {
  const t = text.split(/\r?\n/)
  const pairs: [number, string][] = []
  for (let i = 0; i + 1 < t.length; i += 2) pairs.push([Number(t[i]), t[i + 1]!.trim()])
  const cut: { x: number; y: number }[][] = []
  const lines: ParsedDxf['lines'] = []
  let i = 0
  while (i < pairs.length) {
    const [code, value] = pairs[i]!
    if (code === 0 && value === 'POLYLINE') {
      const loop: { x: number; y: number }[] = []
      i++
      while (i < pairs.length && !(pairs[i]![0] === 0 && pairs[i]![1] === 'SEQEND')) {
        if (pairs[i]![0] === 0 && pairs[i]![1] === 'VERTEX') {
          const v = { x: 0, y: 0 }
          i++
          while (i < pairs.length && pairs[i]![0] !== 0) {
            if (pairs[i]![0] === 10) v.x = Number(pairs[i]![1])
            if (pairs[i]![0] === 20) v.y = Number(pairs[i]![1])
            i++
          }
          loop.push(v)
          continue
        }
        i++
      }
      cut.push(loop)
      continue
    }
    if (code === 0 && value === 'LINE') {
      const l = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }
      i++
      while (i < pairs.length && pairs[i]![0] !== 0) {
        const [c, v] = pairs[i]!
        if (c === 10) l.a.x = Number(v)
        if (c === 20) l.a.y = Number(v)
        if (c === 11) l.b.x = Number(v)
        if (c === 21) l.b.y = Number(v)
        i++
      }
      lines.push(l)
      continue
    }
    i++
  }
  return { cut, lines }
}
