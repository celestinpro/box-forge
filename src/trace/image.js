// Pixel-level steps of the tracer. Images are { width, height, data } with
// RGBA bytes, like the browser's ImageData. Masks are Uint8Array (0/1).

// ---------------------------------------------------------------- colour
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** CIE Lab for every pixel, as three Float32Arrays. Transparent pixels count as white. */
export function toLab(img) {
  const n = img.width * img.height;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const alpha = d[p + 3] / 255;
    const r = LIN[d[p]] * alpha + (1 - alpha);
    const g = LIN[d[p + 1]] * alpha + (1 - alpha);
    const b = LIN[d[p + 2]] * alpha + (1 - alpha);
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    L[i] = 116 * y - 16;
    A[i] = 500 * (x - y);
    B[i] = 200 * (y - z);
  }
  return { L, A, B };
}

/**
 * Difference of one pixel from the paper colour. With `ignoreShadows`, mild
 * darkening of the paper (up to ~40%, as cast shadows are) counts for a
 * quarter and colour is compared after scaling out brightness, so a shadow
 * scores low. Darkening beyond that, and anything lighter than the paper,
 * counts fully, so black or white tokens still stand out.
 */
function difference(l, a, b, bl, ba, bb, ignoreShadows) {
  const dl = l - bl;
  if (!ignoreShadows) return Math.sqrt(dl * dl + (a - ba) ** 2 + (b - bb) ** 2);
  const s = bl / Math.max(l, 8); // bring the pixel's colour up to paper brightness
  const da = a * Math.min(s, 3) - ba;
  const db = b * Math.min(s, 3) - bb;
  let wl;
  if (dl >= 0) wl = dl;
  else {
    const soft = 0.4 * bl;
    const dark = -dl;
    wl = dark <= soft ? 0.25 * dark : 0.25 * soft + (dark - soft);
  }
  return Math.sqrt(wl * wl + da * da + db * db);
}

