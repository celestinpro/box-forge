// Laying token pockets out in a tray: auto-pack, overlap checks, finger
// notches and the tray size. Plain JS (no CAD) so the layout editor can use
// it live and the 3D model gets exactly what the editor showed.
//
// Units are mm. A layout item is { key, tokenId, x, y, angle (deg), notch }
// where (x, y) is where the token's centroid sits, measured from the tray's
// bottom-left corner. Token points are already centred on their centroid.
import { bbox, transform, polygonGap, outlineDistance, convexHull, minAreaRect, pointInPolygon } from "./geometry.js";

export const LAYOUT_DEFAULTS = {
  clearance: 0.25, // added around every token
  gap: 1.6, // minimum wall between pockets
  border: 3, // minimum outer wall
  sizeMode: "fit", // fit | set
  width: 120,
  depth: 80,
  notch: true,
  notchDiameter: 0, // 0 = automatic
  lift: false, // lift cutouts in the tray sides
  liftSides: "long", // long | short | all
  liftWidth: 20,
  liftDepth: 8,
};

/**
 * Pocket depth for a token (mm, from the tray top to the pocket floor).
 * Automatic: one piece, or the whole stack, plus any extra depth. A depth set
 * on the token replaces that. Inlays always add their thickness underneath.
 */
export function pocketDepth(t, s) {
  const inlay = s.inlay ? s.inlayThickness : 0;
  if (t.depth > 0) return t.depth + inlay;
  const thickness = Number.isFinite(+t.thickness) ? +t.thickness : 3;
  return thickness * (t.stack === false ? 1 : Math.max(1, Math.round(t.count ?? 1))) + s.extraDepth + inlay;
}

/** Every pocket to place: one per token, or one per piece when not stacked. */
export function expandInstances(tokens) {
  const out = [];
  for (const t of tokens) {
    if (t.include === false) continue;
    const count = Math.max(1, Math.round(t.count ?? 1));
    const pockets = t.stack === false ? count : 1;
    for (let i = 0; i < pockets; i++) out.push({ key: `${t.id}:${i}`, tokenId: t.id });
  }
  return out;
}

/** Token outline placed in the tray. */
export function placed(token, item) {
  return transform(token.points, { angle: (item.angle * Math.PI) / 180, dx: item.x, dy: item.y });
}

/** Default notch diameter for a token: 60% of its smaller side, 10–20 mm. */
export const notchSize = (token, s) => (s.notchDiameter > 0 ? s.notchDiameter : Math.max(10, Math.min(20, 0.6 * Math.min(token.w, token.h))));

/** Rotation (deg) that makes a token's bounding box smallest, so packing is tighter. */
function tightAngle(token) {
  const r = minAreaRect(convexHull(token.points));
  let a = (-r.angle * 180) / Math.PI;
  if (r.h > r.w) a += 90; // long side along X
  return ((a % 180) + 180) % 180;
}

/**
 * MaxRects packing (best short-side fit) of rectangles into a W×H bin.
 * Returns placements { i, x, y, rotated } and the indices that didn't fit.
 */
function maxRects(rects, W, H) {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  const placedRects = [];
  const missed = [];
  for (const { i, w, h } of rects) {
    let best = null;
    for (const f of free) {
      for (const [rw, rh, rot] of [[w, h, false], [h, w, true]]) {
        if (rw <= f.w + 1e-9 && rh <= f.h + 1e-9) {
          const score = Math.min(f.w - rw, f.h - rh);
          const tie = Math.max(f.w - rw, f.h - rh);
          if (!best || score < best.score || (score === best.score && tie < best.tie)) best = { x: f.x, y: f.y, w: rw, h: rh, rot, score, tie };
        }
      }
    }
    if (!best) {
      missed.push(i);
      continue;
    }
    placedRects.push({ i, x: best.x, y: best.y, w: best.w, h: best.h, rotated: best.rot });
    // Split free rectangles around the new one.
    const next = [];
    for (const f of free) {
      if (best.x >= f.x + f.w || best.x + best.w <= f.x || best.y >= f.y + f.h || best.y + best.h <= f.y) {
        next.push(f);
        continue;
      }
      if (best.x > f.x) next.push({ x: f.x, y: f.y, w: best.x - f.x, h: f.h });
      if (best.x + best.w < f.x + f.w) next.push({ x: best.x + best.w, y: f.y, w: f.x + f.w - best.x - best.w, h: f.h });
      if (best.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: best.y - f.y });
      if (best.y + best.h < f.y + f.h) next.push({ x: f.x, y: best.y + best.h, w: f.w, h: f.y + f.h - best.y - best.h });
    }
    free = next.filter((a, k) => !next.some((b, m) => m !== k && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (m < k || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)));
  }
  return { placed: placedRects, missed };
}

