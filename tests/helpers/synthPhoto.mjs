// Synthetic "phone scans" with known geometry, for testing the tracer.
// Shapes are defined in mm; the camera maps mm → px with separate X/Y scales
// and a rotation (like a slightly skewed scan). Shadows, uneven light and
// noise make it realistic.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Shapes: { kind: 'square'|'circle'|'poly', ...geometry in mm, color: [r,g,b] }. */
export const shapeTest = (s) => {
  if (s.kind === "circle") return (x, y) => (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && inPoly(x, y, s.points);
};

export const square = (cx, cy, size, color = [20, 20, 20]) => ({
  kind: "poly",
  points: [[cx - size / 2, cy - size / 2], [cx + size / 2, cy - size / 2], [cx + size / 2, cy + size / 2], [cx - size / 2, cy + size / 2]],
  color,
});
export const circle = (cx, cy, r, color) => ({ kind: "circle", cx, cy, r, color });
export function star(cx, cy, rOut, rIn, n, color) {
  const points = [];
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 ? rIn : rOut;
    const a = (Math.PI * i) / n - Math.PI / 2;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return { kind: "poly", points, color };
}
export const polyArea = (pts) => Math.abs(pts.reduce((s, [x1, y1], i) => {
  const [x2, y2] = pts[(i + 1) % pts.length];
  return s + x1 * y2 - x2 * y1;
}, 0)) / 2;

/**
 * Render a photo.
 * @param o { mmW, mmH, pxPerMmX, pxPerMmY, rotationDeg, shapes, paper, shadow (mm offset, 0 = none), shadowStrength, gradient, noise, seed }
 */
export function makePhoto(o) {
  const { mmW, mmH, pxPerMmX = 8, pxPerMmY = 8, rotationDeg = 0, shapes, paper = [245, 244, 240], shadow = 0, shadowStrength = 0.35, gradient = 0.08, noise = 4, seed = 1 } = o;
  const W = Math.round(mmW * pxPerMmX);
  const H = Math.round(mmH * pxPerMmY);
  const th = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  // px → mm (inverse of: scale per axis after rotating about the page centre)
  const toMm = (px, py) => {
    const u = px / pxPerMmX - mmW / 2;
    const v = py / pxPerMmY - mmH / 2;
    return [u * c + v * s + mmW / 2, -u * s + v * c + mmH / 2];
  };
  const tests = shapes.map((sh) => ({ test: shapeTest(sh), color: sh.color, sh }));
  const ss = 3; // supersampling per axis

  // Shadow coverage (offset copies of every shape), blurred.
  let shade = new Float32Array(W * H);
  if (shadow > 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [mx, my] = toMm(x + 0.5, y + 0.5);
        for (const t of tests) if (t.test(mx - shadow, my - shadow)) { shade[y * W + x] = 1; break; }
      }
    }
    const r = Math.round(shadow * 0.8 * pxPerMmX);
    const blur = (src, horizontal) => {
      const out = new Float32Array(W * H);
      for (let a = 0; a < (horizontal ? H : W); a++) {
        let acc = 0;
        const len = horizontal ? W : H;
        const at = (b) => (horizontal ? a * W + b : b * W + a);
        for (let b = -r; b < len + r; b++) {
          if (b + r < len) acc += src[at(Math.min(len - 1, b + r))];
          if (b - r - 1 >= 0) acc -= src[at(b - r - 1)];
          if (b >= 0 && b < len) out[at(b)] = acc / (2 * r + 1);
        }
      }
      return out;
    };
    shade = blur(blur(shade, true), false);
  }

  const rand = rng(seed);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const light = 1 - gradient * (x / W) - (gradient / 2) * (y / H);
      const dark = 1 - shadowStrength * shade[y * W + x];
      let col = paper.map((v) => v * light * dark);
      // Anti-aliased shapes: average of sub-samples.
      const acc = [0, 0, 0];
      let any = false;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const [mx, my] = toMm(x + (i + 0.5) / ss, y + (j + 0.5) / ss);
          let hit = null;
          for (const t of tests) if (t.test(mx, my)) { hit = t.color; break; }
          const v = hit ? hit.map((q) => q * light) : col;
          if (hit) any = true;
          acc[0] += v[0];
          acc[1] += v[1];
          acc[2] += v[2];
        }
      }
      if (any) col = acc.map((v) => v / (ss * ss));
      const p = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) data[p + k] = col[k] + (rand() - 0.5) * 2 * noise;
      data[p + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}