/** Lab of one sRGB colour (0–255). */
export function labOf([r8, g8, b8]) {
  const r = LIN[Math.round(r8)];
  const g = LIN[Math.round(g8)];
  const b = LIN[Math.round(b8)];
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Difference of one sRGB colour from a paper colour, as the tracer measures it. */
export function colourDifference(rgb, paperRgb, ignoreShadows = true) {
  const [l, a, b] = labOf(rgb);
  const [bl, ba, bb] = labOf(paperRgb);
  return difference(l, a, b, bl, ba, bb, ignoreShadows);
}

const median = (arr) => {
  const s = Float32Array.from(arr).sort();
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * Paper colour everywhere in the image. Pass 1 takes the median of the
 * image border. Pass 2 averages the clearly-paper pixels in a coarse grid and
 * interpolates, so uneven lighting across the page doesn't matter.
 */
export function backgroundModel(img, lab, ignoreShadows) {
  const { width: W, height: H } = img;
  const band = Math.max(2, Math.round(Math.min(W, H) * 0.02));
  const sl = [];
  const sa = [];
  const sb = [];
  const take = (x, y) => {
    const i = y * W + x;
    sl.push(lab.L[i]);
    sa.push(lab.A[i]);
    sb.push(lab.B[i]);
  };
  const step = Math.max(1, Math.round(Math.sqrt((2 * (W + H) * band) / 20000)));
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < band; x += step) take(x, y), take(W - 1 - x, y);
  }
  for (let x = band; x < W - band; x += step) {
    for (let y = 0; y < band; y += step) take(x, y), take(x, H - 1 - y);
  }
  const g = [median(sl), median(sa), median(sb)];

  // Pass 2: local paper colour from pixels far from the global paper difference.
  const cells = 24;
  const cw = W / cells;
  const ch = H / cells;
  const sum = new Float64Array(cells * cells * 3);
  const cnt = new Uint32Array(cells * cells);
  for (let y = 0; y < H; y += 2) {
    const cy = Math.min(cells - 1, Math.floor(y / ch));
    for (let x = 0; x < W; x += 2) {
      const i = y * W + x;
      if (difference(lab.L[i], lab.A[i], lab.B[i], g[0], g[1], g[2], ignoreShadows) > 14) continue;
      const c = cy * cells + Math.min(cells - 1, Math.floor(x / cw));
      sum[c * 3] += lab.L[i];
      sum[c * 3 + 1] += lab.A[i];
      sum[c * 3 + 2] += lab.B[i];
      cnt[c]++;
    }
  }
  const per = ((cw * ch) / 4) * 0.25; // need a quarter of the sampled pixels to trust a cell
  let grid = new Float32Array(cells * cells * 3).fill(NaN);
  for (let c = 0; c < cells * cells; c++) {
    if (cnt[c] >= per) for (let j = 0; j < 3; j++) grid[c * 3 + j] = sum[c * 3 + j] / cnt[c];
  }
  // Fill empty cells from their neighbours (a few rounds), then the global colour.
  for (let round = 0; round < cells; round++) {
    let missing = 0;
    const next = grid.slice();
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const c = cy * cells + cx;
        if (!Number.isNaN(grid[c * 3])) continue;
        const acc = [0, 0, 0];
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= cells || y >= cells) continue;
          const o = y * cells + x;
          if (Number.isNaN(grid[o * 3])) continue;
          for (let j = 0; j < 3; j++) acc[j] += grid[o * 3 + j];
          n++;
        }
        if (n) for (let j = 0; j < 3; j++) next[c * 3 + j] = acc[j] / n;
        else missing++;
      }
    }
    grid = next;
    if (!missing) break;
  }
  for (let c = 0; c < cells * cells; c++) if (Number.isNaN(grid[c * 3])) grid.set(g, c * 3);

  // Bilinear lookup.
  return (x, y) => {
    const gx = Math.max(0, Math.min(cells - 1.0001, x / cw - 0.5));
    const gy = Math.max(0, Math.min(cells - 1.0001, y / ch - 0.5));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const x1 = Math.min(cells - 1, x0 + 1);
    const y1 = Math.min(cells - 1, y0 + 1);
    const v = (cx, cy, j) => grid[(cy * cells + cx) * 3 + j];
    const out = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      out[j] = (v(x0, y0, j) * (1 - tx) + v(x1, y0, j) * tx) * (1 - ty) + (v(x0, y1, j) * (1 - tx) + v(x1, y1, j) * tx) * ty;
    }
    return out;
  };
}

/** Per-pixel difference from the local paper colour. */
export function differenceMap(img, { ignoreShadows = true } = {}) {
  const lab = toLab(img);
  const bg = backgroundModel(img, lab, ignoreShadows);
  const { width: W, height: H } = img;
  const out = new Float32Array(W * H);
  const block = 8; // look the paper colour up per 8×8 block; it changes slowly
  for (let by = 0; by < H; by += block) {
    for (let bx = 0; bx < W; bx += block) {
      const [bl, ba, bb] = bg(bx + block / 2, by + block / 2);
      for (let y = by; y < Math.min(H, by + block); y++) {
        for (let x = bx; x < Math.min(W, bx + block); x++) {
          const i = y * W + x;
          out[i] = difference(lab.L[i], lab.A[i], lab.B[i], bl, ba, bb, ignoreShadows);
        }
      }
    }
  }
  return out;
}

/**
 * Automatic threshold from how much the paper itself varies: the 99th
 * percentile difference in the border band, with headroom, never below 12.
 */
export function paperThreshold(diff, W, H) {
  const band = Math.max(2, Math.round(Math.min(W, H) * 0.02));
  const vals = [];
  const step = Math.max(1, Math.round(Math.sqrt((2 * (W + H) * band) / 20000)));
  for (let y = 0; y < H; y += step) for (let x = 0; x < band; x += step) vals.push(diff[y * W + x], diff[y * W + W - 1 - x]);
  for (let x = band; x < W - band; x += step) for (let y = 0; y < band; y += step) vals.push(diff[y * W + x], diff[(H - 1 - y) * W + x]);
  vals.sort((a, b) => a - b);
  const p99 = vals[Math.floor(vals.length * 0.99)] ?? 0;
  return Math.min(30, Math.max(12, p99 * 1.5 + 3));
}

