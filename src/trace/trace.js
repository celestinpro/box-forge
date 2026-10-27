// Photo → token outlines in millimetres.
//
//   1. Difference from the paper colour (local, so uneven light is fine).
//   2. Threshold (auto by default), small clean-up, the user's brush strokes,
//      fill holes, split into separate shapes.
//   3. Find the reference square and fit an affine scale correction from its
//      corners: the "50 / measured X, 50 / measured Y" step, generalised so a
//      slightly rotated or sheared square still calibrates correctly.
//   4. Trace each remaining shape at sub-pixel accuracy, convert to mm,
//      simplify to ~0.04 mm.
import { differenceMap, paperThreshold, close, fillHoles, components, applyStrokes, traceComponent, colourDifference, dilate } from "./image.js";
import { area, ccw, centroid, simplify, minAreaRect, fitAffine, bbox } from "./geometry.js";

/**
 * Put each shape's edge halfway between the paper and that shape's own
 * colour, instead of at the low threshold used to find it. A fixed low
 * threshold reads blur (JPEG colour bleed, lens blur, anti-aliasing) as part
 * of the token and makes it too big. The level used is what a 50/50 mix of
 * the token's colour and the nearby paper colour scores, so it is exact for
 * blur whatever the colours, and shadows are still ignored.
 */
function refineEdges(coarse, comps, diff, rgba, W, H, threshold, floor, added, ignoreShadows) {
  const band = Math.max(3, Math.round(Math.min(W, H) / 500)); // how far an edge may move outward
  const label = new Int32Array(W * H);
  const med = (arr) => {
    if (!arr.length) return null;
    arr.sort((a, b) => a - b);
    return arr[arr.length >> 1];
  };
  for (const c of comps) {
    // Token colour: median of the shape's most distinct half.
    const inside = [];
    const step = Math.max(1, Math.round(Math.sqrt(c.area / 4000)));
    for (let y = c.y0; y <= c.y1; y += step) {
      for (let x = c.x0; x <= c.x1; x += step) {
        const i = y * W + x;
        if (coarse[i] === c.id) inside.push(i);
      }
    }
    const cut = med(inside.map((i) => diff[i])) ?? threshold;
    const core = inside.filter((i) => diff[i] >= cut);
    // Paper colour: clear paper in a ring around the shape.
    const pad = Math.max(6, Math.round(Math.max(c.x1 - c.x0, c.y1 - c.y0) * 0.15));
    const ring = [];
    const rs = Math.max(1, Math.round(pad / 4));
    for (let y = Math.max(0, c.y0 - pad); y <= Math.min(H - 1, c.y1 + pad); y += rs) {
      for (let x = Math.max(0, c.x0 - pad); x <= Math.min(W - 1, c.x1 + pad); x += rs) {
        const i = y * W + x;
        if (!coarse[i] && diff[i] < threshold / 2) ring.push(i);
      }
    }
    // Edge level: a 50/50 mix of token and paper, but never below the
    // paper's own noise level (so shadows and grain stay out).
    let t = Math.max(floor, Math.min(threshold, floor));
    if (rgba && core.length && ring.length) {
      const chan = (idx, k) => med(idx.map((i) => rgba[i * 4 + k]));
      const tok = [0, 1, 2].map((k) => chan(core, k));
      const paper = [0, 1, 2].map((k) => chan(ring, k));
      const mix = tok.map((v, k) => (v + paper[k]) / 2);
      t = Math.max(floor, colourDifference(mix, paper, ignoreShadows));
    }
    // Pixels at that level, within a few pixels of the detected shape (so a
    // high sensitivity setting can't shave the edge, and neighbours stay out).
    const x0 = Math.max(0, c.x0 - band);
    const y0 = Math.max(0, c.y0 - band);
    const x1 = Math.min(W - 1, c.x1 + band);
    const y1 = Math.min(H - 1, c.y1 + band);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    let near = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (coarse[(y + y0) * W + x + x0] === c.id) near[y * w + x] = 1;
    }
    near = dilate(near, w, h, band);
    let local = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y + y0) * W + x + x0;
        const other = coarse[i] && coarse[i] !== c.id;
        if (near[y * w + x] && !other && (diff[i] > t || added[i])) local[y * w + x] = 1;
      }
    }
    local = fillHoles(local, w, h);
    const { label: ll, comps: parts } = components(local, w, h);
    if (!parts.length) continue;
    const main = parts.reduce((a, b) => (b.area > a.area ? b : a));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (ll[y * w + x] === main.id && !label[(y + y0) * W + x + x0]) label[(y + y0) * W + x + x0] = c.id;
    }
    c.x0 = x0 + main.x0;
    c.y0 = y0 + main.y0;
    c.x1 = x0 + main.x1;
    c.y1 = y0 + main.y1;
    c.area = main.area;
  }
  return label;
}

