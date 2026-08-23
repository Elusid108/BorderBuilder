import type { RgbaImage } from '../geom/maskTrace.ts'

/** Decode a raster image to RGBA via canvas (browser only). */
export async function rgbaFromBlob(blob: Blob): Promise<RgbaImage & { width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bmp.close()
    throw new Error('Could not read the image (canvas unavailable).')
  }
  ctx.drawImage(bmp, 0, 0)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  bmp.close()
  return { width: img.width, height: img.height, data: img.data }
}