/** Otsu threshold of a difference map (histogram of 0–100). */
export function otsu(diff) {
  const bins = 256;
  const max = 100;
  const hist = new Float64Array(bins);
  for (let i = 0; i < diff.length; i++) hist[Math.min(bins - 1, Math.floor((diff[i] / max) * bins))]++;
  const total = diff.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  return ((thr + 0.5) / bins) * max;
}

// ---------------------------------------------------------------- masks
/** Square min/max filter (erode when op = min, dilate when op = max). */
function morph(mask, W, H, r, dilate) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  const hit = dilate ? 1 : 0;
  // Horizontal pass with a running count.
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let count = 0;
    for (let x = -r; x < W; x++) {
      const add = x + r;
      if (add < W && mask[row + add] === hit) count++;
      const del = x - r - 1;
      if (del >= 0 && mask[row + del] === hit) count--;
      if (x >= 0) tmp[row + x] = dilate ? (count > 0 ? 1 : 0) : count > 0 ? 0 : 1;
    }
  }
  for (let x = 0; x < W; x++) {
    let count = 0;
    for (let y = -r; y < H; y++) {
      const add = y + r;
      if (add < H && tmp[add * W + x] === hit) count++;
      const del = y - r - 1;
      if (del >= 0 && tmp[del * W + x] === hit) count--;
      if (y >= 0) out[y * W + x] = dilate ? (count > 0 ? 1 : 0) : count > 0 ? 0 : 1;
    }
  }
  return out;
}

export const dilate = (m, W, H, r) => morph(m, W, H, r, true);
export const open = (m, W, H, r) => morph(morph(m, W, H, r, false), W, H, r, true);
export const close = (m, W, H, r) => morph(morph(m, W, H, r, true), W, H, r, false);

/** Fill enclosed holes: anything not reachable from the border through background. */
export function fillHoles(mask, W, H) {
  const seen = new Uint8Array(W * H);
  const stack = [];
  const push = (i) => {
    if (!mask[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) push(x), push((H - 1) * W + x);
  for (let y = 0; y < H; y++) push(y * W), push(y * W + W - 1);
  while (stack.length) {
    const i = stack.pop();
    const x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < W * (H - 1)) push(i + W);
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = mask[i] || !seen[i] ? 1 : 0;
  return out;
}

/** 8-connected components: label image plus { id, area, box, touchesEdge } per component. */
export function components(mask, W, H) {
  const label = new Int32Array(W * H);
  const comps = [];
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || label[start]) continue;
    const id = comps.length + 1;
    const c = { id, area: 0, x0: W, y0: H, x1: 0, y1: 0, touchesEdge: false };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const x = i % W;
      const y = (i - x) / W;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.touchesEdge = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (mask[j] && !label[j]) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
    }
    comps.push(c);
  }
  return { label, comps };
}

/** Paint brush strokes into the mask: add (1) or erase (0). */
export function applyStrokes(mask, W, H, strokes = []) {
  for (const s of strokes) {
    const val = s.mode === "erase" ? 0 : 1;
    const r = Math.max(0.5, s.radius);
    const pts = s.points;
    const stamp = (cx, cy) => {
      const y0 = Math.max(0, Math.floor(cy - r));
      const y1 = Math.min(H - 1, Math.ceil(cy + r));
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(W - 1, Math.ceil(cx + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * W + x] = val;
      }
    };
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) stamp(pts[0][0], pts[0][1]);
      else {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r / 2)));
        for (let k = 1; k <= steps; k++) stamp(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
      }
    }
  }
  return mask;
}

// ---------------------------------------------------------------- outlines
/**
 * Outer outline of one component, at sub-pixel accuracy: the component's
 * mask is softened slightly and traced with marching squares at the 0.5
 * level. Returns points in image pixel coordinates.
 */
