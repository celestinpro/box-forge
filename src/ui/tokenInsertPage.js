// Token insert page: photo (or SVG) → traced token outlines → arranged
// pockets → printable tray.
//
// Left: the three steps (photo, tokens, tray). Right: tabs for the photo
// with its traced outlines (and a touch-up brush), the layout editor
// (drag and rotate pockets) and the 3D preview, with downloads below.
import { h, numberField, segmented, checkbox, debounce } from "./dom.js";
import { Viewer } from "../viewer.js";
import { build, exportPart } from "../cad/client.js";
import { setImage, traceImage } from "../trace/client.js";
import { autoPack, analyse, expandInstances, placed, pocketDepth } from "../trace/layout.js";
import { pocketOutline } from "../trace/outline.js";
import { toPath } from "../trace/geometry.js";
import { TOKEN_INSERT_DEFAULTS } from "../models/config.js";

const STORE = "box-forge:token-insert";
const MAX_SIDE = 3000; // photos are scaled to at most this many px on the long side
const SVG_NS = "http://www.w3.org/2000/svg";

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...kids.flat().filter(Boolean));
  return el;
};
/** replaceChildren that skips null/false entries (conditional controls). */
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();
const rgb = ([r, g, b]) => `rgb(${r} ${g} ${b})`;

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function save(data) {
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the page still works, it just won't remember.
  }
}

