// 2D geometry helpers for token outlines. Points are [x, y] arrays; polygons
// are closed implicitly (the last point connects back to the first).

export const area = (poly) => {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2; // positive when counter-clockwise (y up)
};

export function centroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bbox(poly) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export const ccw = (poly) => (area(poly) < 0 ? poly.slice().reverse() : poly);

export function transform(poly, { angle = 0, dx = 0, dy = 0, about = [0, 0] } = {}) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return poly.map(([x, y]) => {
    const u = x - about[0];
    const v = y - about[1];
    return [about[0] + u * c - v * s + dx, about[1] + u * s + v * c + dy];
  });
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from point p to segment ab. */
export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Distance from a point to a polygon's outline (0 on the edge). */
export function outlineDistance(p, poly) {
  let d = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) d = Math.min(d, segmentDistance(p, poly[i], poly[(i + 1) % n]));
  return d;
}

function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/**
 * Gap between two polygons: 0 if they touch or overlap, else the smallest
 * distance between their outlines. Bounding boxes skip far-apart pairs.
 */
export function polygonGap(A, B, bbA = bbox(A), bbB = bbox(B), stopBelow = 0) {
  const boxGap = Math.max(bbA.x0 - bbB.x1, bbB.x0 - bbA.x1, bbA.y0 - bbB.y1, bbB.y0 - bbA.y1, 0);
  if (boxGap > stopBelow && stopBelow > 0) return boxGap;
  if (pointInPolygon(A[0], B) || pointInPolygon(B[0], A)) return 0;
  let d = Infinity;
  for (let i = 0, n = A.length; i < n; i++) {
    const a = A[i];
    const b = A[(i + 1) % n];
    for (let j = 0, m = B.length; j < m; j++) {
      const c = B[j];
      const e = B[(j + 1) % m];
      if (segmentsIntersect(a, b, c, e)) return 0;
    }
  }
  for (const p of A) d = Math.min(d, outlineDistance(p, B));
  for (const p of B) d = Math.min(d, outlineDistance(p, A));
  return d;
}

/** Douglas–Peucker simplification of a closed polygon. */
export function simplify(poly, tol) {
  if (poly.length < 8) return poly;
  // Split at the two points furthest apart so the closed loop becomes two open chains.
  let i0 = 0;
  let i1 = 0;
  let best = -1;
  const c = centroid(poly);
  for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(poly[i][0] - c[0], poly[i][1] - c[1]);
    if (d > best) {
      best = d;
      i0 = i;
    }
  }
  best = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(poly[i][0] - poly[i0][0], poly[i][1] - poly[i0][1]);
    if (d > best) {
      best = d;
      i1 = i;
    }
  }
  const chain = (from, to) => {
    const out = [];
    for (let i = from; ; i = (i + 1) % poly.length) {
      out.push(poly[i]);
      if (i === to) break;
    }
    return out;
  };
  const dp = (pts) => {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let maxD = 0;
      let idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = segmentDistance(pts[i], pts[s], pts[e]);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (maxD > tol && idx > 0) {
        keep[idx] = 1;
        stack.push([s, idx], [idx, e]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const a = dp(chain(i0, i1));
  const b = dp(chain(i1, i0));
  return a.concat(b.slice(1, -1));
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points) {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Smallest-area enclosing rectangle: { angle, w, h, center, corners }. */
export function minAreaRect(points) {
  const hull = convexHull(points);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of hull) {
      const u = x * c - y * s;
      const v = x * s + y * c;
      x0 = Math.min(x0, u);
      x1 = Math.max(x1, u);
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
    const ar = (x1 - x0) * (y1 - y0);
    if (!best || ar < best.area) best = { area: ar, angle, x0, x1, y0, y1 };
  }
  const { angle, x0, x1, y0, y1 } = best;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const back = ([u, v]) => [u * c - v * s, u * s + v * c];
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(back);
  return { angle, w: x1 - x0, h: y1 - y0, area: best.area, center: back([(x0 + x1) / 2, (y0 + y1) / 2]), corners };
}

/** Least-squares affine map from points src[i] to dst[i]: returns f([x, y]) and the matrix. */
export function fitAffine(src, dst) {
  // Solve [x y 1] * [a b c]^T = X and same for Y via normal equations.
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const vx = [0, 0, 0];
  const vy = [0, 0, 0];
  for (let i = 0; i < src.length; i++) {
    const r = [src[i][0], src[i][1], 1];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) M[j][k] += r[j] * r[k];
      vx[j] += r[j] * dst[i][0];
      vy[j] += r[j] * dst[i][1];
    }
  }
  const solve = (A, v) => {
    const m = A.map((row, i) => [...row, v[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
      [m[i], m[p]] = [m[p], m[i]];
      for (let r = 0; r < 3; r++) {
        if (r === i) continue;
        const f = m[r][i] / m[i][i];
        for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c];
      }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  };
  const [a, b, c] = solve(M, vx);
  const [d, e, f] = solve(M, vy);
  const apply = ([x, y]) => [a * x + b * y + c, d * x + e * y + f];
  return { apply, matrix: [a, b, c, d, e, f] };
}

/** Polygon as an SVG path string. */
export const toPath = (poly, digits = 3) =>
  "M" + poly.map(([x, y]) => `${x.toFixed(digits)} ${y.toFixed(digits)}`).join("L") + "Z";
