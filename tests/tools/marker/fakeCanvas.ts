/**
 * A page canvas for tests (jsdom has no 2D context): `gray(x, y)` (0..255)
 * gives each canvas pixel; the canvas sits at client (left, top), shown at
 * half its pixel size (as on a 2× display). Counts getImageData calls.
 */
export function fakeCanvas(
  gray: (x: number, y: number) => number,
  { left = 0, top = 0, width = 400, height = 400 } = {},
) {
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  canvas.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect
  const reads = { count: 0 }
  const ctx = {
    getImageData(x: number, y: number, w: number, h: number) {
      reads.count++
      const data = new Uint8ClampedArray(w * h * 4)
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const v = gray(x + i, y + j)
          data.set([v, v, v, 255], (j * w + i) * 4)
        }
      return { data }
    },
  }
  canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext']
  return { canvas, reads }
}
