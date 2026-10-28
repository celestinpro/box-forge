import { h, numberField, segmented } from "./dom.js";
import { slidingFields } from "./slidingFields.js";
import { sectionEditor } from "./sectionEditor.js";

export function tokenTrayForm(params, update, rerender) {
  // Keep a live copy so the section editor redraws as sizes change.
  const cur = { ...params };
  let editor = null;
  const up = (patch) => {
    Object.assign(cur, patch);
    update(patch);
    editor?.draw();
  };
  editor = sectionEditor(
    () => cur,
    (tree) => {
      const first = !cur.layout;
      up({ layout: tree });
      if (first) rerender(); // the even-grid fields now read "start again"
    }
  );
  const lidValue = params.lid === false ? "none" : params.lidStyle === "sliding" ? "sliding" : "cap";
  return h(
    "div.form",
    h(
      "fieldset.pocket",
      h("legend", "Outside size"),
      h(
        "div.field-row",
        numberField({ label: "Width", value: params.width, onChange: (v) => up({ width: v }) }),
        numberField({ label: "Depth", value: params.depth, onChange: (v) => up({ depth: v }) })
      ),
      numberField({ label: "Height", value: params.height, onChange: (v) => up({ height: v }) })
    ),
    h(
      "fieldset.pocket",
      h("legend", "Compartments"),
      h("p.hint", "Click a compartment to select it, then split, resize or remove it. Drag the walls between compartments to resize them (Shift for finer steps). The front of the tray is at the bottom."),
      editor.el,
      h(
        "details.grid-start",
        { open: !params.layout },
        h("summary", params.layout ? "Start again from an even grid" : "Even grid"),
        params.layout ? h("p.hint", "Changing these replaces your sections with an even grid.") : null,
        h(
          "div.field-row",
          numberField({ label: "Across", value: params.columns, unit: "", step: 1, min: 1, max: 12, onChange: (v) => up({ columns: Math.round(v), layout: null }) }),
          numberField({ label: "Deep", value: params.rows, unit: "", step: 1, min: 1, max: 12, onChange: (v) => up({ rows: Math.round(v), layout: null }) })
        )
      ),
      numberField({ label: "Scoop radius", value: params.scoop, hint: "Curved floor so tokens slide out. 0 for a flat floor.", onChange: (v) => up({ scoop: v }) })
    ),
    segmented({
      label: "Lid",
      value: lidValue,
      options: [["cap", "Cap"], ["sliding", "Sliding"], ["none", "None"]],
      onChange: (v) => {
        update(v === "none" ? { lid: false } : { lid: true, lidStyle: v });
        rerender();
      },
    }),
    lidValue === "sliding"
      ? slidingFields(params, update)
      : h("p.hint", { style: "margin-top:-8px" }, lidValue === "cap" ? "A cap that slides down over the whole tray." : "Just the tray."),
    h(
      "details.advanced",
      h("summary", "Fit and print settings"),
      numberField({ label: "Wall thickness", value: params.wallThickness, onChange: (v) => up({ wallThickness: v }) }),
      numberField({ label: "Floor thickness", value: params.floorThickness, onChange: (v) => update({ floorThickness: v }) }),
      numberField({ label: "Outside corner radius", value: params.cornerRadius, onChange: (v) => up({ cornerRadius: v }) }),
      numberField({ label: "Cap clearance", value: params.lidTolerance, hint: "Increase if the cap is too tight on your printer.", onChange: (v) => update({ lidTolerance: v }) })
    )
  );
}
