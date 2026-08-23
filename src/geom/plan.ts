import type { PlanVertex } from './types.ts'

export type PlanLoop = PlanVertex[]

export function sub(a: PlanVertex, b: PlanVertex): PlanVertex {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function hypot(v: PlanVertex): number {
  return Math.hypot(v.x, v.y)
}

export function signedArea(poly: PlanLoop): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.y - b.x * a.y
  }
  return s * 0.5
}

export function polygonBounds(set: PlanLoop[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const loop of set) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

export function loopBounds(poly: PlanLoop): { minX: number; minY: number; maxX: number; maxY: number } {
  return polygonBounds([poly])
}

export function ensureCcw(poly: PlanLoop): PlanLoop {
  if (poly.length < 3) return poly
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly
}

export function largestLoop(set: PlanLoop[]): PlanLoop | null {
  let best: PlanLoop | null = null
  let bestArea = 0
  for (const loop of set) {
    if (loop.length < 3) continue
    const area = Math.abs(signedArea(loop))
    if (area > bestArea) {
      bestArea = area
      best = loop
    }
  }
  return best
}

export function decimateClosed(poly: PlanLoop, maxVerts: number): PlanLoop {
  if (poly.length <= maxVerts) return poly
  const n = poly.length
  const out: PlanLoop = new Array(maxVerts)
  for (let i = 0; i < maxVerts; i++) out[i] = poly[Math.floor((i * n) / maxVerts)]!
  return out
}

export function removeDegen(poly: PlanLoop, eps = 1e-9): PlanLoop {
  const out: PlanLoop = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || hypot(sub(p, last)) > eps) out.push(p)
  }
  if (out.length > 1 && hypot(sub(out[0]!, out[out.length - 1]!)) <= eps) out.pop()
  return out
}

/** Uniform arc-length resample of a closed loop. */
export function resampleClosed(poly: PlanLoop, spacing: number, maxVerts = 512): PlanLoop {
  const clean = removeDegen(poly)
  if (clean.length < 3) return clean

  const n = clean.length
  const seg: number[] = new Array(n)
  let perim = 0
  for (let i = 0; i < n; i++) {
    const len = hypot(sub(clean[(i + 1) % n]!, clean[i]!))
    seg[i] = len
    perim += len
  }
  if (perim < 1e-9) return clean

  const count = Math.max(32, Math.min(maxVerts, Math.round(perim / Math.max(spacing, 1e-3))))
  const out: PlanLoop = []
  let i = 0
  let acc = 0
  for (let k = 0; k < count; k++) {
    const target = (k * perim) / count
    while (acc + (seg[i] ?? 0) < target && i < n - 1) {
      acc += seg[i] ?? 0
      i++
    }
    const len = seg[i] ?? 0
    const t = len < 1e-12 ? 0 : (target - acc) / len
    const a = clean[i]!
    const b = clean[(i + 1) % n]!
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return removeDegen(out)
}
