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

  // Finger notch in both end walls: a round-bottomed scoop with rounded
  // shoulders where it meets the top, wide enough to pinch the stack.
  const grooveOn = p.groove !== false;
  const grooveDepth = clamp(num(p.grooveDepth, 0) || (height - floor) * 0.5, 4, height - floor - 1);
  // Width of the notch where it meets the top (before the shoulder rounding).
  const grooveWidth = clamp(num(p.grooveWidth, 0) || 2 * Math.min(grooveDepth, across * 0.34), 8, across - 4);
  const grooveRadius = grooveWidth / 2;
  const grooveShoulder = clamp(num(p.grooveShoulder, 5), 0, Math.min(20, (across - grooveWidth) / 2 - 1, height - floor - 2));
  const cutoutOn = p.floorCutout === true && cardSpace > 8;
  const removable = [];
  if (dividerMode === "removable") {
    const spacing = num(p.dividerSpacing, 15);
    requireRange("Divider spacing", spacing, 4, 300);
    // Slot positions at the top of the tray, spread evenly and centred.
    const span = cardSpace;
    const margin = Math.max(6, spacing * 0.6);
    const count = span - 2 * margin >= 0 ? Math.floor((span - 2 * margin) / spacing) + 1 : 0;
    const frontAtTop = endWall + run;
    const first = frontAtTop + (span - (count - 1) * spacing) / 2;
    for (let i = 0; i < count; i++) removable.push(first + i * spacing);
  }

  return {
    params: { ...p, dividers: dividerMode },
    cardHeight, cardWidth, across, lean, angle, sinA, run, height, length, width, wall,
    floor, endWall, corner: clamp(corner, 0, Math.min(width, length) / 2 - 0.5),
    cardSpace, stackCapacity: cardSpace * sinA,
    dividerMode, dividerThickness, dividerRun, stacks, removable,
    slotDepth: clamp(num(p.slotDepth, 17), 4, lean * 0.8),
    grooveOn, grooveWidth, grooveDepth, grooveShoulder, grooveRadius, cutoutOn,
    warnings,
  };
}

/**
 * 2D outline of the finger notch, centred on u = 0 with the top surface at
 * v = top: a half-round bottom, straight sides, and rounded shoulders.
 */
function notchDrawing({ radius: R, shoulder: s, depth: D, top }) {
  // Drawn as one outline (right half, mirrored): round bottom, then a
  // shoulder arc that blends into the top surface. Built from tangent arcs
  // rather than 2D booleans, which are unreliable for tangent circles.
  const vc = top - D + R; // centre of the round bottom
  const above = top + 10;
  const arcPoint = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const pen = draw([0, vc - R]);
  const bottomAngle = -Math.PI / 2;

  if (s <= 0.05) {
    // No shoulder: follow the circle up to the top surface (or to its widest point).
    const endA = vc >= top ? Math.asin((top - vc) / R) : 0;
    const end = arcPoint(0, vc, R, endA);
    pen.threePointsArcTo(end, arcPoint(0, vc, R, (bottomAngle + endA) / 2));
    if (vc < top) pen.lineTo([R, top]);
    return pen.lineTo([end[0], above]).lineTo([0, above]).closeWithMirror();
  }

  const zf = top - s; // shoulder circle centre height
  if (vc <= zf) {
    // Straight sides between the round bottom and the shoulders.
    pen.threePointsArcTo([R, vc], arcPoint(0, vc, R, -Math.PI / 4));
    if (zf - vc > 0.01) pen.lineTo([R, zf]);
    pen.threePointsArcTo([R + s, top], arcPoint(R + s, zf, s, (3 * Math.PI) / 4));
    return pen.lineTo([R + s, above]).lineTo([0, above]).closeWithMirror();
  }

  // Round bottom runs straight into the shoulder: the shoulder circle touches
  // the bottom circle (centres R + s apart) and the top surface.
  const xf = Math.sqrt((R + s) ** 2 - (vc - zf) ** 2);
  const tA = Math.atan2(zf - vc, xf); // direction from bottom centre to shoulder centre
  const T = arcPoint(0, vc, R, tA);
  pen.threePointsArcTo(T, arcPoint(0, vc, R, (bottomAngle + tA) / 2));
  const fromA = tA + Math.PI; // T as seen from the shoulder centre
  pen.threePointsArcTo([xf, top], arcPoint(xf, zf, s, (fromA + Math.PI / 2 + 2 * Math.PI) / 2 - Math.PI));
  return pen.lineTo([xf, above]).lineTo([0, above]).closeWithMirror();
}

