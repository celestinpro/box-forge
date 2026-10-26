import { h, numberField } from "./dom.js";

/** Settings shown when a snap-fit lid is selected. */
export function snapFields(params, update) {
  return h(
    "div.subfields",
    h("p.hint", "The lid's rim slides over a collar at the top of the box and clicks onto a small ridge. The outside stays flush and the inside keeps its full size."),
    numberField({ label: "Collar height", value: params.snapCollar, hint: "How far the lid overlaps the box.", onChange: (v) => update({ snapCollar: v }) }),
    numberField({ label: "Lid rim thickness", value: params.snapBelt, hint: "The box steps out by this much below the collar so the lid sits flush.", onChange: (v) => update({ snapBelt: v }) }),
    numberField({ label: "Snap clearance", value: params.snapClearance, step: 0.05, hint: "Gap per side between lid and collar. Raise it if the lid is too hard to close, lower it if it's loose.", onChange: (v) => update({ snapClearance: v }) })
  );
}