// ------------------------------------------------------------ image loading
/** Draw an image (or SVG) into a canvas, at most MAX_SIDE px on its long side. */
async function fileToCanvas(file) {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (isSvg) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    if (root.nodeName !== "svg") throw new Error("That SVG couldn't be read.");
    // Size: from width/height, else the viewBox.
    const unit = (v) => {
      const m = /^\s*([\d.]+)\s*(mm|cm|in|pt|px)?\s*$/.exec(v || "");
      if (!m) return null;
      const n = parseFloat(m[1]);
      return { n, mm: { mm: n, cm: n * 10, in: n * 25.4, pt: (n * 25.4) / 72 }[m[2]] ?? null };
    };
    const vb = (root.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const w = unit(root.getAttribute("width"));
    const hgt = unit(root.getAttribute("height"));
    const srcW = w?.n || vb[2] || 1000;
    const srcH = hgt?.n || vb[3] || 1000;
    const scale = MAX_SIDE / Math.max(srcW, srcH);
    const cw = Math.round(srcW * scale);
    const ch = Math.round(srcH * scale);
    root.setAttribute("width", cw);
    root.setAttribute("height", ch);
    if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${srcW} ${srcH}`);
    const blob = new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("That SVG couldn't be drawn. Try exporting it again as plain SVG."));
        im.src = url;
      });
      const canvas = Object.assign(document.createElement("canvas"), { width: cw, height: ch });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      return { canvas, mmPerPx: w?.mm ? w.mm / cw : null, kind: "svg" };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("That file couldn't be opened as an image. Use a JPG, PNG, WebP or SVG.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return { canvas, mmPerPx: null, kind: "photo" };
}

// ------------------------------------------------------------ page
export function tokenInsertPage() {
  const saved = load();
  const state = {
    settings: { ...TOKEN_INSERT_DEFAULTS, ...(saved?.settings || {}) },
    trace: { threshold: null, ignoreShadows: true, referenceId: null, includeEdge: [], strokes: [], ...(saved?.trace || {}) },
    tokens: saved?.tokens || [],
    items: saved?.items || [],
    nextUid: saved?.nextUid || 1,
    fileName: saved?.fileName || null,
  };
  let photo = null; // { canvas, mmPerPx, kind }
  let result = null; // last trace result
  let tab = state.tokens.length ? "layout" : "photo";
  let brush = { mode: "off", size: 24 };
  let selected = null; // layout item key
  let version = 0; // bumps on any change that affects the 3D model
  let builtVersion = -1;
  let viewer = null;

  const persist = debounce(() => save({ settings: state.settings, trace: { ...state.trace, strokes: [] }, tokens: state.tokens, items: state.items, nextUid: state.nextUid, fileName: state.fileName }), 400);
  const changed = (rebuild = true) => {
    if (rebuild) version++;
    persist();
    if (tab === "3d") schedule3d();
  };

  // ---------- elements
  const fileInput = h("input", { type: "file", accept: "image/*,.svg", hidden: true });
  const photoStatus = h("div.trace-status", { "aria-live": "polite" });
  const tokenList = h("div.token-list");
  const traySettings = h("div.form");
  const stageTabs = h("div.stage-tabs", { role: "tablist" });
  const photoView = h("div.photo-view");
  const photoCanvas = h("canvas");
  photoView.append(photoCanvas);
  const layoutView = h("div.layout-view");
  const layoutToolbar = h("div.layout-toolbar");
  const viewerHost = h("div.viewer");
  const status = h("div.status", { role: "status" });
  const threeView = h("div.three-view", viewerHost, status, h("button.view-reset", { type: "button", on: { click: () => viewer?.resetView() } }, "Reset view"));
  const views = { photo: photoView, layout: h("div.layout-wrap", layoutToolbar, layoutView), "3d": threeView };
  const viewHost = h("div.view-host");
  const summary = h("ul.summary", { "aria-live": "polite" });
  const notes = h("div.notes", { "aria-live": "polite" });
  const downloads = h("div.downloads");

  const page = h(
    "main.generator.insert-page",
    h(
      "section.panel",
      h("h1", "Token insert"),
      h("p.intro", "Photograph your tokens next to a 50 mm square, and get a tray with a pocket shaped like each one."),
      h(
        "section.step",
        h("h2", h("span.step-n", "1"), "Photo"),
        h(
          "div.upload-row",
          h("button.primary", { type: "button", on: { click: () => fileInput.click() } }, "Choose photo or SVG"),
          fileInput
        ),
        h(
          "details.tips",
          h("summary", "How to take the photo"),
          h(
            "ul",
            h("li", "Print or cut a 50 × 50 mm square and lay it next to the tokens. Its sides set the scale."),
            h("li", "Use plain paper that contrasts with the tokens: white for dark tokens, coloured for white or grey ones."),
            h("li", "Shoot straight down with a document scanner app, so the photo isn't tilted."),
            h("li", "Soft, even light (near a window, or overhead) keeps shadows faint. Leave a gap between tokens."),
            h("li", "No square? An SVG with real sizes (width in mm) works too, for example a silhouette from Gemini turned into an SVG.")
          )
        ),
        photoStatus,
        h("div.trace-controls")
      ),
      h("section.step", h("h2", h("span.step-n", "2"), "Tokens"), tokenList),
      h("section.step", h("h2", h("span.step-n", "3"), "Tray"), traySettings)
    ),
    h("section.stage", stageTabs, viewHost, h("div.below", summary, notes, downloads))
  );
  const traceControls = page.querySelector(".trace-controls");
  page.addEventListener("dragover", (e) => e.preventDefault());
  page.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  });
  fileInput.addEventListener("change", () => fileInput.files[0] && openFile(fileInput.files[0]));

  // ---------- photo + tracing
  async function openFile(file) {
    photoStatus.replaceChildren(h("p.note", `Opening ${file.name}…`));
    try {
      photo = await fileToCanvas(file);
      state.fileName = file.name;
      state.trace = { ...state.trace, referenceId: null, includeEdge: [], strokes: [], threshold: null };
      const ctx = photo.canvas.getContext("2d", { willReadFrequently: true });
      await setImage(ctx.getImageData(0, 0, photo.canvas.width, photo.canvas.height));
      setTab("photo");
      await retrace(true);
    } catch (err) {
      photoStatus.replaceChildren(h("p.error", err.message));
    }
  }

  const retrace = async (fresh = false) => {
    if (!photo) return;
    photoStatus.replaceChildren(h("p.note", "Tracing…"));
    try {
      const r = await traceImage({
        threshold: state.trace.threshold,
        ignoreShadows: state.trace.ignoreShadows,
        strokes: state.trace.strokes,
        referenceSize: state.settings.referenceSize,
        referenceId: state.trace.referenceId,
        includeEdge: state.trace.includeEdge,
        mmPerPx: photo.mmPerPx,
      });
      if (!r) return;
      result = r;
      mergeTokens(r.tokens, fresh);
      renderTraceControls();
      renderPhotoStatus();
      renderTokens();
      drawPhoto();
      if (needsArrange()) arrange();
      else renderLayout();
      changed();
    } catch (err) {
      photoStatus.replaceChildren(h("p.error", err.message));
    }
  };
  const retraceSoon = debounce(retrace, 250);

  /** Carry names and settings over to re-traced tokens by matching positions in the photo. */
  function mergeTokens(traced, fresh) {
    const prev = fresh ? [] : state.tokens;
    const reach = result ? Math.hypot(result.width, result.height) * 0.04 : Infinity;
    const used = new Set();
    const lastThickness = state.tokens.at(-1)?.thickness ?? 3;
    state.tokens = traced.map((t, i) => {
      let best = null;
      let bestD = reach;
      for (const p of prev) {
        if (used.has(p.uid) || !p.at) continue;
        const d = Math.hypot(p.at[0] - t.at[0], p.at[1] - t.at[1]);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        used.add(best.uid);
        return { ...best, points: t.points, w: t.w, h: t.h, area: t.area, at: t.at, colour: t.colour, traceId: t.id };
      }
      const uid = state.nextUid++;
      return { uid, id: uid, name: `Token ${i + 1}`, thickness: lastThickness, count: 1, stack: true, notch: true, include: true, points: t.points, w: t.w, h: t.h, area: t.area, at: t.at, colour: t.colour, traceId: t.id };
    });
    if (fresh) state.items = [];
  }

  const modelTokens = () => state.tokens.filter((t) => t.include !== false).map((t) => ({ ...t, id: t.uid }));
  const needsArrange = () => {
    const want = expandInstances(modelTokens()).map((i) => i.key).sort().join();
    const have = state.items.map((i) => i.key).sort().join();
    return want !== have;
  };
  function arrange() {
    const { items, missed } = autoPack(modelTokens(), state.settings);
    state.items = items;
    arrangeNote = missed.length ? `${missed.length} pocket${missed.length === 1 ? "" : "s"} didn't fit in a ${fmt(state.settings.width)} × ${fmt(state.settings.depth)} mm tray. Make the tray bigger, or switch to "Fit the tokens".` : "";
    renderLayout();
    changed();
  }
  let arrangeNote = "";

  function renderPhotoStatus() {
    const r = result;
    const out = [];
    if (r.calibration.ok && r.calibration.source === "square") {
      const [sx, sy] = r.calibration.sidePx;
      out.push(h("p.ok", `Found the ${fmt(state.settings.referenceSize, 0)} mm square (${fmt(sx, 0)} × ${fmt(sy, 0)} px), so 1 mm = ${fmt(1 / r.calibration.mmPerPxX, 2)} × ${fmt(1 / r.calibration.mmPerPxY, 2)} px.`));
    } else if (r.calibration.ok) {
      out.push(h("p.ok", `Scale taken from the SVG's size: 1 mm = ${fmt(1 / r.calibration.mmPerPxX, 2)} px.`));
    }
    for (const w of r.warnings) out.push(h("p.error", w));
    out.push(h("p.note", `${r.tokens.length} token${r.tokens.length === 1 ? "" : "s"} traced. Check the yellow outlines on the photo; use the brush below to fix any that are wrong.`));
    photoStatus.replaceChildren(...out);
  }

  function renderTraceControls() {
    const auto = state.trace.threshold == null;
    const value = state.trace.threshold ?? result?.autoThreshold ?? 12;
    const slider = h("input", { type: "range", min: 4, max: 60, step: 0.5, value, id: "thr" });
    const readout = h("span.readout", auto ? `auto (${fmt(value)})` : fmt(value));
    slider.addEventListener("input", () => {
      state.trace.threshold = parseFloat(slider.value);
      readout.textContent = fmt(state.trace.threshold);
      retraceSoon();
    });
    put(traceControls, 
      h(
        "div.field",
        h("label", { for: "thr" }, "Edge sensitivity ", readout),
        slider,
        h("p.hint", "Lower picks up fainter edges (and shadows); higher ignores more. ", auto ? null : h("button.quiet.inline", { type: "button", on: { click: () => { state.trace.threshold = null; retrace(); } } }, "Back to auto"))
      ),
      checkbox({ label: "Ignore shadows", checked: state.trace.ignoreShadows, onChange: (v) => { state.trace.ignoreShadows = v; retrace(); } }),
      numberField({ label: "Reference square", value: state.settings.referenceSize, hint: "Side length of the square in the photo.", onChange: (v) => { state.settings.referenceSize = v; retraceSoon(); } }),
      h(
        "div.field",
        h("span.label", "Touch up"),
        segmented({
          label: "Brush",
          value: brush.mode,
          options: [["off", "Off"], ["add", "Add"], ["erase", "Erase"]],
          onChange: (v) => {
            brush.mode = v;
            photoView.dataset.brush = v;
            if (v !== "off") setTab("photo");
          },
        }),
        h(
          "div.brush-row",
          h("label", { for: "brush" }, "Size"),
          (() => {
            const r = h("input", { type: "range", id: "brush", min: 4, max: 80, value: brush.size });
            r.addEventListener("input", () => (brush.size = +r.value));
            return r;
          })(),
          state.trace.strokes.length ? h("button.quiet.inline", { type: "button", on: { click: () => { state.trace.strokes = []; retrace(); } } }, `Undo all touch-ups (${state.trace.strokes.length})`) : null
        ),
        h("p.hint", "Paint on the photo: Add fills in part of a token the tracer missed, Erase removes shadows or specks.")
      )
    );
  }

  // Photo canvas: image, outlines, brush.
  let view = { k: 1, ox: 0, oy: 0 };
  function drawPhoto() {
    const ctx = photoCanvas.getContext("2d");
    const { clientWidth: cw, clientHeight: ch } = photoView;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    photoCanvas.width = Math.max(1, cw * dpr);
    photoCanvas.height = Math.max(1, ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#e8eeea";
    ctx.fillRect(0, 0, cw, ch);
    if (!photo) {
      ctx.fillStyle = "#4d5c56";
      ctx.font = "16px Atkinson Hyperlegible, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Choose a photo or SVG, or drop one here.", cw / 2, ch / 2);
      return;
    }
    const W = photo.canvas.width;
    const H = photo.canvas.height;
    const k = Math.min(cw / W, ch / H) * 0.96;
    view = { k, ox: (cw - W * k) / 2, oy: (ch - H * k) / 2 };
    ctx.drawImage(photo.canvas, view.ox, view.oy, W * k, H * k);
    if (!result) return;
    const tokenByTrace = new Map(state.tokens.map((t, i) => [t.traceId, { t, n: i + 1 }]));
    for (const s of result.shapes) {
      ctx.beginPath();
      s.display.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, view.ox + x * k, view.oy + y * k));
      ctx.closePath();
      const tok = tokenByTrace.get(s.id);
      ctx.setLineDash(s.skipped ? [6, 5] : []);
      ctx.lineWidth = s.isReference ? 3 : 2.5;
      ctx.strokeStyle = s.isReference ? "#1f6feb" : s.skipped ? "#8a9690" : tok?.t.include === false ? "#8a9690" : "#f2c230";
      ctx.fillStyle = s.isReference ? "rgba(31,111,235,0.12)" : "rgba(242,194,48,0.18)";
      if (!s.skipped) ctx.fill();
      ctx.stroke();
      const label = s.isReference ? `${fmt(state.settings.referenceSize, 0)} mm` : tok ? String(tok.n) : null;
      if (label) {
        const [cx, cy] = s.at;
        ctx.font = "bold 14px Atkinson Hyperlegible, system-ui, sans-serif";
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = s.isReference ? "#1f6feb" : "#18221e";
        ctx.fillRect(view.ox + cx * k - tw / 2, view.oy + cy * k - 11, tw, 22);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, view.ox + cx * k, view.oy + cy * k + 1);
      }
    }
    ctx.setLineDash([]);
    if (result.calibration.corners) {
      ctx.fillStyle = "#1f6feb";
      for (const [x, y] of result.calibration.corners) {
        ctx.beginPath();
        ctx.arc(view.ox + x * k, view.oy + y * k, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
  let stroke = null;
  const toImage = (e) => {
    const r = photoCanvas.getBoundingClientRect();
    return [(e.clientX - r.left - view.ox) / view.k, (e.clientY - r.top - view.oy) / view.k];
  };
  photoCanvas.addEventListener("pointerdown", (e) => {
    if (!photo || brush.mode === "off") return;
    photoCanvas.setPointerCapture(e.pointerId);
    stroke = { mode: brush.mode, radius: brush.size / 2 / view.k, points: [toImage(e)] };
    paintPreview();
  });
  photoCanvas.addEventListener("pointermove", (e) => {
    if (!stroke) return;
    stroke.points.push(toImage(e));
    paintPreview();
  });
  const endStroke = () => {
    if (!stroke) return;
    state.trace.strokes = [...state.trace.strokes, stroke];
    stroke = null;
    retrace();
  };
  photoCanvas.addEventListener("pointerup", endStroke);
  photoCanvas.addEventListener("pointercancel", endStroke);
  function paintPreview() {
    const ctx = photoCanvas.getContext("2d");
    ctx.strokeStyle = stroke.mode === "erase" ? "rgba(179,38,30,0.6)" : "rgba(31,111,235,0.6)";
    ctx.lineWidth = brush.size;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    stroke.points.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, view.ox + x * view.k, view.oy + y * view.k));
    if (stroke.points.length === 1) ctx.lineTo(view.ox + stroke.points[0][0] * view.k + 0.1, view.oy + stroke.points[0][1] * view.k);
    ctx.stroke();
  }

  // ---------- token list
  /**
   * Pocket depth override. Blank = automatic (thickness × stack + extra
   * depth), shown as the placeholder so you can see what you'd replace.
   */
  const autoDepthText = (t) => `auto ${fmt(pocketDepth({ ...t, depth: 0 }, { ...state.settings, inlay: false }))}`;
  /** Refresh every "auto" depth hint (after thickness, count or extra depth change). */
  const refreshDepthHints = () => {
    for (const t of state.tokens) {
      const inp = tokenList.querySelector(`#t${t.uid}-depth`);
      if (inp) inp.placeholder = autoDepthText(t);
    }
  };
  function depthField(t, set) {
    const id = `t${t.uid}-depth`;
    const inp = h("input", { id, type: "number", inputmode: "decimal", step: 0.1, min: 0.3, value: t.depth > 0 ? t.depth : "", placeholder: autoDepthText(t) });
    inp.addEventListener("input", () => {
      const v = parseFloat(inp.value);
      if (inp.value.trim() === "") set({ depth: null });
      else if (Number.isFinite(v) && v >= 0.3) set({ depth: v });
    });
    return h("div.field.mini", h("label", { for: id }, "Pocket depth"), h("div.input-unit", inp, h("span.unit", "mm")));
  }

  function renderTokens() {
    if (!state.tokens.length) {
      tokenList.replaceChildren(h("p.hint", "Traced tokens appear here. Give each one a name and its thickness."));
      return;
    }
    const rows = state.tokens.map((t, i) => {
      const set = (patch, layoutChange = false) => {
        Object.assign(t, patch);
        refreshDepthHints();
        if (layoutChange && needsArrange()) arrange();
        else renderLayout();
        drawPhoto();
        changed();
      };
      const name = h("input", { type: "text", value: t.name, "aria-label": `Token ${i + 1} name` });
      name.addEventListener("input", () => set({ name: name.value }));
      // `event`: "input" updates as you type; "change" waits until the field is
      // done (used where the list has to redraw, so typing isn't interrupted).
      const num = (label, value, step, min, onChange, unit = "mm", event = "input") => {
        const id = `t${t.uid}-${label}`;
        const inp = h("input", { id, type: "number", inputmode: "decimal", value, step, min });
        inp.addEventListener(event, () => {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v) && v >= min) onChange(v);
        });
        return h("div.field.mini", h("label", { for: id }, label), h("div.input-unit", inp, unit ? h("span.unit", unit) : null));
      };
      return h(
        "div.token-row",
        { class: t.include === false ? "excluded" : "" },
        h(
          "div.token-head",
          h("span.swatch", { style: `background:${rgb(t.colour || [128, 128, 128])}` }, String(i + 1)),
          name,
          h("span.dims", `${fmt(t.w)} × ${fmt(t.h)} mm`)
        ),
        t.include === false
          ? null
          : h(
              "div.token-fields",
              num("Thickness", t.thickness, 0.1, 0.3, (v) => set({ thickness: v })),
              num("How many", t.count, 1, 1, (v) => { set({ count: Math.round(v) }, true); renderTokens(); }, "", "change"),
              t.count > 1 ? checkbox({ label: "Stack in one pocket", checked: t.stack !== false, onChange: (v) => set({ stack: v }, true) }) : null,
              depthField(t, set),
              checkbox({ label: "Finger notch", checked: t.notch !== false, onChange: (v) => set({ notch: v }, true) })
            ),
        h(
          "div.token-actions",
          h("button.quiet.inline", { type: "button", on: { click: () => set({ include: t.include === false }, true) } }, t.include === false ? "Use this token" : "Leave out"),
          h("button.quiet.inline", { type: "button", on: { click: () => { state.trace.referenceId = t.traceId; retrace(); } } }, "This is the square")
        )
      );
    });
    const skipped = (result?.shapes || []).filter((s) => s.skipped === "touches the edge of the photo");
    tokenList.replaceChildren(
      ...rows.filter(Boolean),
      ...[skipped.length
        ? h(
            "p.hint",
            `${skipped.length} shape${skipped.length === 1 ? " touches" : "s touch"} the edge of the photo and ${skipped.length === 1 ? "was" : "were"} left out. `,
            h("button.quiet.inline", { type: "button", on: { click: () => { state.trace.includeEdge = [...state.trace.includeEdge, ...skipped.map((s) => s.id)]; retrace(); } } }, "Use them")
          )
        : null].filter(Boolean)
    );
  }

  // ---------- tray settings
  function renderTraySettings() {
    const s = state.settings;
    const up = (patch, { relayout = false, rerender = false } = {}) => {
      Object.assign(s, patch);
      if (rerender) renderTraySettings();
      if (relayout) arrange();
      else renderLayout();
      changed();
    };
    put(traySettings, 
      segmented({ label: "Tray size", value: s.sizeMode, options: [["fit", "Fit the tokens"], ["set", "Set size"]], onChange: (v) => up({ sizeMode: v }, { relayout: true, rerender: true }) }),
      s.sizeMode === "set"
        ? h(
            "div.field-row",
            numberField({ label: "Width", value: s.width, onChange: (v) => up({ width: v }) }),
            numberField({ label: "Depth", value: s.depth, onChange: (v) => up({ depth: v }) })
          )
        : null,
      segmented({ label: "Height", value: s.heightMode, options: [["auto", "Deepest pocket + floor"], ["set", "Set height"]], onChange: (v) => up({ heightMode: v }, { rerender: true }) }),
      s.heightMode === "set" ? numberField({ label: "Tray height", value: s.height, onChange: (v) => up({ height: v }) }) : null,
      h("button", { type: "button", on: { click: () => arrange() } }, "Auto-arrange pockets"),
      checkbox({ label: "Finger notches", checked: s.notch, onChange: (v) => up({ notch: v }, { relayout: true }) }),
      checkbox({ label: "Lift cutouts", checked: s.lift, onChange: (v) => up({ lift: v }, { rerender: true }) }),
      s.lift
        ? h(
            "div.subfields",
            h("p.hint", "Round bites in the tray sides, so you can get your fingers down beside the insert and lift it out of the game box."),
            segmented({ label: "Sides", value: s.liftSides, options: [["long", "Long sides"], ["short", "Short sides"], ["all", "All four"]], onChange: (v) => up({ liftSides: v }) }),
            h(
              "div.field-row",
              numberField({ label: "Width", value: s.liftWidth, onChange: (v) => up({ liftWidth: v }) }),
              numberField({ label: "Depth", value: s.liftDepth, hint: "How far it bites in. Shallower where pockets are in the way.", onChange: (v) => up({ liftDepth: v }) })
            )
          )
        : null,
      checkbox({ label: "Coloured floor inlays", checked: s.inlay, onChange: (v) => up({ inlay: v }, { rerender: true }) }),
      s.inlay ? h("p.hint", "Thin plates for the pocket floors, printed in a bright colour, so an empty pocket stands out. The pockets get deeper by the inlay thickness.") : null,
      h(
        "details.advanced",
        h("summary", "Fit and print settings"),
        numberField({ label: "Clearance", value: s.clearance, step: 0.05, hint: "Added all round each token. 0.25 mm suits most printers.", onChange: (v) => up({ clearance: v }) }),
        numberField({ label: "Wall between pockets", value: s.gap, onChange: (v) => up({ gap: v }) }),
        numberField({ label: "Outer wall", value: s.border, onChange: (v) => up({ border: v }) }),
        numberField({ label: "Floor", value: s.floor, onChange: (v) => up({ floor: v }) }),
        numberField({ label: "Extra pocket depth", value: s.extraDepth, step: 0.1, hint: "Pockets this much deeper than the tokens.", onChange: (v) => { up({ extraDepth: v }); refreshDepthHints(); } }),
        numberField({ label: "Finger notch size", value: s.notchDiameter, hint: "0 = automatic (60% of the token, 10–20 mm).", onChange: (v) => up({ notchDiameter: v }, { relayout: true }) }),
        s.inlay ? numberField({ label: "Inlay thickness", value: s.inlayThickness, step: 0.1, onChange: (v) => up({ inlayThickness: v }) }) : null,
        numberField({ label: "Tray edge rounding", value: s.rounding, step: 0.1, onChange: (v) => up({ rounding: v }) })
      )
    );
  }

  // ---------- layout editor
  let A = null; // last analysis
  function renderLayout() {
    const tokens = modelTokens();
    if (!tokens.length || !state.items.length) {
      A = null;
      layoutView.replaceChildren(h("p.empty", "Trace some tokens first. Their pockets will appear here."));
      put(layoutToolbar, );
      renderSummary();
      return;
    }
    A = analyse(tokens, state.items, state.settings);
    const byId = new Map(tokens.map((t) => [t.uid, t]));
    const numberOf = new Map(state.tokens.map((t, i) => [t.uid, i + 1]));
    const { tray } = A;
    const pad = 6;
    // While dragging, keep the view still (in "fit" mode the tray resizes as you drag).
    const box = drag?.viewBox ?? `${tray.x0 - pad} ${-(tray.y0 + tray.h) - pad} ${tray.w + 2 * pad} ${tray.h + 2 * pad}`;
    if (drag && !drag.viewBox) drag.viewBox = box;
    const root = svg("svg", {
      viewBox: box,
      role: "img",
      "aria-label": `Tray layout, ${fmt(tray.w)} by ${fmt(tray.h)} mm`,
    });
    const g = svg("g", { transform: "scale(1,-1)" });
    const trayRect = svg("rect", { x: tray.x0, y: tray.y0, width: tray.w, height: tray.h, rx: state.settings.corner, class: "tray" });
    if (A.lifts.length) {
      // Lift cutouts: bites masked out of the tray, outlined where they cut.
      const mask = svg("mask", { id: "lift-mask", maskUnits: "userSpaceOnUse", x: tray.x0 - 50, y: tray.y0 - 50, width: tray.w + 100, height: tray.h + 100 }, svg("rect", { x: tray.x0 - 50, y: tray.y0 - 50, width: tray.w + 100, height: tray.h + 100, fill: "#fff" }), ...A.lifts.map((c) => svg("circle", { cx: c.cx, cy: c.cy, r: c.r, fill: "#000" })));
      const clip = svg("clipPath", { id: "lift-clip" }, svg("rect", { x: tray.x0, y: tray.y0, width: tray.w, height: tray.h, rx: state.settings.corner }));
      trayRect.setAttribute("mask", "url(#lift-mask)");
      g.append(svg("defs", {}, mask, clip), trayRect, svg("g", { "clip-path": "url(#lift-clip)" }, ...A.lifts.map((c) => svg("circle", { cx: c.cx, cy: c.cy, r: c.r, class: "lift" }))));
    } else g.append(trayRect);
    for (const it of state.items) {
      const t = byId.get(it.tokenId);
      if (!t) continue;
      const poly = placed(t, it);
      const n = A.notches.get(it.key);
      const bad = A.bad.has(it.key);
      const grp = svg(
        "g",
        { class: `pocket${bad ? " bad" : ""}${selected === it.key ? " selected" : ""}`, "data-key": it.key, tabindex: 0, role: "button", "aria-label": `${t.name}, pocket ${it.key}` },
        n ? svg("circle", { cx: n.x, cy: n.y, r: n.r, class: "notch" }) : null,
        svg("path", { d: toPath(poly), class: "clear", "stroke-width": 2 * state.settings.clearance }),
        svg("path", { d: toPath(poly), class: "token", style: `fill:${rgb(t.colour || [200, 200, 200])}` }),
        svg("text", { x: it.x, y: -it.y, transform: "scale(1,-1)", class: "label" }, String(numberOf.get(t.uid)))
      );
      g.append(grp);
    }
    root.append(g);
    layoutView.replaceChildren(root);
    renderToolbar();
    renderSummary();
  }

  // Dragging pockets.
  let drag = null;
  layoutView.addEventListener("pointerdown", (e) => {
    const grp = e.target.closest?.("g.pocket");
    if (!grp) {
      if (selected) {
        selected = null;
        renderLayout();
      }
      return;
    }
    const key = grp.dataset.key;
    const item = state.items.find((i) => i.key === key);
    // Screen → mm, always against the SVG currently on screen.
    const toMm = (ev) => {
      const root = layoutView.querySelector("svg");
      const pt = root.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const p = pt.matrixTransform(root.getScreenCTM().inverse());
      return [p.x, -p.y];
    };
    selected = key;
    const viewBox = layoutView.querySelector("svg").getAttribute("viewBox");
    drag = { key, item, start: toMm(e), from: [item.x, item.y], toMm, moved: false, viewBox };
    layoutView.setPointerCapture(e.pointerId);
    renderLayout();
  });
  layoutView.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = drag.toMm(e);
    drag.item.x = drag.from[0] + x - drag.start[0];
    drag.item.y = drag.from[1] + y - drag.start[1];
    drag.moved = true;
    requestRender();
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) changed();
    renderLayout();
  };
  layoutView.addEventListener("pointerup", endDrag);
  layoutView.addEventListener("pointercancel", endDrag);
  let raf = 0;
  const requestRender = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderLayout();
    });
  };
  layoutView.addEventListener("keydown", (e) => {
    const grp = e.target.closest?.("g.pocket");
    if (!grp) return;
    selected = grp.dataset.key;
    const step = e.shiftKey ? 5 : 0.5;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      const it = state.items.find((i) => i.key === selected);
      it.x += moves[e.key][0];
      it.y += moves[e.key][1];
      changed();
      renderLayout();
      layoutView.querySelector(`g[data-key="${CSS.escape(selected)}"]`)?.focus();
    } else if (e.key === "[" || e.key === "]") rotateSelected(e.key === "[" ? 15 : -15);
    else if (e.key.toLowerCase() === "n") moveNotch();
  });

  function rotateSelected(deg) {
    const it = state.items.find((i) => i.key === selected);
    if (!it) return;
    it.angle = (((it.angle + deg) % 360) + 360) % 360;
    changed();
    renderLayout();
  }
  function moveNotch() {
    const it = state.items.find((i) => i.key === selected);
    if (!it) return;
    it.notch = (it.notch ?? 0) + 1;
    changed();
    renderLayout();
  }
  function renderToolbar() {
    const it = state.items.find((i) => i.key === selected);
    const t = it && state.tokens.find((k) => k.uid === it.tokenId);
    const n = it && A?.notches.get(it.key);
    put(layoutToolbar, 
      it
        ? h(
            "div.tools",
            h("strong", t?.name ?? "Pocket"),
            h("button", { type: "button", on: { click: () => rotateSelected(15) } }, "Rotate left"),
            h("button", { type: "button", on: { click: () => rotateSelected(-15) } }, "Rotate right"),
            h("button", { type: "button", on: { click: () => rotateSelected(90) } }, "Turn 90°"),
            n && n.options > 1 ? h("button", { type: "button", on: { click: moveNotch } }, "Move finger notch") : null
          )
        : h("p.hint", "Drag pockets to move them. Click one to rotate it or move its finger notch. Arrow keys nudge, [ and ] rotate.")
    );
  }

  function renderSummary() {
    const out = [];
    const problems = [];
    if (A) {
      out.push(h("li", `Tray ${fmt(A.tray.w)} × ${fmt(A.tray.h)} mm`));
      if (A.bad.size) problems.push(h("p.error", `${A.bad.size} pocket${A.bad.size === 1 ? " is" : "s are"} too close to another pocket or outside the tray (shown in red). Drag ${A.bad.size === 1 ? "it" : "them"} or use Auto-arrange.`));
      const noNotch = [...A.notches.values()].filter((n) => n === null).length;
      if (noNotch) problems.push(h("p.note", `${noNotch} pocket${noNotch === 1 ? " has" : "s have"} no room for a finger notch. Drag ${noNotch === 1 ? "it" : "them"} away from the others, or use Auto-arrange.`));
      if (A.liftGrown > 0) problems.push(h("p.note", `The tray is ${fmt(A.liftGrown)} mm bigger to make room for the lift cutouts.`));
      const want = Math.min(state.settings.liftDepth, state.settings.liftWidth / 2);
      const shallow = A.lifts.filter((c) => c.depth < want - 1e-6);
      if (shallow.length) problems.push(h("p.note", `Lift cutout on the ${shallow.map((c) => c.side).join(" and ")} is only ${shallow.map((c) => fmt(c.depth)).join(" / ")} mm deep: pockets are in the way.`));
      for (const m of A.liftMissing) problems.push(h("p.note", m.reason === "side too short" ? `No lift cutout on the ${m.side}: that side is too short for a ${fmt(state.settings.liftWidth)} mm cutout.` : `No room for a lift cutout on the ${m.side}. Drag pockets away from that side, or make the tray bigger.`));
    }
    if (arrangeNote) problems.push(h("p.error", arrangeNote));
    if (tab !== "3d" || builtVersion !== version) summary.replaceChildren(...out);
    notes.replaceChildren(...problems);
    renderDownloads();
  }

  // ---------- 3D
  const schedule3d = debounce(() => build3d(), 500);
  async function build3d() {
    if (!A || A.bad.size) {
      status.textContent = A ? "Fix the red pockets to build" : "Nothing to build yet";
      status.dataset.state = A ? "error" : "";
      return false;
    }
    if (builtVersion === version) return true;
    const v = version;
    status.textContent = "Building…";
    status.dataset.state = "busy";
    try {
      const r = await build("token-insert", { tokens: modelTokens(), items: state.items, settings: state.settings });
      if (!r) return false;
      if (!viewer) viewer = new Viewer(viewerHost);
      viewer.show(r.meshes);
      builtVersion = v;
      summary.replaceChildren(...r.summary.map((l) => h("li", l)));
      notes.replaceChildren(...r.warnings.map((w) => h("p.note", w)));
      status.textContent = `Built in ${(r.ms / 1000).toFixed(1)} s`;
      status.dataset.state = "ok";
      renderDownloads();
      return builtVersion === version;
    } catch (err) {
      status.textContent = "Couldn't build this insert";
      status.dataset.state = "error";
      notes.replaceChildren(h("p.error", err.message));
      return false;
    }
  }

  // ---------- downloads
  function renderDownloads() {
    const ready = A && !A.bad.size;
    const btn = (label, fn, primary = false) =>
      h(
        `button${primary ? ".primary" : ""}`,
        {
          type: "button",
          disabled: !ready,
          on: {
            click: async (e) => {
              const b = e.currentTarget;
              const old = b.textContent;
              b.disabled = true;
              b.textContent = "Preparing…";
              try {
                await fn();
                b.textContent = "Downloaded";
              } catch (err) {
                b.textContent = `Failed: ${err.message}`;
              }
              setTimeout(() => {
                b.textContent = old;
                b.disabled = false;
              }, 2000);
            },
          },
        },
        label
      );
    const model = async (part, format) => {
      if (!(await build3d())) throw new Error("build the insert first");
      await exportPart(part, format);
    };
    const parts = state.settings.inlay ? ["tray", "inlays"] : ["tray"];
    put(downloads, 
      h("h2", "Download"),
      h("div.download-row", ...parts.map((p) => btn(`${p[0].toUpperCase() + p.slice(1)} (STL)`, () => model(p, "stl"), true))),
      h("div.download-row", btn("All parts (STEP)", () => model("all", "step")), btn("Outlines (SVG)", downloadSvg)),
      h(
        "div.download-row",
        h("button.quiet", { type: "button", on: { click: saveProject } }, "Save project"),
        h("button.quiet", { type: "button", on: { click: openProject } }, "Open project")
      )
    );
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  /** Tray outline, pockets (with clearance and notch) and the traced tokens, in mm. */
  async function downloadSvg() {
    const tokens = modelTokens();
    const byId = new Map(tokens.map((t) => [t.uid, t]));
    const { tray } = A;
    const tx = ([x, y]) => [x - tray.x0, tray.h - (y - tray.y0)];
    const pockets = [];
    const outlines = [];
    for (const it of state.items) {
      const t = byId.get(it.tokenId);
      const pts = placed(t, it);
      const n = A.notches.get(it.key);
      pockets.push(toPath(pocketOutline(pts, { grow: state.settings.clearance, notch: n, round: n ? 1.5 : 0 }).map(tx)));
      outlines.push(toPath(pts.map(tx)));
    }
    const W = fmt(tray.w, 3);
    const H = fmt(tray.h, 3);
    const lifts = A.lifts.map((c) => { const [x, y] = tx([c.cx, c.cy]); return `\n    <circle cx="${fmt(x, 3)}" cy="${fmt(y, 3)}" r="${fmt(c.r, 3)}"/>`; }).join("");
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
  <g id="tray" fill="none" stroke="#000" stroke-width="0.2"><rect x="0" y="0" width="${W}" height="${H}" rx="${state.settings.corner}"/></g>
${lifts ? `  <g id="lift-cutouts" fill="none" stroke="#080" stroke-width="0.2">${lifts}\n  </g>\n` : ""}  <g id="pockets" fill="none" stroke="#c00" stroke-width="0.2">${pockets.map((d) => `\n    <path d="${d}"/>`).join("")}
  </g>
  <g id="tokens" fill="none" stroke="#06c" stroke-width="0.1">${outlines.map((d) => `\n    <path d="${d}"/>`).join("")}
  </g>
</svg>
`;
    saveBlob(new Blob([text], { type: "image/svg+xml" }), "token-insert-outlines.svg");
  }
  function saveProject() {
    const data = { app: "box-forge", kind: "token-insert", version: 1, settings: state.settings, tokens: state.tokens, items: state.items, nextUid: state.nextUid, fileName: state.fileName };
    saveBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), "token-insert.json");
  }
  function openProject() {
    const inp = h("input", { type: "file", accept: ".json,application/json" });
    inp.addEventListener("change", async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        if (data.kind !== "token-insert") throw new Error("That isn't a Box Forge token insert project.");
        Object.assign(state, { settings: { ...TOKEN_INSERT_DEFAULTS, ...data.settings }, tokens: data.tokens, items: data.items, nextUid: data.nextUid, fileName: data.fileName });
        photo = null;
        result = null;
        renderAll();
        setTab("layout");
        changed();
      } catch (err) {
        notes.replaceChildren(h("p.error", err.message));
      }
    });
    inp.click();
  }

  // ---------- tabs
  function setTab(name) {
    tab = name;
    stageTabs.replaceChildren(
      ...[["photo", "Photo"], ["layout", "Layout"], ["3d", "3D preview"]].map(([k, label]) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(k === tab), on: { click: () => setTab(k) } }, label)
      )
    );
    viewHost.replaceChildren(views[tab]);
    if (tab === "photo") requestAnimationFrame(drawPhoto);
    if (tab === "3d") {
      if (!viewer) viewer = new Viewer(viewerHost);
      build3d();
    }
    renderSummary();
  }

  function renderAll() {
    renderTokens();
    renderTraySettings();
    renderLayout();
    if (result) {
      renderTraceControls();
      renderPhotoStatus();
    } else if (state.tokens.length) {
      photoStatus.replaceChildren(h("p.note", `${state.tokens.length} token${state.tokens.length === 1 ? "" : "s"} from ${state.fileName ?? "your last photo"}. Upload the photo again to re-trace or touch up.`));
    }
  }

  const resize = new ResizeObserver(() => tab === "photo" && drawPhoto());
  resize.observe(photoView);
  renderAll();
  photoView.dataset.brush = brush.mode;
  setTab(tab);
  page.dispose = () => {
    resize.disconnect();
    viewer?.dispose();
  };
  return page;
}
