// Token tray: compartments with scooped floors so tokens slide out easily,
// and an optional lid. Compartments are an even grid, or any layout of
// sections from the editor (see sections.js).
import { drawRoundedRectangle } from "replicad";
import { clamp, safeFillet, num, requireRange, atZ } from "./util.js";
import { slipLidSize, buildSlipLid, slidingLidSize, cutSlidingLidWell, buildSlidingLid } from "./parts.js";
import { TOKEN_TRAY_DEFAULTS } from "./config.js";
import { gridTree, normalise, layoutSections, MIN_SECTION } from "./sections.js";

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

  // Sections: the editor's layout, or an even grid. Cells are centred on the
  // tray like the tray body (origin in the middle).
  const sections = p.layout ? normalise(p.layout) : gridTree(columns, rows);
  const inner = { x: -width / 2 + wall, y: -depth / 2 + wall, w: width - 2 * wall, h: depth - 2 * wall };
  const { cells } = layoutSections(sections, inner, wall);
  const smallest = cells.reduce((m, c) => (Math.min(c.w, c.h) < Math.min(m.w, m.h) ? c : m), cells[0]);
  // Lid: a cap that slides over the tray, a sliding lid set into the top
  // (the compartments end under it), or none.
  const lidStyle = p.lid === false ? "none" : p.lidStyle === "sliding" ? "sliding" : "cap";
  const slideT = lidStyle === "sliding" ? clamp(num(p.slideThickness, 3), 2, 6) : 0;
  const cellZ = height - floor - slideT;
  if (Math.min(smallest.w, smallest.h) < MIN_SECTION - 1e-6) {
    throw new Error(
      `Compartments would be only ${smallest.w.toFixed(1)} × ${smallest.h.toFixed(1)} mm. Make the tray bigger or use ${p.layout ? "fewer sections" : "fewer rows/columns"}.`
    );
  }
  if (cellZ < 2) {
    throw new Error(lidStyle === "sliding" ? "Height must be at least 2 mm more than the floor plus the sliding lid." : "Height must be at least 2 mm more than the floor thickness.");
  }

  // Corner and scoop radii shrink to suit each compartment.
  const cellFillet = clamp(num(p.cornerRadius, 3) - wall, 0, Math.min(smallest.w, smallest.h) / 2 - 0.3);
  const outerFillet = cellFillet + wall;
  const wantScoop = Math.max(0, num(p.scoop, 8));
  for (const c of cells) c.scoop = clamp(wantScoop, 0, Math.min(cellZ - 0.5, c.h / 2 - 0.5, c.w / 2 - 0.5));
  const scoop = Math.min(...cells.map((c) => c.scoop));
  const lid = slipLidSize({ x: width, y: depth, z: height, fillet: outerFillet, wall, tolerance: lidTol });
  const slide =
    lidStyle === "sliding"
      ? slidingLidSize({ x: width, y: depth, z: height, wall, thickness: slideT, clearance: clamp(num(p.slideClearance, 0.12), 0, 1), ledge: 1 })
      : null;

  return {
    params: { ...p, width, depth, height, columns, rows, wallThickness: wall, floorThickness: floor, lidTolerance: lidTol, lidStyle },
    width, depth, height, columns, rows, wall, floor, lidStyle,
    sections, cells, cellZ, cellFillet, outerFillet, scoop, wantScoop, lid, slide,
  };
}

export function buildTokenTray(params) {
  const L = tokenTrayLayout(params);
  const warnings = [];
  const { width, depth, height, floor, cells, cellZ, cellFillet, outerFillet, wall } = L;

  let tray = drawRoundedRectangle(width, depth, outerFillet).sketchOnPlane().extrude(height);

  // One rounded, scooped shape per distinct compartment size, copied into
  // every compartment of that size (an even grid fillets just once).
  const shapes = new Map();
  for (const c of cells) {
    const key = `${c.w.toFixed(3)}x${c.h.toFixed(3)}`;
    if (!shapes.has(key)) {
      const r = clamp(cellFillet, 0, Math.min(c.w, c.h) / 2 - 0.3);
      let cell = (r > 0.05 ? drawRoundedRectangle(c.w, c.h, r) : drawRoundedRectangle(c.w, c.h)).sketchOnPlane("XY", floor).extrude(cellZ + 1);
      cell = safeFillet(cell, c.scoop, atZ(floor), warnings, "Compartment scoop");
      shapes.set(key, cell);
    }
    tray = tray.cut(shapes.get(key).clone().translate([c.x + c.w / 2, c.y + c.h / 2, 0]));
  }
  tray = safeFillet(tray, Math.min(0.4, wall / 4), atZ(height), warnings, "Top rim");
  if (L.slide) tray = cutSlidingLidWell(tray, L.slide);

  const parts = [{ name: "tray", shape: tray }];
  if (L.lidStyle === "cap") parts.push({ name: "lid", shape: buildSlipLid(L.lid, wall, warnings, "y") });
  if (L.slide) parts.push({ name: "lid", shape: buildSlidingLid(L.slide, warnings) });
  return { parts, layout: L, warnings };
}

export function describeTokenTray(L) {
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const lines = [
    `Tray ${f(L.width)} × ${f(L.depth)} × ${f(L.height)} mm`,
  ];
  const n = L.cells.length;
  const sizes = [...new Set(L.cells.map((c) => `${f(c.w)} × ${f(c.h)}`))];
  if (sizes.length === 1) lines.push(`${n} compartment${n === 1 ? "" : "s"}, each ${sizes[0]} × ${f(L.cellZ)} mm`);
  else lines.push(`${n} compartments in ${sizes.length} sizes, all ${f(L.cellZ)} mm deep`);
  if (L.wantScoop > L.scoop + 0.05) lines.push(`Scoop reduced to ${f(L.scoop)} mm in the smallest compartment`);
  if (L.lidStyle === "cap") lines.push(`Lid ${f(L.lid.outerX)} × ${f(L.lid.outerY)} × ${f(L.lid.outerZ)} mm`);
  if (L.slide) lines.push(`Sliding lid ${f(L.slide.t)} mm thick, flush with the top; slides in from the front and clicks shut`);
  return lines;
}
