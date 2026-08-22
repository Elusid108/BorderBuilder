import type { ProfilePoint } from '../geom/types.ts'

export function renderProfileSketch(svg: SVGSVGElement, profile: ProfilePoint[]): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild)

  const pad = 8
  const w = 200
  const h = 120
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)

  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const p of profile) {
    minU = Math.min(minU, p.u)
    maxU = Math.max(maxU, p.u)
    minV = Math.min(minV, p.v)
    maxV = Math.max(maxV, p.v)
  }
  const spanU = Math.max(1e-6, maxU - minU)
  const spanV = Math.max(1e-6, maxV - minV)
  const scale = Math.min((w - pad * 2) / spanU, (h - pad * 2) / spanV)

  const map = (p: ProfilePoint): [number, number] => {
    const x = pad + (p.u - minU) * scale
    const y = h - pad - (p.v - minV) * scale
    return [x, y]
  }

  const ns = 'http://www.w3.org/2000/svg'
  const path = document.createElementNS(ns, 'path')
  const d = profile
    .map((p, i) => {
      const [x, y] = map(p)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
  path.setAttribute('d', `${d} Z`)
  path.setAttribute('fill', 'rgba(196, 165, 116, 0.22)')
  path.setAttribute('stroke', '#c4a574')
  path.setAttribute('stroke-width', '1.4')
  svg.appendChild(path)

  const inner = profile.find((p) => p.u === 0 && p.v === Math.max(...profile.map((q) => q.v)))
  if (inner) {
    const [x, y] = map(inner)
    const dot = document.createElementNS(ns, 'circle')
    dot.setAttribute('cx', x.toFixed(2))
    dot.setAttribute('cy', y.toFixed(2))
    dot.setAttribute('r', '2.2')
    dot.setAttribute('fill', '#e8c27a')
    svg.appendChild(dot)
  }
}
