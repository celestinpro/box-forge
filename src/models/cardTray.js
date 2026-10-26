// Card tray: an open tray where the cards lean back at an angle, so a low
// tray can hold tall cards. Made for board game inserts, where the height of
// the box decides the angle.
//
// Original implementation for Box Forge. The design idea (leaning cards,
// finger groove along the top, slot in the floor, divider slots) follows the
// card trays by js500 and floookay on Printables.
//
// Axes: X runs front to back (the direction the stack grows), Y across the
// card's long side, Z up. The cards' bottom edges rest on the floor and their
// tops lean towards +X.

import { draw, drawRoundedRectangle } from "replicad";
import { clamp, safeFillet, num, requireRange, atZ } from "./util.js";
import { CARD_TRAY_DEFAULTS } from "./config.js";

export { CARD_TRAY_DEFAULTS } from "./config.js";

const DEG = Math.PI / 180;

/** Move a shape so its bounding box starts at the given minimum corner. */
function placeAt(shape, [x, y, z]) {
  const [[x0, y0, z0]] = shape.boundingBox.bounds;
  return shape.translate([x - x0, y - y0, z - z0]);
}

/**
 * A slab leaning at the card angle: horizontal thickness `width`, starting at
 * x0 on the plane z = z0 and rising to z1, spanning Y from y0 for `depth`.
 */
function leaningSlab({ x0, z0, z1, width, angle, y0, depth }) {
  const H = z1 - z0;
  const dx = angle >= 89.99 ? 0 : H / Math.tan(angle * DEG);
  const profile = draw([0, 0]).lineTo([width, 0]).lineTo([width + dx, H]).lineTo([dx, H]).close();
  return placeAt(profile.sketchOnPlane("XZ").extrude(depth), [x0, y0, z0]);
}

