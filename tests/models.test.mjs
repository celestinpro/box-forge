// Headless tests: build every generator across a range of sizes, including
// the narrow-card cases that broke the original site.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import opencascade from "replicad-opencascadejs";
import { setOC, getOC, measureVolume } from "replicad";
import { MODELS } from "../src/models/index.js";

// OpenCascade logs "failed to compute a normal" while filleting curved edges;
// it's harmless, so keep it out of the test output.
const consoleError = console.error;
console.error = (...a) => { if (!/compute a normal/.test(String(a[0]))) consoleError(...a); };

before(async () => {
  const wasm = fileURLToPath(new URL("../node_modules/replicad-opencascadejs/dist/replicad_single.wasm", import.meta.url));
  setOC(await opencascade({ locateFile: () => wasm }));
});

function check(model, params, expectParts) {
  const { parts, layout, warnings } = MODELS[model].build(params);
  assert.deepEqual(parts.map((p) => p.name), expectParts);
  for (const { name, shape } of parts) {
    const oc = getOC();
    const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
    assert.ok(analyzer.IsValid(), `${name} is a valid solid`);
    analyzer.delete();
    const v = measureVolume(shape);
    assert.ok(v > 100, `${name} has volume (${v})`);
    const bb = shape.boundingBox;
    assert.ok(bb.bounds[0][2] > -0.01 && bb.bounds[0][2] < 0.01, `${name} sits on the bed (zmin ${bb.bounds[0][2]})`);
  }
  return { parts, layout, warnings };
}

const qd = [
  ["single standard deck", { pockets: [{ cardHeight: 89, cardWidth: 64, deckHeight: 20 }] }],
  ["45 x 14 narrow pocket (broke the original)", { pockets: [{ cardHeight: 45, cardWidth: 14, deckHeight: 20 }] }],
  ["two different pockets", { pockets: [{ cardHeight: 45, cardWidth: 14, deckHeight: 20 }, { cardHeight: 50, cardWidth: 18, deckHeight: 15 }] }],
  ["three pockets, front aligned", { align: "front", pockets: [{ cardHeight: 89, cardWidth: 64, deckHeight: 30 }, { cardHeight: 68, cardWidth: 44, deckHeight: 15 }, { cardHeight: 63, cardWidth: 41, deckHeight: 10 }] }],
  ["tiny 6 mm cards", { pockets: [{ cardHeight: 30, cardWidth: 6, deckHeight: 8 }] }],
  ["thick walls big fillet", { wallThickness: 3, innerFillet: 10, pockets: [{ cardHeight: 120, cardWidth: 70, deckHeight: 40 }] }],
];
for (const [name, params] of qd) {
  test(`quick draw: ${name} (lid)`, () => check("quick-draw", { ...params, lidType: "lid" }, ["tray", "lid"]));
}
test("quick draw: cover type", () => check("quick-draw", { ...qd[2][1], lidType: "cover" }, ["tray", "cover"]));
test("quick draw: no lid", () => check("quick-draw", { ...qd[0][1], lidType: "none" }, ["tray"]));

test("quick draw: dimensions match the classic layout", () => {
  const { layout: L } = check("quick-draw", { pockets: [{ cardHeight: 45, cardWidth: 14, deckHeight: 20 }] }, ["tray", "lid"]);
  assert.equal(+L.totalX.toFixed(1), 19.6);
  assert.equal(+L.totalY.toFixed(1), 50.6);
  assert.equal(+L.totalZ.toFixed(1), 21.8);
  assert.equal(+L.lid.innerX.toFixed(1), 20.2);
  assert.ok(L.cells[0].slot <= 14 * 0.6 + 2, "finger slot shrank to fit");
});

test("quick draw: shallower pocket gets a raised floor", () => {
  const { layout: L } = check("quick-draw", qd[2][1], ["tray", "lid"]);
  assert.equal(+L.cells[0].floorZ.toFixed(1), 1.8);
  assert.equal(+L.cells[1].floorZ.toFixed(1), 6.8);
});

test("quick draw: rejects nonsense input", () => {
  assert.throws(() => MODELS["quick-draw"].build({ pockets: [{ cardHeight: -5, cardWidth: 10, deckHeight: 10 }] }), /card height/);
});

const tt = [
  ["default", {}],
  ["single compartment", { columns: 1, rows: 1 }],
  ["dense grid", { width: 120, depth: 80, columns: 6, rows: 4, scoop: 20 }],
  ["no lid flat scoop", { lid: false, scoop: 0, cornerRadius: 0 }],
];
for (const [name, params] of tt) {
  test(`token tray: ${name}`, () => check("token-tray", params, params.lid === false ? ["tray"] : ["tray", "lid"]));
}
test("token tray: too many compartments explains the problem", () => {
  assert.throws(() => MODELS["token-tray"].build({ width: 30, columns: 12 }), /Compartments would be only/);
});
