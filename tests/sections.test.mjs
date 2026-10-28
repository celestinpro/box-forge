// Token tray sections: splitting, removing, resizing, and building.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import opencascade from "replicad-opencascadejs";
import { setOC, getOC } from "replicad";
import { MODELS } from "../src/models/index.js";
import { gridTree, layoutSections, splitSection, removeSection, evenOut, moveWall, setSectionLength, countLeaves, normalise, MIN_SECTION } from "../src/models/sections.js";

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
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const rect = { x: 0, y: 0, w: 100, h: 60 };
const W = 1.6;

test("even grid: same compartments as the old grid maths", () => {
  const { cells, walls } = layoutSections(gridTree(3, 2), rect, W);
  assert.equal(cells.length, 6);
  assert.equal(walls.length, 2 + 3);
  for (const c of cells) {
    near(c.w, (100 - 2 * W) / 3);
    near(c.h, (60 - W) / 2);
  }
});

test("split, remove and even out", () => {
  let t = {};
  t = splitSection(t, [], "x"); // two side by side
  t = splitSection(t, [1], "x"); // joins the row: three side by side
  assert.equal(t.dir, "x");
  assert.equal(t.kids.length, 3);
  t = splitSection(t, [0], "y"); // first one split front to back
  assert.equal(countLeaves(t), 4);
  const cells = layoutSections(t, rect, W).cells;
  const total = cells.filter((c) => c.path[0] !== 0).reduce((a, c) => a + c.w, 0) + cells.find((c) => c.path[0] === 0).w + 2 * W;
  near(total, 100);
  t = removeSection(t, [0, 1]); // back to one compartment on the left
  assert.equal(countLeaves(t), 3);
  assert.deepEqual(t.kids[0], {});
  t = moveWall(t, [], 0, 10, 100 - 2 * W, W);
  t = evenOut(t, [2]);
  t.sizes.forEach((s) => near(s, 1 / 3));
  assert.deepEqual(removeSection({}, []), {}, "the last compartment stays");
});

test("moving a wall: exact mm, and stops at the minimum size", () => {
  const free = 100 - W;
  let t = splitSection({}, [], "x");
  t = moveWall(t, [], 0, 12.5, free, W);
  const [a, b] = layoutSections(t, rect, W).cells;
  near(a.w, free / 2 + 12.5);
  near(b.w, free / 2 - 12.5);
  // Way too far: the right compartment stops at the minimum.
  const far = layoutSections(moveWall(t, [], 0, 500, free, W), rect, W).cells;
  near(far[1].w, MIN_SECTION);
  // A side that's itself split that way keeps room for all its compartments.
  let u = splitSection(splitSection({}, [], "x"), [1], "y");
  u = splitSection(u, [1, 0], "x");
  const squeezed = layoutSections(moveWall(u, [], 0, 500, free, W), rect, W).cells;
  assert.ok(squeezed.every((c) => c.w >= MIN_SECTION - 1e-9 && c.h >= MIN_SECTION - 1e-9));
});

test("typing a compartment's size", () => {
  let t = gridTree(3, 1);
  t = setSectionLength(t, [1], "x", 40, rect, W);
  near(layoutSections(t, rect, W).cells[1].w, 40);
  t = setSectionLength(t, [2], "x", 20, rect, W); // last one: trades with the one before
  const c = layoutSections(t, rect, W).cells;
  near(c[2].w, 20);
  near(c[0].w + c[1].w + c[2].w + 2 * W, 100);
  assert.equal(setSectionLength(t, [1], "y", 10, rect, W), t, "no front-to-back split to change");
});

test("normalise cleans saved layouts", () => {
  assert.deepEqual(normalise(null), {});
  assert.deepEqual(normalise({ dir: "x", sizes: [1], kids: [{}] }), {});
  const n = normalise({ dir: "y", sizes: [2, 6], kids: [{}, {}] });
  assert.deepEqual(n.sizes, [0.25, 0.75]);
});

test("token tray builds from a custom layout, and resizing keeps proportions", () => {
  let layout = splitSection({}, [], "x");
  layout = splitSection(layout, [1], "y");
  layout = splitSection(layout, [1, 1], "x");
  layout = moveWall(layout, [], 0, -15, 120 - 2 * 1.6 - 1.6, 1.6);
  for (const lid of [{ lid: true, lidStyle: "cap" }, { lid: true, lidStyle: "sliding" }, { lid: false }]) {
    const out = MODELS["token-tray"].build({ width: 120, depth: 80, height: 20, layout, ...lid });
    assert.ok(out.parts.every((p) => valid(p.shape)), JSON.stringify(lid));
    assert.equal(out.layout.cells.length, 4);
  }
  const big = MODELS["token-tray"].build({ width: 240, depth: 80, height: 20, layout, lid: false });
  const small = MODELS["token-tray"].build({ width: 120, depth: 80, height: 20, layout, lid: false });
  near(big.layout.cells[0].w / small.layout.cells[0].w, (240 - 4.8) / (120 - 4.8), 1e-9);
  assert.ok(MODELS["token-tray"].describe(small.layout).some((l) => /4 compartments in 3 sizes/.test(l)));
  // Shrinking the tray until a compartment is too small is explained.
  assert.throws(() => MODELS["token-tray"].build({ width: 20, depth: 80, layout, lid: false }), /Compartments would be only .* fewer sections/);
});
