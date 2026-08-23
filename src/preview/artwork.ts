import { rasterizePolygonsBinary } from '../geom/offset.ts'
import type { RgbaImage } from '../geom/maskTrace.ts'
import type { PlanLoop } from '../geom/plan.ts'
import type { PlanVertex } from '../geom/types.ts'

function planToPixel(poly: PlanLoop, widthMm: number, heightMm: number, w: number, h: number): PlanLoop {
  const sx = w / Math.max(widthMm, 1e-9)
  const sy = h / Math.max(heightMm, 1e-9)
  return poly.map((p) => ({
    x: (p.x + widthMm / 2) * sx,
    y: (heightMm / 2 - p.y) * sy,
  }))
}

/**
 * Composite pack artwork for the 3D preview. The opening follows the letter
 * outline; enclosed counters are left clear (not filled with the raw photo).
 * Hard alpha on the letter body clears the LithoLab border ring.
 */
export function compositeArtworkRgba(
  src: RgbaImage,
  opts: {
    widthMm: number
    heightMm: number
    sight: PlanVertex[]
    holes: PlanVertex[][]
  },
): RgbaImage {
  const w = src.width
  const h = src.height
  const data = src.data instanceof Uint8ClampedArray ? new Uint8ClampedArray(src.data) : new Uint8ClampedArray(src.data)

  if (opts.sight.length < 3 || w < 1 || h < 1) {
    return { width: w, height: h, data }
  }

  const outerPx = planToPixel(opts.sight, opts.widthMm, opts.heightMm, w, h)
  const blob = rasterizePolygonsBinary([outerPx], w, h, 0, 0, 1)
  const holePx = opts.holes.filter((loop) => loop.length >= 3).map((loop) => planToPixel(loop, opts.widthMm, opts.heightMm, w, h))
  const holeMask = holePx.length > 0 ? rasterizePolygonsBinary(holePx, w, h, 0, 0, 1) : null

  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (!blob[p] || holeMask?.[p] || (data[i + 3] ?? 0) < 16) {
      data[i + 3] = 0
      continue
    }
    data[i + 3] = 255
  }

  return { width: w, height: h, data }
}

export function rgbaToPngBlob(img: RgbaImage): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not composite artwork (canvas unavailable).')
  const frame = ctx.createImageData(img.width, img.height)
  frame.data.set(img.data)
  ctx.putImageData(frame, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the preview image.'))
    }, 'image/png')
  })
}