export function traceComponent(label, W, H, comp) {
  const pad = 3;
  const x0 = Math.max(0, comp.x0 - pad);
  const y0 = Math.max(0, comp.y0 - pad);
  const x1 = Math.min(W - 1, comp.x1 + pad);
  const y1 = Math.min(H - 1, comp.y1 + pad);
  // Local grid with a guaranteed empty border so every loop closes.
  const w = x1 - x0 + 3;
  const h = y1 - y0 + 3;
  const raw = new Float32Array(w * h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (label[y * W + x] === comp.id) raw[(y - y0 + 1) * w + (x - x0 + 1)] = 1;
  }
  // 3×3 binomial blur: keeps the 0.5 crossing on the pixel edge but rounds the stair steps.
  const k = [1, 2, 1];
  const tmp = new Float32Array(w * h);
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      tmp[i] = (raw[i - 1] * k[0] + raw[i] * k[1] + raw[i + 1] * k[2]) / 4;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      v[i] = (tmp[i - w] * k[0] + tmp[i] * k[1] + tmp[i + w] * k[2]) / 4;
    }
  }

  return marchingSquares(v, w, h, 0.5).map(([x, y]) => [x + x0 - 1, y + y0 - 1]);
}

/**
 * Longest closed isoline of a scalar field (w × h, row-major) at `iso`, in
 * grid coordinates with sub-cell accuracy. Cells at or above `iso` are inside.
 * The field's border should be below `iso` so every loop closes.
 */
export function marchingSquares(v, w, h, iso) {
  // Edge ids: horizontal edge from (x,y) → 2*(y*w+x), vertical → +1.
  const pointOn = (id) => {
    const cell = id >> 1;
    const x = cell % w;
    const y = (cell - x) / w;
    if (id & 1) {
      const a = v[y * w + x];
      const b = v[(y + 1) * w + x];
      return [x, y + (iso - a) / (b - a)];
    }
    const a = v[y * w + x];
    const b = v[y * w + x + 1];
    return [x + (iso - a) / (b - a), y];
  };
  const next = new Map(); // directed: walk with the shape on the left
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = v[y * w + x] >= iso ? 1 : 0;
      const tr = v[y * w + x + 1] >= iso ? 1 : 0;
      const br = v[(y + 1) * w + x + 1] >= iso ? 1 : 0;
      const bl = v[(y + 1) * w + x] >= iso ? 1 : 0;
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const top = 2 * (y * w + x);
      const bottom = 2 * ((y + 1) * w + x);
      const left = 2 * (y * w + x) + 1;
      const right = 2 * (y * w + x + 1) + 1;
      const link = (a, b) => next.set(a, b);
      switch (code) {
        case 1: link(bottom, left); break;
        case 2: link(right, bottom); break;
        case 3: link(right, left); break;
        case 4: link(top, right); break;
        case 5: {
          const centre = (v[y * w + x] + v[y * w + x + 1] + v[(y + 1) * w + x] + v[(y + 1) * w + x + 1]) / 4;
          if (centre >= iso) { link(top, left); link(bottom, right); }
          else { link(top, right); link(bottom, left); }
          break;
        }
        case 6: link(top, bottom); break;
        case 7: link(top, left); break;
        case 8: link(left, top); break;
        case 9: link(bottom, top); break;
        case 10: {
          const centre = (v[y * w + x] + v[y * w + x + 1] + v[(y + 1) * w + x] + v[(y + 1) * w + x + 1]) / 4;
          if (centre >= iso) { link(left, bottom); link(right, top); }
          else { link(left, top); link(right, bottom); }
          break;
        }
        case 11: link(right, top); break;
        case 12: link(left, right); break;
        case 13: link(bottom, right); break;
        case 14: link(left, bottom); break;
      }
    }
  }
  // Walk loops; keep the longest (the outer outline).
  const used = new Set();
  let best = [];
  for (const startId of next.keys()) {
    if (used.has(startId)) continue;
    const loop = [];
    let id = startId;
    while (id !== undefined && !used.has(id)) {
      used.add(id);
      loop.push(id);
      id = next.get(id);
    }
    if (loop.length > best.length) best = loop;
  }
  return best.map(pointOn);
}