function buildTray(L, warnings) {
  const { length, width, height, corner, floor, endWall, across, wall, angle, cardSpace, sinA } = L;
  const top = height + 2;

  let tray = (corner > 0.05 ? drawRoundedRectangle(length, width, corner) : drawRoundedRectangle(length, width))
    .sketchOnPlane()
    .extrude(height)
    .translate([length / 2, width / 2, 0]);

  // Card space: a slab that leans with the cards, cut from the floor up past the top.
  const space = leaningSlab({ x0: endWall, z0: floor, z1: top, width: cardSpace, angle, y0: wall, depth: across });
  tray = tray.cut(space);

  // Fixed dividers: leaning walls between stacks, joined to the floor.
  if (L.dividerMode === "fixed") {
    let x = endWall;
    L.stacks.slice(0, -1).forEach((t) => {
      x += t / sinA;
      tray = tray.fuse(leaningSlab({ x0: x, z0: floor, z1: height, width: L.dividerRun, angle, y0: wall - 0.01, depth: across + 0.02 }));
      x += L.dividerRun;
    });
  }

  // Finger notch through both end walls (the inside is open anyway).
  if (L.grooveOn) {
    const notch = notchDrawing({ radius: L.grooveRadius, shoulder: L.grooveShoulder, depth: L.grooveDepth, top: height });
    tray = tray.cut(notch.sketchOnPlane("YZ").extrude(length + 2).translate([-1, width / 2, 0]));
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
  const rounded = safeFillet(tray, 1.2, atZ(height));
  tray = rounded !== tray ? rounded : safeFillet(tray, 0.5, atZ(height), warnings, "Top edges");

  // Removable dividers: slots in both side walls that lean with the cards,
  // with rounded ends.
  if (L.dividerMode === "removable") {
    const w = L.dividerThickness + 0.8; // slot width, square to the lean
    const dx = Math.cos(angle * DEG);
    const dz = Math.sin(angle * DEG);
    const below = L.slotDepth;
    const over = 6;
    const len = below + over;
    for (const xTop of L.removable) {
      const cx = xTop + (dx * (over - below)) / 2;
      const cz = height + (dz * (over - below)) / 2;
      const slot = drawRoundedRectangle(len, w, w / 2 - 0.01).rotate(angle, [0, 0]).translate(cx, cz);
      tray = tray.cut(slot.sketchOnPlane("XZ").extrude(width + 2).translate([0, width + 1, 0]));
    }
  }

  return tray;
}

/** One removable divider, printed flat. */
function buildDivider(L) {
  const { width, across, lean, dividerThickness: t, slotDepth, sinA } = L;
  const fit = 0.6; // play around the divider
  const tab = slotDepth - 0.5;
  const body = lean - fit;
  // Lies in XY: X = along the lean (0 = bottom edge), Y = across the tray.
  let plate = drawRoundedRectangle(body, across - fit, 1.5).sketchOnPlane().extrude(t).translate([body / 2, 0, 0]);
  // The tab reaches into the slots in both side walls.
  const tabShape = drawRoundedRectangle(tab, width - 1 - fit, 1).sketchOnPlane().extrude(t);
  plate = plate.fuse(tabShape.translate([body - tab / 2, 0, 0]));
  if (L.grooveOn) {
    // Same notch as the end walls, stretched along the lean so they line up.
    const depth = Math.min(L.grooveDepth / sinA, body - 4);
    const radius = Math.min(L.grooveRadius, depth - L.grooveShoulder);
    if (radius > 1) {
      const notch = notchDrawing({ radius, shoulder: L.grooveShoulder, depth, top: body }).rotate(-90, [0, 0]);
      plate = plate.cut(notch.sketchOnPlane().extrude(t + 2).translate([0, 0, -1]));
    }
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
