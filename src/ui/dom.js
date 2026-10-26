// Tiny DOM helpers so the UI can stay framework-free.

/** h("div.class#id", {attrs, on: {click}}, ...children) */
export function h(tag, props = {}, ...children) {
  if (props === null || typeof props !== "object" || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [, name = "div", rest = ""] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || "div");
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "class") el.className += " " + v;
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let uid = 0;
/** Numeric field with a label and a unit. */
export function numberField({ label, value, unit = "mm", step = 0.1, min, max, hint, onChange }) {
  const id = `f${++uid}`;
  const input = h("input", { id, type: "number", inputmode: "decimal", step, min, max, value });
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return h(
    "div.field",
    h("label", { for: id }, label),
    h("div.input-unit", input, unit ? h("span.unit", unit) : null),
    hint ? h("p.hint", hint) : null
  );
}

/** Row of mutually exclusive buttons. */
export function segmented({ label, options, value, onChange }) {
  const group = h("div.segmented", { role: "radiogroup", "aria-label": label });
  const buttons = options.map(([val, text]) => {
    const b = h("button", { type: "button", role: "radio", "aria-checked": String(val === value) }, text);
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      onChange(val);
    });
    return b;
  });
  group.append(...buttons);
  return h("div.field", h("span.label", label), group);
}

export function checkbox({ label, checked, onChange }) {
  const input = h("input", { type: "checkbox", checked });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label.check", input, h("span", label));
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
