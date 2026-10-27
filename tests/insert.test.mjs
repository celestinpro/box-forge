// Token insert: traced tokens → packed pockets → printable tray.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import opencascade from "replicad-opencascadejs";
import { setOC, getOC, measureVolume, draw, drawCircle } from "replicad";
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

// Lift cutouts: the smallest wall left between a cutout and any token outline.
const liftWall = (A) => {
  let worst = Infinity;
  for (const c of A.lifts) {
    for (let i = 0; i < 360; i++) {
      const a = (2 * Math.PI * i) / 360;
      const p = [c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)];
      const { x0, y0, w, h } = A.tray;
      if (p[0] < x0 || p[1] < y0 || p[0] > x0 + w || p[1] > y0 + h) continue; // only the part that cuts the tray
      for (const s of A.shapes) worst = Math.min(worst, outlineDistance(p, s.poly));
    }
  }
  return worst;
};

test("lift cutouts: on both long sides, a full wall from every pocket, valid tray", () => {
  const tokens = [token(1, circlePts(11), { count: 3, stack: false }), token(2, blob(14)), token(3, blob(10))];
  const { items } = autoPack(tokens);
  const settings = { lift: true };
  const A = analyse(tokens, items, settings);
  const long = A.tray.w >= A.tray.h ? ["front", "back"] : ["left", "right"];
  assert.deepEqual(A.lifts.map((c) => c.side).sort(), long.sort());
  assert.ok(A.lifts.every((c) => c.depth === 8 && c.width === 20));
  assert.ok(liftWall(A) >= 0.25 + 1.6 - 0.01, `wall to pockets ${liftWall(A).toFixed(2)} mm`);
  const out = MODELS["token-insert"].build({ tokens, items, settings });
  const tray = out.parts.find((p) => p.name === "tray").shape;
  assert.ok(valid(tray));
  for (const c of A.lifts) {
    // Nothing of the tray is left inside the bite (shrunk 0.05 mm for tolerance).
    const L = out.layout;
    const bite = drawCircle(c.r - 0.05).sketchOnPlane("XY", -1).extrude(L.height + 2).translate([c.cx - L.tray.x0, c.cy - L.tray.y0, 0]);
    assert.ok(measureVolume(tray.clone().intersect(bite)) < 0.01, `${c.side} bite is empty`);
  }
  assert.ok(MODELS["token-insert"].describe(out.layout).some((l) => /Lift cutouts/.test(l)));
});

test("lift cutouts: slide along the side, then go shallower, when a pocket is in the way", () => {
  // Set tray 100 × 60; a big round token hard against the front, in the middle.
  const tokens = [token(1, circlePts(20))];
  const base = { sizeMode: "set", width: 100, depth: 60, lift: true, liftSides: "long", notch: false };
  const A = analyse(tokens, [{ key: "1:0", tokenId: 1, x: 50, y: 24, angle: 0 }], base);
  const front = A.lifts.find((c) => c.side === "front");
  const back = A.lifts.find((c) => c.side === "back");
  assert.ok(Math.abs(back.x - 50) < 1e-6 && back.depth === 8, "back has room in the middle");
  assert.ok(Math.abs(front.x - 50) > 10 && front.depth === 8, `front slid to x=${front.x.toFixed(1)}`);
  assert.ok(liftWall(A) >= 1.85 - 0.01);
  // A long token across the whole front: only a shallow bite fits.
  const bar = [[-44, -6], [44, -6], [44, 6], [-44, 6]];
  const B = analyse([token(2, bar)], [{ key: "2:0", tokenId: 2, x: 50, y: 15, angle: 0 }], base);
  const f = B.lifts.find((c) => c.side === "front");
  assert.ok(f && f.depth < 8 && f.depth >= 4, `front bite ${f?.depth} mm`);
  assert.ok(liftWall(B) >= 1.85 - 0.01);
});

test("lift cutouts: no room → skipped in a set tray, tray grows in fit mode", () => {
  const bar = [[-44, -6], [44, -6], [44, 6], [-44, 6]];
  const tokens = [token(2, bar)];
  const item = [{ key: "2:0", tokenId: 2, x: 50, y: 9.5, angle: 0 }];
  const set = analyse(tokens, item, { sizeMode: "set", width: 100, depth: 60, lift: true, notch: false });
  assert.deepEqual(set.liftMissing.map((m) => m.side), ["front"]);
  assert.equal(set.lifts.length, 1);
  const fit = analyse(tokens, item, { lift: true, notch: false });
  assert.equal(fit.lifts.length, 2);
  assert.ok(fit.lifts.every((c) => c.depth === 8));
  assert.ok(fit.liftGrown > 5, `grew ${fit.liftGrown.toFixed(1)} mm`);
  assert.ok(liftWall(fit) >= 1.85 - 0.01);
  const out = MODELS["token-insert"].build({ tokens, items: item, settings: { lift: true, notch: false } });
  assert.ok(valid(out.parts[0].shape));
  // A side shorter than the cutout is reported, not cut.
  const tiny = analyse([token(3, circlePts(5))], [{ key: "3:0", tokenId: 3, x: 0, y: 0, angle: 0 }], { lift: true, liftSides: "all", notch: false });
  assert.ok(tiny.liftMissing.every((m) => m.reason === "side too short") && tiny.liftMissing.length === 4);
});
