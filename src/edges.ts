/**
 * Canny-like edge map from normal + depth buffers (RGBA Uint8 arrays, same size).
 * Sobel on normals (creases) and depth (silhouettes), thresholded -> white lines on black.
 * Pure function so it can be unit-tested.
 */
export function edgeMap(normal: Uint8ClampedArray, depth: Uint8ClampedArray, w: number, h: number, threshold = 0.18): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const n = (x: number, y: number, c: number) => normal[(y * w + x) * 4 + c] / 255;
  const d = (x: number, y: number) => depth[(y * w + x) * 4] / 255;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let g = 0;
      for (let c = 0; c < 3; c++) {
        const gx = n(x + 1, y - 1, c) + 2 * n(x + 1, y, c) + n(x + 1, y + 1, c) - n(x - 1, y - 1, c) - 2 * n(x - 1, y, c) - n(x - 1, y + 1, c);
        const gy = n(x - 1, y + 1, c) + 2 * n(x, y + 1, c) + n(x + 1, y + 1, c) - n(x - 1, y - 1, c) - 2 * n(x, y - 1, c) - n(x + 1, y - 1, c);
        g = Math.max(g, Math.hypot(gx, gy) / 4);
      }
      const dx = d(x + 1, y - 1) + 2 * d(x + 1, y) + d(x + 1, y + 1) - d(x - 1, y - 1) - 2 * d(x - 1, y) - d(x - 1, y + 1);
      const dy = d(x - 1, y + 1) + 2 * d(x, y + 1) + d(x + 1, y + 1) - d(x - 1, y - 1) - 2 * d(x, y - 1) - d(x + 1, y - 1);
      g = Math.max(g, (Math.hypot(dx, dy) / 4) * 6);
      const v = g > threshold ? 255 : 0;
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}
