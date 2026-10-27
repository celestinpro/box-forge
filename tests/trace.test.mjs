// Tracer accuracy on synthetic scans with known geometry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePhoto, square, circle, star, polyArea } from "./helpers/synthPhoto.mjs";
import { prepare, trace } from "../src/trace/trace.js";
import { centroid, outlineDistance } from "../src/trace/geometry.js";

const ORANGE = [235, 130, 30];
const PURPLE = [110, 60, 170];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(3)} vs ${b} (±${tol})`);
const circleToken = (r) => r.tokens.find((t) => Math.abs(t.w - t.h) < 0.5 && t.points.length < 100);

test("clean scan: exact scale, circle and star traced to within 0.1 mm", () => {
  const st = star(130, 40, 16, 7, 5, PURPLE);
  const img = makePhoto({ mmW: 170, mmH: 125, shapes: [square(40, 45, 50), circle(120, 95, 12, ORANGE), st] });
  const r = trace(prepare(img));
  assert.equal(r.calibration.source, "square");
  near(r.calibration.mmPerPxX, 0.125, 0.0002, "mm per px X");
  near(r.calibration.mmPerPxY, 0.125, 0.0002, "mm per px Y");
  assert.equal(r.tokens.length, 2);
  const c = circleToken(r);
  near(c.w, 24, 0.1, "circle width");
  near(c.h, 24, 0.1, "circle height");
  const s = r.tokens.find((t) => t !== c);
  near(s.area, polyArea(st.points), polyArea(st.points) * 0.02, "star area");
  const cc = centroid(st.points);
  const truth = st.points.map(([x, y]) => [x - cc[0], -(y - cc[1])]);
  const worst = Math.max(...s.points.map((p) => outlineDistance(p, truth)));
  assert.ok(worst < 0.15, `star outline within 0.15 mm everywhere (worst ${worst.toFixed(3)})`);
});

test("skewed, rotated scan with shadows: X/Y scale corrected separately", () => {
  const img = makePhoto({
    mmW: 170, mmH: 125, pxPerMmX: 8, pxPerMmY: 8.25, rotationDeg: 3, shadow: 1.5,
    shapes: [square(40, 45, 50), circle(120, 95, 12, ORANGE), star(130, 40, 16, 7, 5, PURPLE)],
  });
  const r = trace(prepare(img));
  near(r.calibration.mmPerPxX, 1 / 8, 0.0004, "mm per px X");
  near(r.calibration.mmPerPxY, 1 / 8.25, 0.0004, "mm per px Y");
  assert.ok(r.warnings.some((w) => /out of square/.test(w)), "warns about the 3% skew");
  const c = circleToken(r);
  near(c.w, 24, 0.2, "circle width");
  near(c.h, 24, 0.2, "circle height");
});

test("black token with a hard shadow on white paper: shadow left out", () => {
  const img = makePhoto({ mmW: 150, mmH: 90, shadow: 2, shadowStrength: 0.4, shapes: [square(35, 45, 50), circle(110, 45, 15, [25, 25, 30])] });
  const r = trace(prepare(img));
  const c = circleToken(r);
  near(c.w, 30, 0.25, "circle width");
  near(c.h, 30, 0.25, "circle height");
});

test("white token on blue paper", () => {
  const img = makePhoto({ mmW: 150, mmH: 90, paper: [60, 110, 190], shadow: 1.5, shapes: [square(35, 45, 50, [250, 250, 250]), circle(110, 45, 15, [245, 242, 235])] });
  const r = trace(prepare(img));
  assert.equal(r.calibration.source, "square");
  const c = circleToken(r);
  near(c.w, 30, 0.25, "circle width");
});

test("brush: erase removes a token, add creates one", () => {
  const img = makePhoto({ mmW: 150, mmH: 90, shapes: [square(35, 45, 50), circle(110, 45, 12, ORANGE)] });
  const prep = prepare(img);
  const cx = 110 * 8;
  const cy = 45 * 8;
  const erased = trace(prep, { strokes: [{ mode: "erase", radius: 110, points: [[cx, cy]] }] });
  assert.equal(erased.tokens.length, 0);
  const added = trace(prep, { strokes: [{ mode: "add", radius: 40, points: [[1000, 600]] }] });
  assert.equal(added.tokens.length, 2);
  const blob = added.tokens.find((t) => t.w < 15);
  near(blob.w, 10, 0.3, "painted blob width"); // 80 px diameter at 8 px/mm
});

test("no square: explains, and a known scale (from an SVG) still works", () => {
  const img = makePhoto({ mmW: 120, mmH: 80, shapes: [circle(60, 40, 12, ORANGE)] });
  const prep = prepare(img);
  const r = trace(prep);
  assert.equal(r.calibration.ok, false);
  assert.equal(r.tokens.length, 0);
  assert.ok(r.warnings.some((w) => /Couldn't find the 50 mm square/.test(w)));
  const scaled = trace(prep, { mmPerPx: 0.125 });
  near(circleToken(scaled).w, 24, 0.1, "circle width from known scale");
});

test("shapes touching the photo edge are skipped unless included", () => {
  const img = makePhoto({ mmW: 150, mmH: 90, shapes: [square(35, 45, 50), circle(150, 45, 12, ORANGE)] });
  const prep = prepare(img);
  const r = trace(prep);
  assert.equal(r.tokens.length, 0);
  const edge = r.shapes.find((s) => s.touchesEdge);
  assert.match(edge.skipped, /edge/);
  assert.equal(trace(prep, { includeEdge: new Set([edge.id]) }).tokens.length, 1);
});

test("blurry edges (lens blur, JPEG colour bleed): sizes stay unbiased", () => {
  const img = makePhoto({ mmW: 150, mmH: 90, shapes: [square(35, 45, 50), circle(110, 45, 12, ORANGE)] });
  // 5×5 box blur on every channel: edges smeared over ~0.6 mm.
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const r = 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        let n = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.min(W - 1, Math.max(0, x + dx));
            const yy = Math.min(H - 1, Math.max(0, y + dy));
            s += data[(yy * W + xx) * 4 + k];
            n++;
          }
        }
        out[(y * W + x) * 4 + k] = s / n;
      }
      out[(y * W + x) * 4 + 3] = 255;
    }
  }
  const prep = prepare({ width: W, height: H, data: out });
  for (const threshold of [undefined, 25]) {
    const res = trace(prep, { threshold });
    near(res.calibration.mmPerPxX, 0.125, 0.0003, "mm per px");
    near(circleToken(res).w, 24, 0.12, `circle width (threshold ${threshold ?? "auto"})`);
  }
});
