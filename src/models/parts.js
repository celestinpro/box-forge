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
export function slidingLidSize({ x, y, z, wall, thickness = 3, clearance = 0.12, bump = 0.35, ledge = 0 }) {
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
    x, y, z, wall, t, clearance, bump, groove, run, zb, grooveHalf, lidHalf, lidTopHalf, front, back, length,
    stopY,
    ledge: clamp(ledge, 0, 2),
    slotLength,
    slotWidth: 0.8,
    fingerTop: 0.9, // finger width at the top of the lid
    detentY: back - Math.min(5.5, slotLength * 0.45),
    detentR: 1.0,
  };
}

/** Trapezoid profile of the lid (or groove) in XZ, extruded along Y. */
function dovetail(half, zBottom, height, slope, y0, y1) {
  const top = half - slope * height;
  const profile = draw([-half, 0]).lineTo([half, 0]).lineTo([top, height]).lineTo([-top, height]).close();
  // XZ sketches extrude towards -Y from y = 0.
  return profile.sketchOnPlane("XZ").extrude(y1 - y0).translate([0, y1, zBottom]);
}

/** Bump on each groove wall (box) or matching notch (lid): a cylinder along the slanted face. */
function detentCylinders(S, radius) {
  const n = Math.hypot(1, SLIDE_SLOPE);
  const out = S.detentR - S.bump; // cylinder axis sits this far outside the groove face
  const shapes = [];
  for (const side of [1, -1]) {
    // Face at the bottom of the groove, then step outward along the face normal.
    const px = side * (S.grooveHalf + out / n);
    const pz = S.zb + (SLIDE_SLOPE * out) / n;
    const dir = [-side * SLIDE_SLOPE / n, 0, 1 / n];
    const start = [px - dir[0] * 2, S.detentY, pz - dir[2] * 2];
    shapes.push(makeCylinder(radius, S.t / dir[2] + 4, start, dir));
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
  const keep = makeBaseBox(S.x + 10, S.y + 10, S.z); // trim bumps to the box's height
  for (const c of detentCylinders(S, S.detentR)) box = box.fuse(c.intersect(keep.clone()));
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
  // Angle the back corners so the lid finds the grooves easily.
  for (const side of [1, -1]) {
    const c = Math.min(2.5, S.slotLength / 3);
    const corner = draw([side * (S.lidHalf + 1), S.back - c])
      .lineTo([side * (S.lidHalf + 1), S.back + 1])
      .lineTo([side * (S.lidHalf - c - 1), S.back + 1])
      .close();
    lid = lid.cut(corner.sketchOnPlane("XY", S.zb - 1).extrude(S.t + 2));
  }
  // Notches in the fingers that the groove bumps click into.
  for (const c of detentCylinders(S, S.detentR + 0.1)) lid = lid.cut(c);

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
