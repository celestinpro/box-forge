// Quick Draw deck box: a tray with one or more card pockets side by side,
// each pocket with its own card size and deck thickness, plus a lid.
//
// Conventions (matching the familiar Quick Draw layout):
//   pocket size  = card size + card tolerance, in both directions
//   walls        = wall thickness, also used for the dividers between pockets
//   tray height  = deepest deck + floor (one wall thickness)
//   shallower decks get a raised floor so every deck sits level with the rim
//
// X runs across the pockets (card widths), Y along the card length, Z up.

import { drawRoundedRectangle, makeBaseBox, makeCylinder } from "replicad";
import { clamp, safeFillet, num, requireRange, atZ } from "./util.js";
import { slipLidSize, buildSlipLid } from "./parts.js";
import { QUICK_DRAW_DEFAULTS } from "./config.js";

export { CARD_PRESETS, QUICK_DRAW_DEFAULTS } from "./config.js";



/** Normalise user params and compute every derived dimension in one place. */
export function quickDrawLayout(input) {
  const p = { ...QUICK_DRAW_DEFAULTS, ...input };
  const wall = num(p.wallThickness, 1.8);
  const cardTol = num(p.cardTolerance, 2);
  const lidTol = num(p.lidTolerance, 0.6);
  requireRange("Wall thickness", wall, 0.8, 6);
  requireRange("Card tolerance", cardTol, 0, 10);
  requireRange("Lid tolerance", lidTol, 0, 3);

  const pockets = (p.pockets?.length ? p.pockets : QUICK_DRAW_DEFAULTS.pockets).map((pk, i) => {
    const cardHeight = num(pk.cardHeight, 89);
    const cardWidth = num(pk.cardWidth, 64);
    const deckHeight = num(pk.deckHeight, 20);
    requireRange(`Pocket ${i + 1} card height`, cardHeight, 5, 400);
    requireRange(`Pocket ${i + 1} card width`, cardWidth, 3, 400);
    requireRange(`Pocket ${i + 1} deck height`, deckHeight, 2, 300);
    return { cardHeight, cardWidth, deckHeight };
  });
  if (pockets.length > 8) throw new Error("Up to 8 pockets per box.");

  const cells = pockets.map((pk) => ({ ...pk, x: pk.cardWidth + cardTol, y: pk.cardHeight + cardTol }));
  const totalX = cells.reduce((s, c) => s + c.x, 0) + (cells.length + 1) * wall;
  const totalY = Math.max(...cells.map((c) => c.y)) + 2 * wall;
  const totalZ = Math.max(...cells.map((c) => c.deckHeight)) + wall;

  // Corner radius has to fit inside the narrowest pocket; the finger slot has
  // to leave some wall on both sides of the card. Both shrink automatically.
  const requestedFillet = num(p.innerFillet, 3);
  const requestedSlot = num(p.fingerSlot, 15);
  let x = -totalX / 2 + wall;
  for (const c of cells) {
    c.cx = x + c.x / 2;
    c.cy = p.align === "front" ? -totalY / 2 + wall + c.y / 2 : 0;
    c.floorZ = totalZ - c.deckHeight;
    c.fillet = clamp(requestedFillet, 0, Math.min(c.x, c.y) / 2 - 0.3);
    c.slot = requestedSlot <= 0 ? 0 : clamp(requestedSlot, 4, Math.min(c.x * 0.6, c.x - 2 * c.fillet - 1));
    x += c.x + wall;
  }

  const outerFillet = Math.min(...cells.map((c) => c.fillet)) + wall;
  const lid = slipLidSize({ x: totalX, y: totalY, z: totalZ, fillet: outerFillet, wall, tolerance: lidTol });

  return {
    params: { ...p, wallThickness: wall, cardTolerance: cardTol, lidTolerance: lidTol },
    wall,
    cells,
    totalX,
    totalY,
    totalZ,
    outerFillet,
    lid,
  };
}

