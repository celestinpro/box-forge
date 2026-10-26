import { h, numberField } from "./dom.js";

/** Settings shown when the sliding lid is selected. */
export function slidingFields(params, update) {
  return h(
    "div.subfields",
    h("p.hint", "The lid slides in from the front along grooves in the side walls, sits flush with the top, and clicks shut. The front wall's top is open so the lid can pass."),
    numberField({ label: "Lid thickness", value: params.slideThickness, hint: "2 to 6 mm. Thicker lids are stiffer and have deeper grooves.", onChange: (v) => update({ slideThickness: v }) }),
    numberField({ label: "Lid clearance", value: params.slideClearance, step: 0.02, hint: "Gap per side in the grooves. Raise it if the lid binds, lower it if it rattles.", onChange: (v) => update({ slideClearance: v }) })
  );
}
