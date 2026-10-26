// Reusable parts shared by several models.
import { drawRoundedRectangle, makeCylinder } from "replicad";
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
// Snap-fit lid
//
// The box's top few millimetres form a collar; below it the outside of the box
// steps out by a "belt", so the inside keeps its full size. The lid's skirt
// slides over the collar, sits on the belt and ends flush with the box's
// outside. A small ridge around the collar clicks into a groove inside the
// skirt: the skirt must flex past the ridge, then rests in the groove.

/** Every dimension of a snap lid for a box whose core is x × y × z. */
export function snapLidSize({ x, y, z, fillet, wall, belt = 1.6, collar = 6, clearance = 0.15, bead = 0.4 }) {
  const c = clamp(collar, 3, z * 0.5);
  const beadH = Math.min(1.6, c * 0.4);
  const gap = 0.2; // between the rim and the underside of the lid's top
  return {
    x, y, z, fillet, wall, belt, collar: c, clearance, bead, beadH, gap,
    beadZ: z - c / 2,
    outerX: x + 2 * belt,
    outerY: y + 2 * belt,
    outerFillet: fillet + belt,
    lidHeight: c + gap + wall,
    closedHeight: z + gap + wall,
  };
}

/** A rounded-rectangle ridge with 45° ramps top and bottom, as a solid prism. */
function rampedBand(x, y, r, out, zc, h) {
  const band = drawRoundedRectangle(x + 2 * out, y + 2 * out, r + out)
    .sketchOnPlane("XY", zc - h / 2)
    .extrude(h);
  try {
    return band.chamfer(out * 0.95, (e) => e.not((f) => f.inDirection("Z")));
  } catch {
    return band;
  }
}

/** Outer body of a box that takes a snap lid: core + belt + ridge. */
export function snapBody(S) {
  const core = drawRoundedRectangle(S.x, S.y, S.fillet).sketchOnPlane().extrude(S.z);
  const belt = drawRoundedRectangle(S.outerX, S.outerY, S.outerFillet).sketchOnPlane().extrude(S.z - S.collar);
  let ridge = rampedBand(S.x, S.y, S.fillet, S.bead, S.beadZ, S.beadH);
  // Keep only the part outside the collar, overlapping the wall a little so it fuses.
  const inner = drawRoundedRectangle(S.x - 0.4, S.y - 0.4, Math.max(S.fillet - 0.2, 0.1))
    .sketchOnPlane("XY", S.beadZ - S.beadH)
    .extrude(2 * S.beadH);
  ridge = ridge.cut(inner);
  return core.fuse(belt).fuse(ridge);
}

/** The snap lid, oriented top-down for printing. */
export function buildSnapLid(S, warnings) {
  const cl = S.clearance;
  const z0 = S.z - S.collar; // skirt rests on the belt here
  const zTop = S.z + S.gap + S.wall;
  let lid = drawRoundedRectangle(S.outerX, S.outerY, S.outerFillet).sketchOnPlane("XY", z0).extrude(zTop - z0);
  lid = safeFillet(lid, S.wall / 2, atZ(zTop), warnings, "Lid top edge");
  const cavity = drawRoundedRectangle(S.x + 2 * cl, S.y + 2 * cl, S.fillet + cl)
    .sketchOnPlane("XY", z0 - 1)
    .extrude(S.z + S.gap - (z0 - 1));
  lid = lid.cut(cavity);
  // Groove for the ridge: a little deeper and taller than the ridge itself.
  lid = lid.cut(rampedBand(S.x, S.y, S.fillet, S.bead + cl + 0.05, S.beadZ, S.beadH + 0.3));
  // Small notch in the skirt's edge to get a fingernail under it.
  const len = S.belt + 4;
  lid = lid.cut(makeCylinder(3, len, [0, -S.outerY / 2 - 2, z0], [0, 1, 0]));
  return lid.mirror("XY").translate([0, 0, zTop]);
}
