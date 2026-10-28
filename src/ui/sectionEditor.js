// Top-down editor for token tray sections: click a compartment to select it,
// split it side by side or front to back, drag the walls between
// compartments, type a compartment's size, remove it, or even out a row.
import { h } from "./dom.js";
import { gridTree, normalise, layoutSections, nodeAt, splitSection, removeSection, evenOut, moveWall, setSectionLength, countLeaves } from "../models/sections.js";

const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(typeof k === "string" ? document.createTextNode(k) : k);
  return el;
}
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const samePath = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

let selected = [0]; // kept across form redraws

/**
 * @param {() => object} getParams  current tray settings (width, depth, wallThickness, cornerRadius, layout, columns, rows)
 * @param {(tree) => void} commit   save a new layout (rebuilds the 3D model)
 */
export function sectionEditor(getParams, commit) {
  const host = h("div.section-editor");
  const view = h("div.section-view");
  const tools = h("div.section-tools");
  const sizeRow = h("div.section-size");
  host.append(view, tools, sizeRow);

  let drag = null; // { wall, start, base }
  let live = null; // tree while dragging (not yet committed)

  const geometry = () => {
    const p = getParams();
    const width = Number(p.width) || 90;
    const depth = Number(p.depth) || 64;
    const wall = Number(p.wallThickness) || 1.6;
    const tree = live ?? (p.layout ? normalise(p.layout) : gridTree(Math.round(p.columns) || 1, Math.round(p.rows) || 1));
    // Same frame as the model, shifted so the tray's front-left corner is 0,0.
    const inner = { x: wall, y: wall, w: width - 2 * wall, h: depth - 2 * wall };
    return { p, width, depth, wall, tree, inner, ...layoutSections(tree, inner, wall) };
  };

  function save(tree) {
    live = null;
    commit(tree);
    draw();
  }

  function draw() {
    const g = geometry();
    const { width, depth, wall, tree, cells, walls } = g;
    if (!cells.some((c) => samePath(c.path, selected))) selected = cells[0].path;
    const pad = Math.max(width, depth) * 0.03;
    const fs = Math.max(2.4, Math.max(width, depth) / 24);
    const root = svg("svg", { viewBox: `${-pad} ${-pad} ${width + 2 * pad} ${depth + 2 * pad}`, role: "group", "aria-label": `Tray sections, ${fmt(width)} by ${fmt(depth)} mm` });
    // y flipped so the front of the tray is at the bottom of the drawing.
    const flip = svg("g", { transform: `matrix(1 0 0 -1 0 ${depth})` });
    const corner = Math.max(0, Math.min(Number(g.p.cornerRadius) || 0, Math.min(width, depth) / 2));
    flip.append(svg("rect", { x: 0, y: 0, width, height: depth, rx: corner, class: "tray" }));
    for (const c of cells) {
      const sel = samePath(c.path, selected);
      const cell = svg("rect", {
        x: c.x, y: c.y, width: c.w, height: c.h, rx: Math.min(1, c.w / 4, c.h / 4),
        class: `cell${sel ? " selected" : ""}`, tabindex: 0, role: "button",
        "aria-label": `Compartment ${fmt(c.w)} by ${fmt(c.h)} mm${sel ? ", selected" : ""}`, "data-path": c.path.join("."),
      });
      flip.append(cell);
      // Size label, if it fits.
      const text = `${fmt(c.w)} × ${fmt(c.h)}`;
      if (c.w > text.length * fs * 0.55 && c.h > fs * 1.4) {
        flip.append(svg("text", { x: c.x + c.w / 2, y: -(c.y + c.h / 2), transform: "scale(1 -1)", class: "size", "font-size": fs }, text));
      }
    }
    for (const w of walls) {
      // A wider, invisible hit area makes thin walls easy to grab.
      const grow = Math.max(0, Math.max(width, depth) / 60 - wall) / 2;
      const hit = w.dir === "x" ? { x: w.x - grow, y: w.y, width: w.w + 2 * grow, height: w.h } : { x: w.x, y: w.y - grow, width: w.w, height: w.h + 2 * grow };
      flip.append(
        svg("rect", { ...hit, class: `wall ${w.dir === "x" ? "ew" : "ns"}`, "data-wall": `${w.path.join(".")}|${w.index}`, tabindex: 0, role: "slider", "aria-label": `Wall, drag to resize. Arrow keys move it 1 mm.`, "aria-orientation": w.dir === "x" ? "horizontal" : "vertical" })
      );
    }
    root.append(flip);
    view.replaceChildren(root);
    drawTools(g);
  }

  function drawTools(g) {
    const cell = g.cells.find((c) => samePath(c.path, selected));
    const btn = (label, title, fn, disabled = false) => h("button", { type: "button", title, disabled, on: { click: fn } }, label);
    const parent = selected.length ? nodeAt(g.tree, selected.slice(0, -1)) : null;
    tools.replaceChildren(
      btn("Split ⇹", "Split this compartment into two, side by side", () => { save(splitSection(g.tree, selected, "x")); }),
      btn("Split ⇵", "Split this compartment into two, front to back", () => { save(splitSection(g.tree, selected, "y")); }),
      btn("Even out", "Make this compartment and the ones beside it the same size", () => save(evenOut(g.tree, selected)), !parent),
      btn("Remove", "Remove this compartment; the one beside it takes its space", () => {
        const next = removeSection(g.tree, selected);
        selected = selected.slice(0, -1).concat(Math.max(0, selected.at(-1) - 1));
        save(next);
      }, countLeaves(g.tree) < 2)
    );
    const sizeField = (label, dir, value) => {
      const inp = h("input", { type: "number", inputmode: "decimal", step: 0.5, min: 4, value: fmt(value), "aria-label": `Selected compartment ${label.toLowerCase()} in mm` });
      inp.addEventListener("change", () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        const next = setSectionLength(g.tree, selected, dir, v, g.inner, g.wall);
        if (next === g.tree) inp.value = fmt(value); // nothing beside it that way to trade with
        else save(next);
      });
      return h("label", label, h("span.input-unit", inp, h("span.unit", "mm")));
    };
    sizeRow.replaceChildren(
      h("span.what", "Selected compartment"),
      h("div.pair", sizeField("Width", "x", cell.w), sizeField("Depth", "y", cell.h))
    );
  }

  // Screen → mm in the tray frame (front-left corner at 0,0).
  const toMm = (e) => {
    const root = view.querySelector("svg");
    const pt = root.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(root.getScreenCTM().inverse());
    return [q.x, getParams().depth - q.y];
  };
  const wallFrom = (el) => {
    const [path, index] = el.dataset.wall.split("|");
    return { path: path ? path.split(".").map(Number) : [], index: Number(index) };
  };

  view.addEventListener("pointerdown", (e) => {
    const wallEl = e.target.closest?.(".wall");
    if (wallEl) {
      const g = geometry();
      const id = wallFrom(wallEl);
      const w = g.walls.find((x) => samePath(x.path, id.path) && x.index === id.index);
      drag = { ...id, dir: w.dir, free: w.free, wall: g.wall, start: toMm(e), base: g.tree };
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const cellEl = e.target.closest?.(".cell");
    if (cellEl) {
      selected = cellEl.dataset.path ? cellEl.dataset.path.split(".").map(Number) : [];
      draw();
    }
  });
  view.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = toMm(e);
    const delta = drag.dir === "x" ? p[0] - drag.start[0] : p[1] - drag.start[1];
    const snapped = e.shiftKey ? delta : Math.round(delta * 2) / 2; // 0.5 mm steps; Shift for free
    live = moveWall(drag.base, drag.path, drag.index, snapped, drag.free, drag.wall);
    draw();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    if (live) save(live);
  };
  view.addEventListener("pointerup", end);
  view.addEventListener("pointercancel", end);
  view.addEventListener("keydown", (e) => {
    const wallEl = e.target.closest?.(".wall");
    const cellEl = e.target.closest?.(".cell");
    if (cellEl && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      selected = cellEl.dataset.path ? cellEl.dataset.path.split(".").map(Number) : [];
      draw();
      view.querySelector(`.cell[data-path="${cellEl.dataset.path}"]`)?.focus();
      return;
    }
    if (!wallEl) return;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const g = geometry();
    const id = wallFrom(wallEl);
    const w = g.walls.find((x) => samePath(x.path, id.path) && x.index === id.index);
    save(moveWall(g.tree, id.path, id.index, step * (e.shiftKey ? 5 : 1), w.free, g.wall));
    view.querySelector(`.wall[data-wall="${wallEl.dataset.wall}"]`)?.focus();
  });

  draw();
  return { el: host, draw };
}
