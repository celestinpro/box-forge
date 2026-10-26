// Reusable parts shared by several models.
import { drawRoundedRectangle, makeCylinder } from "replicad";
import { safeFillet, atZ } from "./util.js";

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