function buildTray(L, warnings) {
  const { wall, cells, totalX, totalY, totalZ, outerFillet } = L;
  let tray = drawRoundedRectangle(totalX, totalY, outerFillet).sketchOnPlane().extrude(totalZ);

  cells.forEach((c, i) => {
    let pocket = (c.fillet > 0.05 ? drawRoundedRectangle(c.x, c.y, c.fillet) : drawRoundedRectangle(c.x, c.y))
      .sketchOnPlane("XY", c.floorZ)
      .extrude(c.deckHeight + 1);
    // Round the inside bottom edge so cards slide out easily.
    pocket = safeFillet(pocket, Math.min(wall / 2, c.deckHeight / 3), atZ(c.floorZ), warnings, `Pocket ${i + 1} floor edge`);
    tray = tray.cut(pocket.translate([c.cx, c.cy, 0]));

    // Finger slot through both short end walls: a U-shape, rectangle + half cylinder.
    if (c.slot > 0) {
      const r = c.slot / 2;
      const bottom = c.floorZ + Math.min(2, c.deckHeight / 4);
      const len = totalY + 4;
      const rect = makeBaseBox(c.slot, len, totalZ + 1 - (bottom + r)).translate([c.cx, 0, bottom + r]);
      const round = makeCylinder(r, len, [c.cx, -len / 2, bottom + r], [0, 1, 0]);
      tray = tray.cut(rect.fuse(round));
    }
  });

  // Soften the rim.
  tray = safeFillet(tray, Math.min(0.4, wall / 4), atZ(totalZ), warnings, "Top rim");
  return tray;
}

function buildLid(L, warnings) {
  // Thumb notches go on the end walls; for a single pocket they're on the
  // long sides, where the finger slots aren't.
  return buildSlipLid(L.lid, L.wall, warnings, L.cells.length === 1 ? "x" : "y");
}

function buildCover(L, warnings) {
  // Flat cover with a plug that drops into each pocket.
  const { wall, cells, totalX, totalY, outerFillet, params } = L;
  const tol = params.lidTolerance;
  let cover = drawRoundedRectangle(totalX, totalY, outerFillet).sketchOnPlane().extrude(wall);
  cells.forEach((c, i) => {
    const w = c.x - tol;
    const h = c.y - tol;
    const r = Math.max(c.fillet - tol / 2, 0);
    const ringH = 2 * wall;
    const outer = (r > 0.05 ? drawRoundedRectangle(w, h, r) : drawRoundedRectangle(w, h)).sketchOnPlane("XY", wall).extrude(ringH);
    let ring = outer;
    if (w > 3 * wall && h > 3 * wall) {
      const ir = Math.max(r - wall, 0);
      const inner = (ir > 0.05 ? drawRoundedRectangle(w - 2 * wall, h - 2 * wall, ir) : drawRoundedRectangle(w - 2 * wall, h - 2 * wall))
        .sketchOnPlane("XY", wall)
        .extrude(ringH);
      ring = outer.cut(inner);
    }
    cover = cover.fuse(ring.translate([c.cx, c.cy, 0]));
  });
  cover = safeFillet(cover, wall / 2, atZ(0), warnings, "Cover edge");
  return cover;
}

/**
 * Build the Quick Draw parts.
 * @returns {{parts: {name: string, shape: any}[], layout: object, warnings: string[]}}
 */
export function buildQuickDraw(params) {
  const L = quickDrawLayout(params);
  const warnings = [];
  const parts = [{ name: "tray", shape: buildTray(L, warnings) }];
  if (L.params.lidType === "lid") parts.push({ name: "lid", shape: buildLid(L, warnings) });
  if (L.params.lidType === "cover") parts.push({ name: "cover", shape: buildCover(L, warnings) });
  return { parts, layout: L, warnings };
}

/** Human-readable summary of the derived dimensions. */
export function describeQuickDraw(L) {
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const lines = [`Tray ${f(L.totalX)} × ${f(L.totalY)} × ${f(L.totalZ)} mm`];
  if (L.params.lidType === "lid") lines.push(`Lid ${f(L.lid.outerX)} × ${f(L.lid.outerY)} × ${f(L.lid.outerZ)} mm`);
  L.cells.forEach((c, i) =>
    lines.push(`Pocket ${i + 1}: ${f(c.y)} × ${f(c.x)} × ${f(c.deckHeight)} mm, finger slot ${c.slot ? f(c.slot) + " mm" : "none"}`)
  );
  return lines;
}