/**
 * Arrange all pockets. In "fit" mode the tray grows to suit (trying a few
 * shapes and keeping the smallest); in "set" mode they're packed into the
 * given size and anything that doesn't fit is reported.
 */
export function autoPack(tokens, settings = {}) {
  const s = { ...LAYOUT_DEFAULTS, ...settings };
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const items = expandInstances(tokens);
  const spacing = 2 * s.clearance + s.gap; // pocket-to-pocket
  const rects = items.map((it, i) => {
    const t = byId.get(it.tokenId);
    const base = tightAngle(t);
    const b = bbox(transform(t.points, { angle: (base * Math.PI) / 180 }));
    // Leave room on one side (+X before any rotation) for the finger notch,
    // which sits on the token's edge and sticks out by its radius.
    const extra = s.notch && t.notch !== false ? notchSize(t, s) / 2 : 0;
    return { i, w: b.w + spacing + extra, h: b.h + spacing, base, b, extra };
  });
  rects.sort((a, b) => b.w * b.h - a.w * a.h);

  const pad = s.border + s.clearance - s.gap / 2; // so pocket-to-edge = border
  let result;
  if (s.sizeMode === "set") {
    result = maxRects(rects, s.width - 2 * pad, s.depth - 2 * pad);
  } else {
    const totalArea = rects.reduce((a, r) => a + r.w * r.h, 0);
    const widest = Math.max(...rects.map((r) => Math.max(r.w, r.h)), 1);
    let bestArea = Infinity;
    for (const ratio of [0.6, 0.8, 1, 1.25, 1.6, 2.2, 3]) {
      const w = Math.max(widest, Math.sqrt(totalArea * ratio) * 1.05);
      const r = maxRects(rects, w, 1e6);
      const used = r.placed.reduce((m, p) => ({ w: Math.max(m.w, p.x + p.w), h: Math.max(m.h, p.y + p.h) }), { w: 0, h: 0 });
      const ar = used.w * used.h * (1 + 0.05 * Math.abs(Math.log(used.w / used.h)));
      if (ar < bestArea) {
        bestArea = ar;
        result = r;
      }
    }
  }
  const rectByIdx = new Map(rects.map((r) => [r.i, r]));
  const layout = result.placed.map((p) => {
    const r = rectByIdx.get(p.i);
    const angle = (r.base + (p.rotated ? 90 : 0)) % 360;
    const t = byId.get(items[p.i].tokenId);
    const b = bbox(transform(t.points, { angle: (angle * Math.PI) / 180 }));
    // Put the token's box in its packed rectangle, leaving the notch room on
    // the +X side (or +Y when the rectangle was turned).
    const cx = pad + p.x + (p.rotated ? p.w / 2 : (p.w - r.extra) / 2);
    const cy = pad + p.y + (p.rotated ? (p.h - r.extra) / 2 : p.h / 2);
    const x = cx - (b.x0 + b.x1) / 2;
    const y = cy - (b.y0 + b.y1) / 2;
    return { ...items[p.i], x, y, angle, notch: 0 };
  });
  return { items: layout, missed: result.missed.map((i) => items[i].key) };
}

/**
 * Check a layout: pockets too close or overlapping, and pockets outside the
 * tray (in "set" mode). Also works out the tray size and each finger notch.
 */
