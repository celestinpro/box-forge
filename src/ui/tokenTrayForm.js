import { h, numberField, checkbox } from "./dom.js";

export function tokenTrayForm(params, update) {
  return h(
    "div.form",
    h(
      "fieldset.pocket",
      h("legend", "Outside size"),
      h(
        "div.field-row",
        numberField({ label: "Width", value: params.width, onChange: (v) => update({ width: v }) }),
        numberField({ label: "Depth", value: params.depth, onChange: (v) => update({ depth: v }) })
      ),
      numberField({ label: "Height", value: params.height, onChange: (v) => update({ height: v }) })
    ),
    h(
      "fieldset.pocket",
      h("legend", "Compartments"),
      h(
        "div.field-row",
        numberField({ label: "Across", value: params.columns, unit: "", step: 1, min: 1, max: 12, onChange: (v) => update({ columns: Math.round(v) }) }),
        numberField({ label: "Deep", value: params.rows, unit: "", step: 1, min: 1, max: 12, onChange: (v) => update({ rows: Math.round(v) }) })
      ),
      numberField({ label: "Scoop radius", value: params.scoop, hint: "Curved floor so tokens slide out. 0 for a flat floor.", onChange: (v) => update({ scoop: v }) })
    ),
    checkbox({ label: "Add a slide-over lid", checked: params.lid, onChange: (v) => update({ lid: v }) }),
    h(
      "details.advanced",
      h("summary", "Fit and print settings"),
      numberField({ label: "Wall thickness", value: params.wallThickness, onChange: (v) => update({ wallThickness: v }) }),
      numberField({ label: "Floor thickness", value: params.floorThickness, onChange: (v) => update({ floorThickness: v }) }),
      numberField({ label: "Outside corner radius", value: params.cornerRadius, onChange: (v) => update({ cornerRadius: v }) }),
      numberField({ label: "Lid clearance", value: params.lidTolerance, hint: "Increase if the lid is too tight on your printer.", onChange: (v) => update({ lidTolerance: v }) })
    )
  );
}