/** Expensive, per-image step: the difference map and its automatic threshold. */
export function prepare(img, { ignoreShadows = true } = {}) {
  const diff = differenceMap(img, { ignoreShadows });
  return { width: img.width, height: img.height, diff, rgba: img.data, autoThreshold: paperThreshold(diff, img.width, img.height), ignoreShadows };
}

/** How square a traced outline (pixel coords) is: 0 = not, ~1 = perfect. */
function squareness(outline, polyArea) {
  const r = minAreaRect(outline);
  const rect = polyArea / r.area;
  const aspect = Math.min(r.w, r.h) / Math.max(r.w, r.h);
  return { score: rect > 0.9 && aspect > 0.8 ? rect * aspect : 0, rect, aspect, r };
}

/** Image px (y down) → y-up coordinates, so mm outlines come out the right way round. */
const up = (pts) => pts.map(([x, y]) => [x, -y]);

/**
 * Corners of the reference square: fit a straight line to each side (ignoring
 * the slightly rounded corner regions) and intersect neighbouring sides.
 */
function squareCorners(pts) {
  const r = minAreaRect(pts);
  const c = Math.cos(-r.angle);
  const s = Math.sin(-r.angle);
  const local = pts.map(([x, y]) => {
    const u = x - r.center[0];
    const v = y - r.center[1];
    return [u * c - v * s, u * s + v * c];
  });
  const hw = r.w / 2;
  const hh = r.h / 2;
  // Side k: 0 = bottom (v = -hh), 1 = right (u = hw), 2 = top, 3 = left.
  const sides = [[], [], [], []];
  for (let i = 0; i < pts.length; i++) {
    const [u, v] = local[i];
    const d = [Math.abs(v + hh), Math.abs(u - hw), Math.abs(v - hh), Math.abs(u + hw)];
    const k = d.indexOf(Math.min(...d));
    const along = k % 2 === 0 ? Math.abs(u) / hw : Math.abs(v) / hh;
    if (along < 0.85) sides[k].push(pts[i]);
  }
  // Total least squares line through each side: point + direction.
  const lines = sides.map((ps) => {
    const n = ps.length;
    const mx = ps.reduce((a, p) => a + p[0], 0) / n;
    const my = ps.reduce((a, p) => a + p[1], 0) / n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const [x, y] of ps) {
      sxx += (x - mx) ** 2;
      sxy += (x - mx) * (y - my);
      syy += (y - my) ** 2;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { p: [mx, my], d: [Math.cos(theta), Math.sin(theta)] };
  });
  const meet = (A, B) => {
    const det = A.d[0] * -B.d[1] - A.d[1] * -B.d[0];
    const t = ((B.p[0] - A.p[0]) * -B.d[1] - (B.p[1] - A.p[1]) * -B.d[0]) / det;
    return [A.p[0] + t * A.d[0], A.p[1] + t * A.d[1]];
  };
  // Corner order matches minAreaRect: bottom-left, bottom-right, top-right, top-left.
  return { corners: [meet(lines[3], lines[0]), meet(lines[0], lines[1]), meet(lines[1], lines[2]), meet(lines[2], lines[3])], angle: r.angle };
}

/** Affine calibration from the reference square's four corners. */
function calibrateFromSquare(outline, size) {
  const pts = up(outline);
  const { corners, angle } = squareCorners(pts);
  const h = size / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const targets = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([u, v]) => [u * c - v * s, u * s + v * c]);
  const fit = fitAffine(corners, targets);
  const [a, b, , d, e] = fit.matrix;
  const mmPerPxX = Math.hypot(a, d);
  const mmPerPxY = Math.hypot(b, e);
  // How far the photo is from square-on: measured sides in px.
  const sideX = size / mmPerPxX;
  const sideY = size / mmPerPxY;
  return { ok: true, source: "square", apply: (p) => fit.apply([p[0], -p[1]]), mmPerPxX, mmPerPxY, sidePx: [sideX, sideY], aspectError: Math.abs(mmPerPxX / mmPerPxY - 1), corners: corners.map(([x, y]) => [x, -y]) };
}

/**
 * Trace a prepared image.
 * @param prep result of prepare()
 * @param opts { threshold, strokes, referenceSize, referenceId, includeEdge: Set<id>, mmPerPx (fallback scale), minTokenMm }
 */