export function analyse(tokens, items, settings = {}) {
  const s = { ...LAYOUT_DEFAULTS, ...settings };
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const live = items.filter((it) => byId.has(it.tokenId));
  const shapes = live.map((it) => {
    const poly = placed(byId.get(it.tokenId), it);
    return { it, poly, box: bbox(poly) };
  });
  const problems = [];
  const bad = new Set();
  const minGap = 2 * s.clearance + s.gap;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const g = polygonGap(shapes[i].poly, shapes[j].poly, shapes[i].box, shapes[j].box, minGap);
      if (g < minGap - 1e-6) {
        bad.add(shapes[i].it.key);
        bad.add(shapes[j].it.key);
        problems.push({ keys: [shapes[i].it.key, shapes[j].it.key], gap: g });
      }
    }
  }

  // Tray size.
  const edge = s.border + s.clearance; // token outline → tray edge
  let tray;
  if (s.sizeMode === "set") {
    tray = { x0: 0, y0: 0, w: s.width, h: s.depth };
  } else if (shapes.length) {
    const x0 = Math.min(...shapes.map((p) => p.box.x0)) - edge;
    const y0 = Math.min(...shapes.map((p) => p.box.y0)) - edge;
    const x1 = Math.max(...shapes.map((p) => p.box.x1)) + edge;
    const y1 = Math.max(...shapes.map((p) => p.box.y1)) + edge;
    tray = { x0, y0, w: x1 - x0, h: y1 - y0 };
  } else {
    tray = { x0: 0, y0: 0, w: 40, h: 40 };
  }
  for (const p of shapes) {
    const out = p.box.x0 - edge < tray.x0 - 1e-6 || p.box.y0 - edge < tray.y0 - 1e-6 || p.box.x1 + edge > tray.x0 + tray.w + 1e-6 || p.box.y1 + edge > tray.y0 + tray.h + 1e-6;
    if (out) {
      bad.add(p.it.key);
      problems.push({ keys: [p.it.key], outside: true });
    }
  }

  // Finger notches: a circle centred on the pocket's edge, placed where it
  // stays clear of other pockets and the tray walls. `notch` on an item picks
  // the 1st, 2nd, … best spot, so the user can move it around.
  const notches = new Map();
  if (s.notch) {
    for (const p of shapes) {
      const t = byId.get(p.it.tokenId);
      if (t.notch === false) continue;
      const r = notchSize(t, s) / 2;
      const cands = candidatesAlong(p.poly, 1.5);
      const scored = [];
      for (const c of cands) {
        // Room to the tray walls and to every other pocket.
        let room = Math.min(c[0] - tray.x0, c[1] - tray.y0, tray.x0 + tray.w - c[0], tray.y0 + tray.h - c[1]) - r - s.border / 2;
        for (const o of shapes) {
          if (o === p) continue;
          if (o.box.x0 - c[0] > r + 20 || c[0] - o.box.x1 > r + 20 || o.box.y0 - c[1] > r + 20 || c[1] - o.box.y1 > r + 20) continue;
          const d = pointInPolygon(c, o.poly) ? -outlineDistance(c, o.poly) : outlineDistance(c, o.poly);
          room = Math.min(room, d - r - s.clearance - s.gap / 2);
        }
        if (room >= 0) scored.push({ c, room });
      }
      // Spread the choices: best spots first, at least one notch-width apart.
      scored.sort((a, b) => b.room - a.room);
      const picks = [];
      for (const sc of scored) if (picks.every((q) => Math.hypot(q.c[0] - sc.c[0], q.c[1] - sc.c[1]) > r)) picks.push(sc);
      if (picks.length) {
        const pick = picks[(p.it.notch ?? 0) % picks.length];
        notches.set(p.it.key, { x: pick.c[0], y: pick.c[1], r, options: picks.length });
      } else {
        notches.set(p.it.key, null);
      }
    }
  }
  const lift = s.lift ? liftCutouts(tray, shapes, notches, s) : { cuts: [], missing: [], grown: 0 };
  return { tray: lift.tray ?? tray, problems, bad, notches, shapes, lifts: lift.cuts, liftMissing: lift.missing, liftGrown: lift.grown };
}

export const LIFT_MIN_DEPTH = 4; // a fingertip grip

/** Which tray sides get a lift cutout. */
function liftSideNames(tray, which) {
  if (which === "all") return ["front", "back", "left", "right"];
  const long = tray.w >= tray.h ? ["front", "back"] : ["left", "right"];
  const short = tray.w >= tray.h ? ["left", "right"] : ["front", "back"];
  return which === "short" ? short : long;
}

/** A side as an edge: start point, direction along it, inward normal, length. */
function sideOf(tray, name) {
  const { x0, y0, w, h } = tray;
  if (name === "front") return { p: [x0, y0], dir: [1, 0], n: [0, 1], len: w };
  if (name === "back") return { p: [x0, y0 + h], dir: [1, 0], n: [0, -1], len: w };
  if (name === "left") return { p: [x0, y0], dir: [0, 1], n: [1, 0], len: h };
  return { p: [x0 + w, y0], dir: [0, 1], n: [-1, 0], len: h };
}

