// Shared shell for every generator: settings panel on the left, 3D preview
// and downloads on the right. Each generator supplies its own form.
import { h, debounce } from "./dom.js";
import { Viewer } from "../viewer.js";
import { build, exportPart } from "../cad/client.js";
import { readState, writeState } from "./state.js";

/**
 * @param {object} opts
 * @param {string} opts.model   key in MODELS
 * @param {string} opts.title
 * @param {string} opts.intro
 * @param {object} opts.defaults
 * @param {(params, update) => Node} opts.form  renders the settings; call update(patch) on change
 */
export function generatorPage({ model, title, intro, defaults, form }) {
  let params = structuredClone({ ...defaults, ...readState(model) });

  const formHost = h("div.form-host");
  const summary = h("ul.summary", { "aria-live": "polite" });
  const notes = h("div.notes", { "aria-live": "polite" });
  const downloads = h("div.downloads");
  const status = h("div.status", { role: "status" }, "Loading the 3D engine…");
  const viewerHost = h("div.viewer");
  const viewer = new Viewer(viewerHost);

  const page = h(
    "main.generator",
    h(
      "section.panel",
      h("h1", title),
      h("p.intro", intro),
      formHost,
      h(
        "div.panel-actions",
        h("button.quiet", { type: "button", on: { click: share } }, "Copy link to these settings"),
        h("button.quiet", { type: "button", on: { click: reset } }, "Reset to defaults")
      )
    ),
    h(
      "section.stage",
      h("div.viewer-wrap", viewerHost, status, h("button.view-reset", { type: "button", on: { click: () => viewer.resetView() } }, "Reset view")),
      h("div.below", summary, notes, downloads)
    )
  );

  function renderForm() {
    formHost.replaceChildren(form(params, update, renderForm));
  }

  const rebuild = debounce(async () => {
    status.textContent = "Building…";
    status.dataset.state = "busy";
    try {
      const r = await build(model, params);
      if (!r) return; // superseded by a newer build
      viewer.show(r.meshes);
      summary.replaceChildren(...r.summary.map((l) => h("li", l)));
      notes.replaceChildren(
        ...r.warnings.map((w) => h("p.note", w))
      );
      renderDownloads(r.meshes.map((m) => m.name));
      status.textContent = `Built in ${(r.ms / 1000).toFixed(1)} s`;
      status.dataset.state = "ok";
      page.classList.remove("has-error");
    } catch (err) {
      status.textContent = "Couldn't build this box";
      status.dataset.state = "error";
      notes.replaceChildren(
        h("p.error", err.message),
        h("p.note", "The preview shows the last box that worked. Fix the setting named above, or reset to defaults and change one thing at a time.")
      );
      page.classList.add("has-error");
    }
  }, 250);

  function update(patch) {
    params = { ...params, ...patch };
    writeState(model, params, defaults);
    rebuild();
  }

  function renderDownloads(names) {
    const btn = (label, part, format) =>
      h(
        "button",
        {
          type: "button",
          on: {
            click: async (e) => {
              const b = e.currentTarget;
              b.disabled = true;
              const old = b.textContent;
              b.textContent = "Preparing…";
              try {
                const file = await exportPart(part, format);
                b.textContent = `Downloaded ${file}`;
              } catch (err) {
                b.textContent = `Download failed: ${err.message}`;
              }
              setTimeout(() => {
                b.textContent = old;
                b.disabled = false;
              }, 2200);
            },
          },
        },
        label
      );
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    downloads.replaceChildren(
      h("h2", "Download"),
      h("div.download-row", ...names.map((n) => btn(`${cap(n)} (STL)`, n, "stl"))),
      h("div.download-row", btn(`All parts (STEP, for CAD editing)`, "all", "step"))
    );
  }

  async function share(e) {
    const b = e.currentTarget;
    const old = b.textContent;
    try {
      await navigator.clipboard.writeText(location.href);
      b.textContent = "Link copied";
    } catch {
      b.textContent = "Copy the address bar to share";
    }
    setTimeout(() => (b.textContent = old), 2000);
  }

  function reset() {
    params = structuredClone(defaults);
    writeState(model, params, defaults);
    renderForm();
    rebuild();
  }

  renderForm();
  rebuild();
  page.dispose = () => viewer.dispose();
  return page;
}