export function trace(prep, opts = {}) {
  const { width: W, height: H, diff } = prep;
  const threshold = opts.threshold ?? prep.autoThreshold;
  const referenceSize = opts.referenceSize ?? 50;
  const warnings = [];

  // 1–2. Mask and shapes.
  let mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = diff[i] > threshold ? 1 : 0;
  const r = Math.max(1, Math.round(Math.min(W, H) / 1500));
  mask = close(mask, W, H, r); // bridge 1-px gaps; specks are dropped by size below
  applyStrokes(mask, W, H, opts.strokes);
  mask = fillHoles(mask, W, H);
  const { label: coarse, comps } = components(mask, W, H);
  // Pixels the user painted in with "Add" always count, whatever the threshold.
  const added = new Uint8Array(W * H);
  applyStrokes(added, W, H, (opts.strokes || []).filter((s) => s.mode !== "erase"));
  const label = refineEdges(coarse, comps, diff, prep.rgba, W, H, threshold, prep.autoThreshold, added, prep.ignoreShadows !== false);
  const minPx = Math.max(30, W * H * 0.00015);

  // Average colour of each shape (for the token list swatches).
  const colours = new Map();
  if (prep.rgba) {
    const acc = new Float64Array((comps.length + 1) * 4);
    for (let i = 0; i < W * H; i += 3) {
      const id = label[i];
      if (!id) continue;
      acc[id * 4] += prep.rgba[i * 4];
      acc[id * 4 + 1] += prep.rgba[i * 4 + 1];
      acc[id * 4 + 2] += prep.rgba[i * 4 + 2];
      acc[id * 4 + 3]++;
    }
    for (const c of comps) {
      const n = acc[c.id * 4 + 3] || 1;
      colours.set(c.id, [0, 1, 2].map((k) => Math.round(acc[c.id * 4 + k] / n)));
    }
  }

  const shapes = [];
  for (const c of comps) {
    if (c.area < minPx) continue;
    const outline = traceComponent(label, W, H, c);
    if (outline.length < 8) continue;
    const a = Math.abs(area(outline));
    const sq = squareness(outline, a);
    shapes.push({
      id: c.id,
      outline,
      display: simplify(outline, 0.6),
      areaPx: a,
      box: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 },
      at: centroid(outline),
      touchesEdge: c.touchesEdge,
      squareScore: sq.score,
      colour: colours.get(c.id) ?? [128, 128, 128],
    });
  }

  // 3. Reference square and calibration.
  let reference = opts.referenceId != null ? shapes.find((s) => s.id === opts.referenceId) : null;
  if (!reference) {
    const candidates = shapes.filter((s) => s.squareScore > 0 && !s.touchesEdge).sort((p, q) => q.squareScore - p.squareScore || q.areaPx - p.areaPx);
    reference = candidates[0] ?? null;
  }
  let cal = { ok: false, source: "none" };
  if (reference) {
    cal = calibrateFromSquare(reference.outline, referenceSize);
    if (cal.aspectError > 0.03) {
      warnings.push(`The square measures ${cal.sidePx[0].toFixed(0)} × ${cal.sidePx[1].toFixed(0)} px, ${(cal.aspectError * 100).toFixed(1)}% out of square. That's been corrected, but a straighter top-down photo will be more accurate.`);
    }
  } else if (opts.mmPerPx > 0) {
    const k = opts.mmPerPx;
    cal = { ok: true, source: "file", apply: ([x, y]) => [x * k, -y * k], mmPerPxX: k, mmPerPxY: k, aspectError: 0 };
  } else {
    warnings.push(`Couldn't find the ${referenceSize} mm square. Make sure it's fully in the photo on the same paper, or pick it from the list.`);
  }

  // 4. Tokens.
  const tokens = [];
  const minArea = (opts.minTokenMm ?? 3) ** 2;
  for (const s of shapes) {
    s.isReference = s === reference;
    if (s.isReference) continue;
    if (s.touchesEdge && !opts.includeEdge?.has(s.id)) {
      s.skipped = "touches the edge of the photo";
      continue;
    }
    if (!cal.ok) continue;
    let pts = ccw(simplify(s.outline.map(cal.apply), 0.04));
    const mmArea = area(pts);
    if (mmArea < minArea) {
      s.skipped = "too small";
      continue;
    }
    const c = centroid(pts);
    pts = pts.map(([x, y]) => [x - c[0], y - c[1]]);
    const b = bbox(pts);
    tokens.push({ id: s.id, points: pts, area: mmArea, w: b.w, h: b.h, at: s.at, colour: s.colour });
  }
  // Number tokens top-to-bottom, left-to-right, as they appear in the photo.
  const rowH = H / 12;
  tokens.sort((p, q) => Math.floor(p.at[1] / rowH) - Math.floor(q.at[1] / rowH) || p.at[0] - q.at[0]);

  return {
    width: W,
    height: H,
    threshold,
    autoThreshold: prep.autoThreshold,
    shapes: shapes.map(({ outline, ...rest }) => rest),
    referenceId: reference?.id ?? null,
    calibration: { ok: cal.ok, source: cal.source, mmPerPxX: cal.mmPerPxX, mmPerPxY: cal.mmPerPxY, sidePx: cal.sidePx, aspectError: cal.aspectError, corners: cal.corners },
    tokens,
    warnings,
  };
}
