// Reusable parts shared by several models.
import { draw, drawRoundedRectangle, makeBaseBox, makeCylinder } from "replicad";
import { safeFillet, atZ, clamp } from "./util.js";

/** Dimensions of a slip-over lid for a box of the given outer size. */
export function slipLidSize({ x, y, z, fillet, wall, tolerance }) {
  const add = tolerance / 2;
  const lid = { innerX: x + 2 * add, innerY: y + 2 * add, innerZ: z + add, innerFillet: fillet + add };
  lid.outerX = lid.innerX + 2 * wall;
  lid.outerY = lid.innerY + 2 * wall;
  lid.outerZ = lid.innerZ + wall;
  lid.outerFillet = lid.innerFillet + wall;
  return lid;
}

/**
 * A lid that slides over the whole box, with a thumb notch on two opposite
 * walls. Returned top-down (flat face on the build plate) ready to print.
 * @param notchAxis "y" puts notches on the walls facing ±Y, "x" on ±X.
 */
export function buildSlipLid(lid, wall, warnings, notchAxis = "y") {
  let shell = drawRoundedRectangle(lid.outerX, lid.outerY, lid.outerFillet).sketchOnPlane().extrude(lid.outerZ);
  shell = safeFillet(shell, wall / 2, atZ(lid.outerZ), warnings, "Lid top edge");
  const cavity = drawRoundedRectangle(lid.innerX, lid.innerY, lid.innerFillet).sketchOnPlane().extrude(lid.innerZ);
  shell = shell.cut(cavity);

  const r = Math.min(6, lid.innerZ / 2);
  if (notchAxis === "y") {
    const len = lid.outerY + 4;
    shell = shell.cut(makeCylinder(r, len, [0, -len / 2, 0], [0, 1, 0]));
  } else {
    const len = lid.outerX + 4;
    shell = shell.cut(makeCylinder(r, len, [-len / 2, 0, 0], [1, 0, 0]));
  }
  return shell.mirror("XY").translate([0, 0, lid.outerZ]);
}

// ---------------------------------------------------------------------------
// Sliding lid
//
// A flat lid with angled (dovetail) sides slides in from the front along
// grooves cut into the tops of the side walls, sits flush with the top, and
// stops against the back wall. The front wall's top is cut away so the lid's
// front end completes it. Near the back, slots make the lid's sides into
// springy fingers that click over a small bump in each groove. A sunken
// arrow on top gives a thumb grip.
//
// Coordinates: box centred on X and Y, sitting on z = 0. The lid slides in
// from -Y towards +Y.

const SLIDE_SLOPE = Math.tan((30 * Math.PI) / 180); // sides lean 60° from horizontal

/** Every dimension of a sliding lid for a box X × Y × H with the given walls. */
export function slidingLidSize({ x, y, z, wall, thickness = 3, clearance = 0.12, ledge = 0 }) {
  const t = clamp(thickness, 2, 6);
  const groove = clamp(Math.min(1, wall - 0.8), 0.4, 1); // how far the groove cuts into the side walls
  const run = SLIDE_SLOPE * t; // how far the lid's sides lean in over its thickness
  const zb = z - t; // underside of the lid
  const grooveHalf = x / 2 - wall + groove; // half-width of the groove at its bottom
  const lidHalf = grooveHalf - clearance; // half-width of the lid at its bottom
  const lidTopHalf = lidHalf - run;
  const stopY = y / 2 - wall + groove; // the groove runs into the back wall too
  const front = -y / 2 + 0.15;
  const back = stopY - 0.1;
  const length = back - front;
  if (lidTopHalf < 5) {
    throw new Error(`The box is too narrow for a sliding lid (it needs at least ${Math.ceil(2 * (wall - groove + clearance + run + 5))} mm across).`);
  }
  if (length < 15) throw new Error("The box is too short for a sliding lid.");
  const slotLength = Math.min(12, length * 0.35);
  return {
    x, y, z, wall, t, clearance, groove, run, zb, grooveHalf, lidHalf, lidTopHalf, front, back, length,
    stopY,
    ledge: clamp(ledge, 0, 2),
    slotLength,
    slotWidth: 0.8,
    fingerTop: 0.9, // finger width at the top of the lid
    detentY: back - Math.min(5.5, slotLength * 0.45),
    bumpDepth: groove - 0.08, // at the groove floor, as in the reference (0.92 of a 1 mm groove)
    bumpFlat: 1.16,
  };
}

/** Trapezoid profile of the lid (or groove) in XZ, extruded along Y. */
function dovetail(half, zBottom, height, slope, y0, y1) {
  const top = half - slope * height;
  const profile = draw([-half, 0]).lineTo([half, 0]).lineTo([top, height]).lineTo([-top, height]).close();
  // XZ sketches extrude towards -Y from y = 0.
  return profile.sketchOnPlane("XZ").extrude(y1 - y0).translate([0, y1, zBottom]);
}

/**
 * Click bump (box) or matching notch (lid), as in the reference box: a block
 * with vertical faces at the bottom of each groove, filling the groove's
 * undercut almost back to the wall's inner face. Seen from above it is a
 * trapezoid: a short flat top with 45° ramps at each end, so the lid's
 * fingers ride up and over it. `shift` moves the shape towards the middle of
 * the box; the lid's notch is the bump shifted 0.3 mm, as in the reference.
 */
