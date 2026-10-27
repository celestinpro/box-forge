// Token insert: traced tokens → packed pockets → printable tray.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import opencascade from "replicad-opencascadejs";
import { setOC, getOC, measureVolume, draw } from "replicad";
import { MODELS } from "../src/models/index.js";
import { autoPack, analyse, placed } from "../src/trace/layout.js";
import { pocketOutline } from "../src/trace/outline.js";
import { area, bbox, outlineDistance } from "../src/trace/geometry.js";

before(async () => {
  const wasm = fileURLToPath(new URL("../node_modules/replicad-opencascadejs/dist/replicad_single.wasm", import.meta.url));
  setOC(await opencascade({ locateFile: () => wasm }));
});
const ce = console.error;
console.error = (...a) => { if (!/compute a normal/.test(String(a[0]))) ce(...a); };

const valid = (shape) => {
  const a = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true, false, false);
  const ok = a.IsValid();
  a.delete();
  return ok;
};
const circlePts = (r, n = 64) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
const blob = (k) => Array.from({ length: 90 }, (_, i) => {
  const a = (2 * Math.PI * i) / 90;
  const r = k * (1 + 0.28 * Math.cos(3 * a) + 0.12 * Math.sin(5 * a));
  return [r * Math.cos(a), r * Math.sin(a)];
});
const token = (id, points, extra = {}) => {
  const b = bbox(points);
  return { id, name: `T${id}`, points, w: b.w, h: b.h, thickness: 3, count: 1, ...extra };
};

test("pocket outline: exact clearance, notch joined with rounded inside corners", () => {
  const sq = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const g = pocketOutline(sq, { grow: 0.25 });
  const errs = g.map((p) => outlineDistance(p, sq) - 0.25);
  assert.ok(Math.max(...errs.map(Math.abs)) < 0.02, `offset within 0.02 mm (worst ${Math.max(...errs.map(Math.abs)).toFixed(3)})`);
  assert.ok(Math.abs(bbox(pocketOutline(sq, { grow: -0.15 })).w - 19.7) < 0.02);
  const n = pocketOutline(sq, { grow: 0.25, notch: { x: 10, y: 0, r: 8 }, round: 1.5 });
  assert.ok(Math.abs(bbox(n).x1 - 18) < 0.03, "notch reaches 8 mm past the edge");
  assert.ok(area(n) > area(g) + 90, "notch adds area");
});

test("auto-pack: no overlaps, every pocket has a notch", () => {
  const tokens = [token(1, circlePts(11), { count: 3, stack: false }), token(2, blob(14)), token(3, blob(10))];
  const { items, missed } = autoPack(tokens);
  assert.equal(items.length, 5);
  assert.deepEqual(missed, []);
  const A = analyse(tokens, items);
  assert.equal(A.problems.length, 0);
  assert.ok([...A.notches.values()].every(Boolean));
});

test("insert: valid tray, each token fits with exactly the clearance", () => {
  const tokens = [token(1, circlePts(11), { count: 2, stack: false }), token(2, blob(14), { thickness: 5 }), token(3, blob(10), { thickness: 2, count: 4 })];
  const { items } = autoPack(tokens);
  const out = MODELS["token-insert"].build({ tokens, items, settings: { inlay: true } });
  const [tray, inlays] = out.parts.map((p) => p.shape);
  assert.ok(valid(tray) && valid(inlays));
  const L = out.layout;
  assert.equal(+L.height.toFixed(2), +(Math.max(3, 5, 2 * 4) + 0.6 + 1.2).toFixed(2), "height = deepest pocket (stack of 4 × 2 mm + inlay) + floor");
  const overlap = (s) => {
    try {
      return measureVolume(tray.clone().intersect(s));
    } catch {
      return 0;
    }
  };
  L.items.forEach((it, i) => {
    const t = L.byId.get(it.tokenId);
    const pts = placed(t, it).map(([x, y]) => [x - L.tray.x0, y - L.tray.y0]);
    const prism = (grow) => {
      const o = grow ? pocketOutline(pts, { grow }) : pts;
      let pen = draw(o[0]);
      for (const p of o.slice(1)) pen = pen.lineTo(p);
      const z = L.height - L.depths[i] + 0.6 + 0.01;
      return pen.close().sketchOnPlane("XY", z).extrude(L.height - z - 0.01);
    };
    assert.ok(overlap(prism(0)) < 0.01, `${t.name} drops into its pocket`);
    assert.ok(overlap(prism(0.3)) > 0.5, `${t.name}'s pocket isn't oversized`);
  });
});

test("insert: explains overlaps, pockets outside a set tray, and too-low height", () => {
  const tokens = [token(1, circlePts(10)), token(2, circlePts(10))];
  const items = [{ key: "1:0", tokenId: 1, x: 20, y: 20, angle: 0 }, { key: "2:0", tokenId: 2, x: 35, y: 20, angle: 0 }];
  assert.throws(() => MODELS["token-insert"].build({ tokens, items }), /too close/);
  const apart = [items[0], { ...items[1], x: 60 }];
  assert.throws(() => MODELS["token-insert"].build({ tokens, items: apart, settings: { sizeMode: "set", width: 50, depth: 40 } }), /outside the tray/);
  assert.throws(() => MODELS["token-insert"].build({ tokens, items: apart, settings: { heightMode: "set", height: 3 } }), /needs 4\.2 mm/);
});
