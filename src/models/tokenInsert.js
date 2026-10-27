// Token insert: a tray with a pocket shaped like each traced token, plus a
// finger notch per pocket and optional thin coloured inlays for the pocket
// floors (so an empty pocket stands out).
import { draw, drawCircle, drawRoundedRectangle } from "replicad";
import { safeFillet, atZ, num, requireRange, clamp } from "./util.js";
import { analyse, placed, LAYOUT_DEFAULTS } from "../trace/layout.js";
import { pocketOutline } from "../trace/outline.js";
import { TOKEN_INSERT_DEFAULTS } from "./config.js";

export { TOKEN_INSERT_DEFAULTS } from "./config.js";

/** Pocket depth for a token: one piece, or the whole stack. */
export const pocketDepth = (t, s) => num(t.thickness, 3) * (t.stack === false ? 1 : Math.max(1, Math.round(t.count ?? 1))) + s.extraDepth + (s.inlay ? s.inlayThickness : 0);

export function tokenInsertLayout(params) {
  const s = { ...LAYOUT_DEFAULTS, ...TOKEN_INSERT_DEFAULTS, ...(params.settings || {}) };
  for (const k of ["clearance", "gap", "border", "floor", "extraDepth", "rounding", "inlayThickness", "width", "depth", "height", "liftWidth", "liftDepth"]) s[k] = num(s[k], TOKEN_INSERT_DEFAULTS[k] ?? LAYOUT_DEFAULTS[k]);
  requireRange("Clearance", s.clearance, 0, 3);
  requireRange("Wall between pockets", s.gap, 0.8, 20);
  requireRange("Outer wall", s.border, 1, 40);
  requireRange("Floor", s.floor, 0.4, 10);
  if (s.lift) {
    requireRange("Lift cutout width", s.liftWidth, 8, 60);
    requireRange("Lift cutout depth", s.liftDepth, 2, 30);
  }
  const tokens = (params.tokens || []).filter((t) => t.include !== false);
  if (!tokens.length) throw new Error("No tokens yet. Upload a photo or SVG and include at least one token.");
  for (const t of tokens) requireRange(`${t.name || "Token"} thickness`, num(t.thickness, 3), 0.3, 100);
  const items = (params.items || []).filter((it) => tokens.some((t) => t.id === it.tokenId));
  if (!items.length) throw new Error("Arrange the tokens first.");

  const A = analyse(tokens, items, s);
  if (A.bad.size) {
    const names = new Map(tokens.map((t) => [t.id, t.name || `Token ${t.id}`]));
    const label = (key) => names.get(Number(key.split(":")[0])) ?? key;
    const p = A.problems[0];
    throw new Error(
      p.outside
        ? `${label(p.keys[0])} is outside the tray. Drag it in, make the tray bigger, or use Auto-arrange.`
        : `${label(p.keys[0])} and ${label(p.keys[1])} are too close (need ${(2 * s.clearance + s.gap).toFixed(1)} mm between tokens). Drag them apart or use Auto-arrange.`
    );
  }
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const depths = items.map((it) => pocketDepth(byId.get(it.tokenId), s));
  const deepest = Math.max(...depths);
  let height;
  if (s.heightMode === "set") {
    height = s.height;
    if (height < deepest + s.floor - 1e-6) throw new Error(`The deepest pocket needs ${(deepest + s.floor).toFixed(1)} mm of height (pocket ${deepest.toFixed(1)} mm + ${s.floor} mm floor).`);
  } else {
    height = deepest + s.floor;
  }
  return { s, tokens, byId, items, depths, height, ...A };
}

/** A closed outline (already exact, from pocketOutline) as a replicad drawing. */
function outlineDrawing(pts) {
  let pen = draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  return pen.close();
}

export function buildTokenInsert(params) {
  const L = tokenInsertLayout(params);
  const { s, tray, height, items, depths, byId, notches } = L;
  const warnings = [];
  const shift = ([x, y]) => [x - tray.x0, y - tray.y0];
  const corner = clamp(s.corner ?? 3, 0, Math.min(tray.w, tray.h) / 2 - 0.5);

  // Tray body, with its outer top edge rounded before the pockets are cut.
  let body = drawRoundedRectangle(tray.w, tray.h, corner).sketchOnPlane().extrude(height).translate([tray.w / 2, tray.h / 2, 0]);
  body = safeFillet(body, Math.min(s.rounding, height / 3), atZ(height), warnings, "Tray edge");
  let cutter = null;
  const inlays = [];
  items.forEach((it, i) => {
    const t = byId.get(it.tokenId);
    const pts = placed(t, it).map(shift);
    const floorZ = height - depths[i];
    // Pocket = token + clearance, joined with its finger notch (same floor),
    // inside corners rounded so the cut has one smooth outline.
    const n = notches.get(it.key);
    const notch = n ? { x: n.x - tray.x0, y: n.y - tray.y0, r: n.r } : null;
    const outline = pocketOutline(pts, { grow: s.clearance, notch, round: notch ? 1.5 : 0 });
    const pocket = outlineDrawing(outline).sketchOnPlane("XY", floorZ).extrude(depths[i] + 1);
    cutter = cutter ? cutter.fuse(pocket) : pocket;
    if (s.inlay) {
      const inlay = outlineDrawing(pocketOutline(pts, { grow: s.clearance - 0.15 })).sketchOnPlane("XY", floorZ).extrude(s.inlayThickness);
      inlays.push(inlay);
    }
  });
  // Lift cutouts: a round bite through the full height of a side.
  for (const c of L.lifts) {
    const bite = drawCircle(c.r).sketchOnPlane("XY", -1).extrude(height + 2).translate([c.cx - tray.x0, c.cy - tray.y0, 0]);
    cutter = cutter.fuse(bite);
  }
  body = body.cut(cutter);
  const parts = [{ name: "tray", shape: body }];
  if (inlays.length) parts.push({ name: "inlays", shape: inlays.reduce((a, b) => a.fuse(b)) });
  return { parts, layout: L, warnings };
}

export function describeTokenInsert(L) {
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const pockets = L.items.length;
  const pieces = L.tokens.reduce((a, t) => a + Math.max(1, Math.round(t.count ?? 1)), 0);
  const lines = [`Tray ${f(L.tray.w)} × ${f(L.tray.h)} × ${f(L.height)} mm`, `${pockets} pocket${pockets === 1 ? "" : "s"} for ${pieces} piece${pieces === 1 ? "" : "s"}`];
  const missing = [...L.notches.values()].filter((n) => n === null).length;
  if (missing) lines.push(`${missing} pocket${missing === 1 ? " has" : "s have"} no room for a finger notch`);
  if (L.s.lift) {
    const sides = L.lifts.map((c) => `${c.side}${c.depth < Math.min(L.s.liftDepth, L.s.liftWidth / 2) - 1e-6 ? ` (${f(c.depth)} mm deep, no room for more)` : ""}`);
    if (L.lifts.length) lines.push(`Lift cutouts: ${sides.join(", ")}`);
    if (L.liftGrown > 0) lines.push(`Tray grown ${f(L.liftGrown)} mm to make room for the lift cutouts`);
    for (const m of L.liftMissing) lines.push(`No lift cutout on the ${m.side}: ${m.reason === "side too short" ? "that side is too short" : "pockets are in the way. Drag them aside or make the tray bigger"}`);
  }
  if (L.s.inlay) lines.push(`Inlays ${f(L.s.inlayThickness)} mm: print them in a bright colour and drop them in the pockets`);
  return lines;
}