/** Parse "20, 15 30" into [20, 15, 30]. */
export function parseStacks(v) {
  if (Array.isArray(v)) return v.map(Number).filter((n) => n > 0);
  return String(v ?? "")
    .split(/[\s,;]+/)
    .map(parseFloat)
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function cardTrayLayout(input) {
  const p = { ...CARD_TRAY_DEFAULTS, ...input };
  const cardHeight = num(p.cardHeight, 88);
  const cardWidth = num(p.cardWidth, 63);
  const clearance = num(p.cardTolerance, 2);
  const floor = num(p.floorThickness, 1.2);
  const endWall = num(p.endWall, 5);
  const sideWall = num(p.sideWall, 1.6);
  const corner = num(p.cornerRadius, 3);
  requireRange("Card height", cardHeight, 10, 400);
  requireRange("Card width", cardWidth, 10, 400);
  requireRange("Card clearance", clearance, 0, 10);
  requireRange("Floor thickness", floor, 0.6, 10);
  requireRange("Front and back wall", endWall, 1, 40);
  requireRange("Side wall", sideWall, 0.8, 20);

  // Which card edge rests on the floor decides what spans the tray and what leans.
  const long = Math.max(cardHeight, cardWidth);
  const short = Math.min(cardHeight, cardWidth);
  const standOnLong = p.standOn !== "short";
  const across = (standOnLong ? long : short) + clearance; // Y, card edge on the floor
  const lean = (standOnLong ? short : long) + clearance; // card dimension that leans

  // Angle and height: set one, the other follows.
  let angle, height;
  const warnings = [];
  if (p.heightMode === "angle") {
    angle = num(p.angle, 60);
    requireRange("Lean angle", angle, 15, 90);
    height = floor + Math.sin(angle * DEG) * lean;
  } else {
    height = num(p.height, 57);
    requireRange("Height", height, floor + 8, 400);
    const ratio = (height - floor) / lean;
    if (ratio >= 1) {
      angle = 90;
      warnings.push(`The tray is taller than the cards (${lean.toFixed(1)} mm with clearance), so they stand upright.`);
    } else {
      angle = Math.asin(ratio) / DEG;
      if (angle < 15) {
        throw new Error(`At ${height} mm tall the cards would lean at ${angle.toFixed(0)}°. Use at least ${(floor + Math.sin(15 * DEG) * lean).toFixed(0)} mm, or set a lean angle instead.`);
      }
    }
  }
  const sinA = Math.sin(angle * DEG);
  const run = angle >= 89.99 ? 0 : Math.cos(angle * DEG) * lean; // how far a card's top leans back

  // Dividers
  const dividerMode = ["none", "removable", "fixed"].includes(p.dividers) ? p.dividers : "none";
  const dividerThickness = num(p.dividerThickness, 1.6);
  requireRange("Divider thickness", dividerThickness, 0.8, 6);
  const dividerRun = dividerThickness / sinA; // horizontal footprint of a leaning divider
  const stacks = parseStacks(p.stacks);

  // Length: from the available space, from the stack, or from the stacks between fixed dividers.
  let cardSpace;
  if (dividerMode === "fixed") {
    if (stacks.length < 2) throw new Error("Fixed dividers need at least two stack thicknesses, e.g. 20, 15.");
    if (stacks.length > 20) throw new Error("Up to 20 stacks.");
    cardSpace = stacks.reduce((s, t) => s + t / sinA, 0) + (stacks.length - 1) * dividerRun;
  } else if (p.lengthMode === "cards") {
    const stack = num(p.stackThickness, 40);
    requireRange("Stack thickness", stack, 1, 600);
    cardSpace = stack / sinA;
  } else {
    const total = num(p.length, 150);
    requireRange("Length", total, 10, 600);
    cardSpace = total - 2 * endWall - run;
    if (cardSpace < 3) {
      throw new Error(`${total} mm is too short for these cards at ${angle.toFixed(0)}°. It needs at least ${Math.ceil(2 * endWall + run + 3)} mm.`);
    }
  }
  const length = 2 * endWall + cardSpace + run;

  // Width: card + side walls, or a fixed outside width with thicker walls.
  const fitWidth = num(p.width, 0);
  let wall = sideWall;
  if (fitWidth > 0) {
    if (fitWidth < across + 1.6) throw new Error(`A ${fitWidth} mm width can't fit ${across.toFixed(1)} mm cards plus walls.`);
    wall = (fitWidth - across) / 2;
  }
  const width = across + 2 * wall;

  // Finger groove along the top, and slot in the floor.
  const grooveOn = p.groove !== false;
  const grooveWidth = clamp(num(p.grooveWidth, 0) || Math.min(across * 0.5, 45), 6, across - 4);
  const grooveDepth = clamp(num(p.grooveDepth, 0) || (height - floor) * 0.55, 3, height - floor - 1);
  const cutoutOn = p.floorCutout !== false && cardSpace > 8;
  const removable = [];
  if (dividerMode === "removable") {
    const spacing = num(p.dividerSpacing, 15);
    requireRange("Divider spacing", spacing, 4, 300);
    // Slot positions measured at the top of the tray, from the back.
    const count = Math.floor((cardSpace - 1) / spacing);
    const backAtTop = endWall + run + cardSpace;
    for (let i = 1; i <= count; i++) removable.push(backAtTop - i * spacing);
  }

  return {
    params: { ...p, dividers: dividerMode },
    cardHeight, cardWidth, across, lean, angle, sinA, run, height, length, width, wall,
    floor, endWall, corner: clamp(corner, 0, Math.min(width, length) / 2 - 0.5),
    cardSpace, stackCapacity: cardSpace * sinA,
    dividerMode, dividerThickness, dividerRun, stacks, removable,
    slotDepth: clamp(num(p.slotDepth, 20), 4, lean * 0.8),
    grooveOn, grooveWidth, grooveDepth, cutoutOn,
    warnings,
  };
}

function buildTray(L, warnings) {
  const { length, width, height, corner, floor, endWall, across, wall, angle, cardSpace, sinA } = L;
  const top = height + 2;

  let tray = (corner > 0.05 ? drawRoundedRectangle(length, width, corner) : drawRoundedRectangle(length, width))
    .sketchOnPlane()
    .extrude(height)
    .translate([length / 2, width / 2, 0]);

  // Card space: a slab that leans with the cards, cut from the floor up past the top.
  tray = tray.cut(leaningSlab({ x0: endWall, z0: floor, z1: top, width: cardSpace, angle, y0: wall, depth: across }));

  // Fixed dividers: leaning walls between stacks, joined to the floor.
  if (L.dividerMode === "fixed") {
    let x = endWall;
    L.stacks.slice(0, -1).forEach((t) => {
      x += t / sinA;
      tray = tray.fuse(leaningSlab({ x0: x, z0: floor, z1: height, width: L.dividerRun, angle, y0: wall - 0.01, depth: across + 0.02 }));
      x += L.dividerRun;
    });
  }

  // Finger groove: a round-bottomed channel along the full length.
  if (L.grooveOn) {
    const r = Math.min(L.grooveWidth / 2, L.grooveDepth) - 0.01;
    const groove = drawRoundedRectangle(L.grooveWidth, 2 * L.grooveDepth, r).sketchOnPlane("YZ").extrude(length + 2);
    tray = tray.cut(placeAt(groove, [-1, width / 2 - L.grooveWidth / 2, height - L.grooveDepth]));
  }

  // Slot in the floor so cards can be pushed up from below.
  if (L.cutoutOn) {
    const w = Math.min(L.grooveWidth, across - 6);
    // One slot per section, so fixed dividers keep their footing on the floor.
    const sections = [];
    if (L.dividerMode === "fixed") {
      let x = endWall;
      for (const t of L.stacks) {
        sections.push([x, t / sinA]);
        x += t / sinA + L.dividerRun;
      }
    } else {
      sections.push([endWall, cardSpace]);
    }
    for (const [x0, span] of sections) {
      const len = span - 3;
      if (len < 4) continue;
      const slot = drawRoundedRectangle(len, w, Math.min(5, w / 2 - 0.01, len / 2 - 0.01)).sketchOnPlane().extrude(floor + 2);
      tray = tray.cut(placeAt(slot, [x0 + 1.5, width / 2 - w / 2, -1]));
    }
  }

  // Soften the top edges before cutting divider slots, which would crowd them.
  tray = safeFillet(tray, 0.6, atZ(height), warnings, "Top edges");

  // Removable dividers: leaning slots in both side walls, open at the top.
  if (L.dividerMode === "removable") {
    const slotRun = (L.dividerThickness + 0.5) / sinA;
    const z0 = height - L.slotDepth * sinA;
    const dz = angle >= 89.99 ? 0 : (height - z0) / Math.tan(angle * DEG);
    for (const xTop of L.removable) {
      tray = tray.cut(leaningSlab({ x0: xTop - dz - slotRun / 2, z0, z1: top, width: slotRun, angle, y0: -1, depth: width + 2 }));
    }
  }

  return tray;
}

/** One removable divider, printed flat. */
function buildDivider(L) {
  const { width, across, lean, dividerThickness: t, slotDepth } = L;
  const fit = 0.6; // play around the divider
  const tab = slotDepth - 0.5;
  const body = lean - fit;
  // Lies in XY: X = along the lean (0 = bottom edge), Y = across the tray.
  let plate = drawRoundedRectangle(body, across - fit, 1.5).sketchOnPlane().extrude(t).translate([body / 2, 0, 0]);
  // The tab reaches into the slots in both side walls.
  const tabShape = drawRoundedRectangle(tab, width - 1 - fit, 1).sketchOnPlane().extrude(t);
  plate = plate.fuse(tabShape.translate([body - tab / 2, 0, 0]));
  if (L.grooveOn) {
    const depth = L.grooveDepth / L.sinA + 1;
    const r = Math.min(L.grooveWidth / 2, depth) - 0.01;
    const notch = drawRoundedRectangle(2 * depth, L.grooveWidth, r).sketchOnPlane().extrude(t + 2);
    plate = plate.cut(notch.translate([body, 0, -1]));
  }
  return plate;
}

export function buildCardTray(params) {
  const L = cardTrayLayout(params);
  const warnings = [...L.warnings];
  const parts = [{ name: "tray", shape: buildTray(L, warnings) }];
  if (L.dividerMode === "removable" && L.removable.length) parts.push({ name: "divider", shape: buildDivider(L) });
  return { parts, layout: L, warnings };
}

export function describeCardTray(L) {
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const lines = [
    `Tray ${f(L.length)} × ${f(L.width)} × ${f(L.height)} mm`,
    `Cards lean at ${f(L.angle)}°${L.angle >= 89.99 ? " (upright)" : ""}`,
  ];
  if (L.dividerMode === "fixed") {
    lines.push(`${L.stacks.length} sections for stacks of ${L.stacks.map(f).join(", ")} mm`);
  } else {
    lines.push(`Holds a stack about ${f(L.stackCapacity)} mm thick (measured lying flat)`);
  }
  if (L.dividerMode === "removable") {
    lines.push(L.removable.length ? `${L.removable.length} divider slots; print up to ${L.removable.length} dividers` : "Too short for divider slots at this spacing");
  }
  return lines;
}