/**
 * Lift cutouts: a round bite through the full height of a tray side, so
 * fingers can reach down beside the insert and lift it out of the game box.
 * The bite is the part of a circle (radius R, centre outside the tray) that
 * crosses the wall: `width` wide at the edge and `depth` deep.
 *
 * For each side: try the middle, then slide along the side to the nearest
 * spot that keeps a full wall (`gap`) to every pocket and finger notch; then
 * try shallower bites down to a fingertip; then, in "fit" mode, grow the tray
 * on that side just enough. In "set" mode a side with no room is skipped.
 */
export function liftCutouts(tray0, shapes, notches, s) {
  const width = s.liftWidth;
  const want = Math.min(s.liftDepth, width / 2);
  const minDepth = Math.min(want, LIFT_MIN_DEPTH);
  const corner = s.corner ?? 3;
  const wall = s.clearance + s.gap; // token outline → cutout
  const names = liftSideNames(tray0, s.liftSides);
  let tray = { ...tray0 };
  let grown = 0;

  // Smallest wall left between a cutout circle and the pockets (≥ 0 fits).
  const roomFor = (c, R) => {
    let room = Infinity;
    for (const o of shapes) {
      if (o.box.x0 - c[0] > R + wall + 1 || c[0] - o.box.x1 > R + wall + 1 || o.box.y0 - c[1] > R + wall + 1 || c[1] - o.box.y1 > R + wall + 1) continue;
      const d = pointInPolygon(c, o.poly) ? -outlineDistance(c, o.poly) : outlineDistance(c, o.poly);
      room = Math.min(room, d - R - wall);
    }
    for (const n of notches.values()) {
      if (!n) continue;
      room = Math.min(room, Math.hypot(c[0] - n.x, c[1] - n.y) - R - n.r - s.gap);
    }
    return room;
  };
  const circleAt = (side, t, d) => {
    const R = (width * width) / 4 / (2 * d) + d / 2;
    const e = [side.p[0] + side.dir[0] * t, side.p[1] + side.dir[1] * t];
    return { e, c: [e[0] - side.n[0] * (R - d), e[1] - side.n[1] * (R - d)], R };
  };

  for (let round = 0; round < 6; round++) {
    const cuts = [];
    const missing = [];
    let grow = null;
    for (const name of names) {
      const side = sideOf(tray, name);
      const margin = corner + width / 2 + 1; // keep clear of the rounded corners
      if (side.len < 2 * margin) {
        missing.push({ side: name, reason: "side too short" });
        continue;
      }
      let found = null;
      // Middle first, then outward in 0.5 mm steps; deepest bite first.
      const half = side.len / 2 - margin;
      const offsets = [0];
      for (let k = 0.5; k <= half + 1e-9; k += 0.5) offsets.push(k, -k);
      const depths = [];
      for (let d = want; d > minDepth + 1e-9; d -= 0.5) depths.push(d);
      depths.push(minDepth);
      for (const d of depths) {
        if (found) break;
        for (const off of offsets) {
          const C = circleAt(side, side.len / 2 + off, d);
          if (roomFor(C.c, C.R) >= -1e-9) {
            found = { side: name, x: C.e[0], y: C.e[1], cx: C.c[0], cy: C.c[1], r: C.R, width, depth: d, normal: side.n };
            break;
          }
        }
      }
      if (found) {
        cuts.push(found);
        continue;
      }
      if (s.sizeMode !== "set") {
        // Grow this side so the full-depth bite fits in the middle.
        const C = circleAt(side, side.len / 2, want);
        grow = { name, by: -roomFor(C.c, C.R) + 0.05 };
        break;
      }
      missing.push({ side: name, reason: "no room" });
    }
    if (!grow) return { cuts, missing, grown, tray: grown ? tray : null };
    const by = Math.max(0.05, grow.by);
    grown += by;
    if (grow.name === "front") tray = { ...tray, y0: tray.y0 - by, h: tray.h + by };
    else if (grow.name === "back") tray = { ...tray, h: tray.h + by };
    else if (grow.name === "left") tray = { ...tray, x0: tray.x0 - by, w: tray.w + by };
    else tray = { ...tray, w: tray.w + by };
  }
  return { cuts: [], missing: names.map((side) => ({ side, reason: "no room" })), grown, tray };
}

/** Points every `step` mm along a polygon's outline. */
function candidatesAlong(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.floor(len / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
