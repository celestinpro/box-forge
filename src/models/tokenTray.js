// Token tray: a grid of compartments with scooped floors so tokens slide
// out easily, and an optional slip-over lid.
import { drawRoundedRectangle } from "replicad";
import { clamp, safeFillet, num, requireRange, atZ } from "./util.js";
import { slipLidSize, buildSlipLid, snapLidSize, snapBody, buildSnapLid } from "./parts.js";
import { TOKEN_TRAY_DEFAULTS } from "./config.js";

export { TOKEN_TRAY_DEFAULTS } from "./config.js";


export function tokenTrayLayout(input) {
  const p = { ...TOKEN_TRAY_DEFAULTS, ...input };
  const width = num(p.width, 90);
  const depth = num(p.depth, 64);
  const height = num(p.height, 20);
  const columns = Math.round(num(p.columns, 3));
  const rows = Math.round(num(p.rows, 2));
  const wall = num(p.wallThickness, 1.6);
  const floor = num(p.floorThickness, 1.2);
  const lidTol = num(p.lidTolerance, 0.6);
  requireRange("Width", width, 10, 400);
  requireRange("Depth", depth, 10, 400);
  requireRange("Height", height, 4, 200);
  requireRange("Wall thickness", wall, 0.8, 6);
  requireRange("Floor thickness", floor, 0.6, 6);
  if (!(columns >= 1 && columns <= 12) || !(rows >= 1 && rows <= 12)) {
    throw new Error("Columns and rows must each be between 1 and 12.");
  }

  // Lid style: slide-over, snap-fit, or none. A snap lid's belt comes out of
  // the outside size, so the tray still fits the space it was sized for.
  const lidStyle = p.lid === false ? "none" : ["slide", "snap"].includes(p.lidStyle) ? p.lidStyle : "slide";
  const belt = lidStyle === "snap" ? clamp(num(p.snapBelt, 1.6), 1, 4) : 0;
  const coreW = width - 2 * belt;
  const coreD = depth - 2 * belt;
  const cellX = (coreW - (columns + 1) * wall) / columns;
  const cellY = (coreD - (rows + 1) * wall) / rows;
  const cellZ = height - floor;
  if (cellX < 4 || cellY < 4) {
    throw new Error(`Compartments would be only ${cellX.toFixed(1)} × ${cellY.toFixed(1)} mm. Make the tray bigger or use fewer rows/columns.`);
  }
  if (cellZ < 2) throw new Error("Height must be at least 2 mm more than the floor thickness.");

  const cellFillet = clamp(num(p.cornerRadius, 3) - wall, 0, Math.min(cellX, cellY) / 2 - 0.3);
  const outerFillet = cellFillet + wall;
  const scoop = clamp(num(p.scoop, 8), 0, Math.min(cellZ - 0.5, cellY / 2 - 0.5, cellX / 2 - 0.5));
  const lid = slipLidSize({ x: width, y: depth, z: height, fillet: outerFillet, wall, tolerance: lidTol });
  const snap =
    lidStyle === "snap"
      ? snapLidSize({ x: coreW, y: coreD, z: height, fillet: outerFillet, wall, belt, collar: num(p.snapCollar, 6), clearance: num(p.snapClearance, 0.15) })
      : null;

  return {
    params: { ...p, width, depth, height, columns, rows, wallThickness: wall, floorThickness: floor, lidTolerance: lidTol, lidStyle },
    width, depth, height, columns, rows, wall, floor, coreW, coreD, lidStyle,
    cellX, cellY, cellZ, cellFillet, outerFillet, scoop, lid, snap,
  };
}

export function buildTokenTray(params) {
  const L = tokenTrayLayout(params);
  const warnings = [];
  const { coreW, coreD, height, columns, rows, wall, floor, cellX, cellY, cellZ, cellFillet, outerFillet, scoop } = L;

  let tray = L.snap ? snapBody(L.snap) : drawRoundedRectangle(coreW, coreD, outerFillet).sketchOnPlane().extrude(height);

  // One cell shape, filleted once, then copied into every grid position.
  let cell = (cellFillet > 0.05 ? drawRoundedRectangle(cellX, cellY, cellFillet) : drawRoundedRectangle(cellX, cellY))
    .sketchOnPlane("XY", floor)
    .extrude(cellZ + 1);
  cell = safeFillet(cell, scoop, atZ(floor), warnings, "Compartment scoop");

  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -coreW / 2 + wall + cellX / 2 + i * (cellX + wall);
      const y = -coreD / 2 + wall + cellY / 2 + j * (cellY + wall);
      tray = tray.cut(cell.clone().translate([x, y, 0]));
    }
  }
  tray = safeFillet(tray, Math.min(0.4, wall / 4), atZ(height), warnings, "Top rim");

  const parts = [{ name: "tray", shape: tray }];
  if (L.lidStyle === "slide") parts.push({ name: "lid", shape: buildSlipLid(L.lid, wall, warnings, "y") });
  if (L.lidStyle === "snap") parts.push({ name: "lid", shape: buildSnapLid(L.snap, warnings) });
  return { parts, layout: L, warnings };
}

export function describeTokenTray(L) {
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const lines = [
    `Tray ${f(L.width)} × ${f(L.depth)} × ${f(L.height)} mm`,
    `${L.columns * L.rows} compartments, each ${f(L.cellX)} × ${f(L.cellY)} × ${f(L.cellZ)} mm`,
  ];
  if (L.lidStyle === "slide") lines.push(`Lid ${f(L.lid.outerX)} × ${f(L.lid.outerY)} × ${f(L.lid.outerZ)} mm`);
  if (L.snap) {
    lines.push(`Snap lid ${f(L.snap.outerX)} × ${f(L.snap.outerY)} × ${f(L.snap.lidHeight)} mm; ${f(L.snap.closedHeight)} mm tall when closed`);
  }
  return lines;
}