function detentBlocks(S, shift = 0) {
  const inner = S.grooveHalf - S.bumpDepth - shift; // |x| of the flat top
  const outer = S.grooveHalf + 1 - shift; // reaches into the wall so it fuses
  const flat = S.bumpFlat / 2;
  const ramp = outer - inner; // 45°: as long as it is deep
  const z0 = S.zb - 0.01;
  const shapes = [];
  for (const side of [1, -1]) {
    const footprint = draw([side * outer, S.detentY - flat - ramp])
      .lineTo([side * inner, S.detentY - flat])
      .lineTo([side * inner, S.detentY + flat])
      .lineTo([side * outer, S.detentY + flat + ramp])
      .close();
    // Up to the top of the box only; the groove's slanted face hides the rest.
    shapes.push(footprint.sketchOnPlane("XY", z0).extrude(S.z - z0));
  }
  return shapes;
}

/**
 * Cut the lid's groove into a box body and add the click bumps. `body` is the
 * finished box; everything above the lid's underside, between the grooves,
 * is removed through the front wall.
 */
export function cutSlidingLidWell(body, S) {
  const above = S.z + 2;
  const well = dovetail(S.grooveHalf, S.zb, above - S.zb, SLIDE_SLOPE, -S.y / 2 - 2, S.stopY);
  let box = body.cut(well);
  // Optional ledge under each side groove (45° underside, so it prints without support).
  if (S.ledge > 0) {
    const face = S.x / 2 - S.wall;
    const L = S.ledge;
    for (const side of [1, -1]) {
      const profile = draw([side * (face + 0.5), S.zb - 2 * L - 0.5])
        .lineTo([side * face, S.zb - 2 * L - 0.5])
        .lineTo([side * (face - L), S.zb - L - 0.5])
        .lineTo([side * (face - L), S.zb])
        .lineTo([side * (face + 0.5), S.zb])
        .close();
      const len = S.y - 2 * S.wall;
      box = box.fuse(profile.sketchOnPlane("XZ").extrude(len).translate([0, len / 2, 0]));
    }
  }
  // The click bumps only exist inside the groove: trim each one to the space
  // the groove cut away, so nothing shows outside the walls or above the rim.
  for (const b of detentBlocks(S)) box = box.fuse(b.intersect(well.clone()));
  return box;
}

/** The sliding lid, flat side down, ready to print. */
export function buildSlidingLid(S, warnings) {
  let lid = dovetail(S.lidHalf, S.zb, S.t, SLIDE_SLOPE, S.front, S.back);

  // Springy fingers: slots open at the back end.
  const slotOuter = S.lidTopHalf - S.fingerTop;
  for (const side of [1, -1]) {
    const slot = makeBaseBox(S.slotWidth, S.slotLength + 1, S.t + 2).translate([
      side * (slotOuter - S.slotWidth / 2),
      S.back - S.slotLength / 2 + 0.5,
      S.zb - 1,
    ]);
    lid = lid.cut(slot);
  }
  // Angle the back corners so the lid finds the grooves easily: in the
  // reference the cut runs 2.8 mm along the lid and 1.85 mm across.
  const k = Math.min(1, S.slotLength / 12);
  const along = 2.8 * k;
  const across = 1.85 * k;
  for (const side of [1, -1]) {
    const a = [side * S.lidHalf, S.back - along];
    const b = [side * (S.lidHalf - across), S.back];
    const a2 = [a[0] + (a[0] - b[0]), a[1] + (a[1] - b[1])]; // extend the cut line past both ends
    const b2 = [b[0] + (b[0] - a[0]) * 0.5, b[1] + (b[1] - a[1]) * 0.5];
    const corner = draw(a2).lineTo(b2).lineTo([a2[0], b2[1]]).close();
    lid = lid.cut(corner.sketchOnPlane("XY", S.zb - 1).extrude(S.t + 2));
  }
  // Notches in the fingers that the groove bumps click into (0.3 mm around the bump).
  for (const b of detentBlocks(S, 0.3)) lid = lid.cut(b);

  // Sunken arrow pointing the way the lid closes, as a thumb grip.
  const w = Math.min(2 * (slotOuter - S.slotWidth) - 4, 26);
  const h = Math.min(S.length * 0.5, 20);
  if (w > 6 && h > 6) {
    const depth = S.t - 1;
    const grow = 1.45; // the recess is this much bigger at the top
    const bw = w / grow;
    const bh = h / grow;
    const arrow = draw([-bw / 2, -bh / 2])
      .lineTo([bw / 2, -bh / 2])
      .lineTo([bw / 2, bh * 0.05])
      .lineTo([0, bh / 2])
      .lineTo([-bw / 2, bh * 0.05])
      .close();
    const cy = S.front + 4 + h / 2;
    const recess = arrow
      .sketchOnPlane("XY", [0, cy, S.z - depth])
      .extrude(depth + 0.6, { extrusionProfile: { profile: "linear", endFactor: grow + (grow - 1) * (0.6 / depth) } });
    lid = lid.cut(recess);
  }
  return lid.translate([0, 0, -S.zb]);
}
