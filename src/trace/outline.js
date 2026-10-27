// Pocket outlines from token outlines, using distance fields:
//   pocket = token grown by the clearance, plus the finger-notch circle,
//            with the inside corners where they meet rounded off.
// Working on a fine grid keeps this exact (±0.02 mm) and robust for any
// shape, and the result is one clean closed outline the 3D engine can turn
// into a single smooth curve.
import { bbox, simplify, ccw } from "./geometry.js";
import { marchingSquares } from "./image.js";

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Euclidean distance (in cells) from every cell to the nearest cell where mask is 1. */
export function distanceTo(mask, w, h) {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

/** Fill a polygon into a grid (cell centres), scanline style. */
function fillPolygon(poly, grid) {
  const { w, h, x0, y0, step } = grid;
  const mask = new Uint8Array(w * h);
  const xs = [];
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * step;
    xs.length = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % n];
      if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - x0) / step - 0.5));
      const to = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / step - 0.5));
      for (let i = from; i <= to; i++) mask[j * w + i] = 1;
    }
  }
  return mask;
}

/**
 * Outline of a pocket (mm): the token grown by `grow` (negative shrinks),
 * optionally joined with a notch circle { x, y, r }, with inside corners
 * rounded to `round`. Returns a counter-clockwise polygon.
 */
export function pocketOutline(poly, { grow = 0, notch = null, round = 0, step = 0.05 } = {}) {
  const b = bbox(poly);
  let x0 = b.x0;
  let y0 = b.y0;
  let x1 = b.x1;
  let y1 = b.y1;
  if (notch) {
    x0 = Math.min(x0, notch.x - notch.r);
    y0 = Math.min(y0, notch.y - notch.r);
    x1 = Math.max(x1, notch.x + notch.r);
    y1 = Math.max(y1, notch.y + notch.r);
  }
  const margin = Math.max(0, grow) + round + 3 * step;
  x0 -= margin;
  y0 -= margin;
  x1 += margin;
  y1 += margin;
  const w = Math.ceil((x1 - x0) / step) + 1;
  const h = Math.ceil((y1 - y0) / step) + 1;
  const grid = { w, h, x0, y0, step };
  const tokenMask = fillPolygon(poly, grid);
  // Signed-ish field, positive inside the result, in mm.
  let field = new Float32Array(w * h);
  if (grow >= 0) {
    const out = distanceTo(tokenMask, w, h);
    // Cell centres are half a cell from the true edge: correct for it.
    for (let i = 0; i < w * h; i++) field[i] = tokenMask[i] ? grow + 0.5 * step : grow - (out[i] - 0.5) * step;
  } else {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = tokenMask[i] ? 0 : 1;
    const inside = distanceTo(inv, w, h);
    for (let i = 0; i < w * h; i++) field[i] = inside[i] * step + grow - 0.5 * step;
  }
  if (notch) {
    for (let j = 0; j < h; j++) {
      const y = y0 + (j + 0.5) * step;
      for (let i = 0; i < w; i++) {
        const x = x0 + (i + 0.5) * step;
        const v = notch.r - Math.hypot(x - notch.x, y - notch.y);
        if (v > field[j * w + i]) field[j * w + i] = v;
      }
    }
  }
  if (round > 0) {
    // Closing: grow by `round`, then shrink back. Rounds inside corners only.
    const A = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) A[i] = field[i] >= 0 ? 1 : 0;
    const dA = distanceTo(A, w, h);
    const notB = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) notB[i] = dA[i] * step <= round ? 0 : 1;
    const dB = distanceTo(notB, w, h);
    for (let i = 0; i < w * h; i++) field[i] = Math.max(field[i], dB[i] * step - round - 0.5 * step);
  }
  // Grid borders are outside by construction (margin), so loops close.
  for (let i = 0; i < w; i++) field[i] = field[(h - 1) * w + i] = -1;
  for (let j = 0; j < h; j++) field[j * w] = field[j * w + w - 1] = -1;
  const loop = marchingSquares(field, w, h, 0);
  const mm = loop.map(([gx, gy]) => [x0 + (gx + 0.5) * step, y0 + (gy + 0.5) * step]);
  return ccw(simplify(mm, step / 3));
}
