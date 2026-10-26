import { h, numberField, segmented, checkbox } from "./dom.js";
import { CARD_PRESETS } from "../models/config.js";

function presetFor(p) {
  return CARD_PRESETS.find((c) => c.height === p.cardHeight && c.width === p.cardWidth)?.id ?? "custom";
}

export function cardTrayForm(params, update, rerender) {
  const set = (patch, redraw = false) => {
    Object.assign(params, patch);
    update(patch);
    if (redraw) rerender();
  };

  const preset = h(
    "select",
    { "aria-label": "Card type" },
    ...CARD_PRESETS.map((c) => h("option", { value: c.id }, `${c.name} (${c.height} × ${c.width})`)),
    h("option", { value: "custom" }, "Custom size")
  );
  preset.value = presetFor(params);
  preset.addEventListener("change", () => {
    const c = CARD_PRESETS.find((x) => x.id === preset.value);
    if (c) set({ cardHeight: c.height, cardWidth: c.width }, true);
  });

  const fixed = params.dividers === "fixed";

  return h(
    "div.form",
    h(
      "fieldset.pocket",
      h("legend", "Cards"),
      h("div.field", h("span.label", "Card type"), preset),
      h(
        "div.field-row",
        numberField({ label: "Card height", value: params.cardHeight, onChange: (v) => { set({ cardHeight: v }); preset.value = presetFor(params); } }),
        numberField({ label: "Card width", value: params.cardWidth, onChange: (v) => { set({ cardWidth: v }); preset.value = presetFor(params); } })
      ),
      segmented({
        label: "Cards stand on their",
        value: params.standOn,
        options: [["long", "Long edge"], ["short", "Short edge"]],
        onChange: (v) => set({ standOn: v }),
      })
    ),

    h(
      "fieldset.pocket",
      h("legend", "Height"),
      segmented({
        label: "Set the",
        value: params.heightMode,
        options: [["height", "Tray height"], ["angle", "Lean angle"]],
        onChange: (v) => set({ heightMode: v }, true),
      }),
      params.heightMode === "angle"
        ? numberField({ label: "Lean angle", value: params.angle, unit: "°", step: 1, hint: "90° is upright. The height follows from the angle.", onChange: (v) => set({ angle: v }) })
        : numberField({ label: "Tray height", value: params.height, hint: "Use the space under your game box lid. The cards lean back to fit.", onChange: (v) => set({ height: v }) })
    ),

    h(
      "fieldset.pocket",
      h("legend", "Length"),
      fixed
        ? h("p.hint", "With fixed dividers, the length comes from the stack thicknesses below.")
        : segmented({
            label: "Size the tray to",
            value: params.lengthMode,
            options: [["space", "Fit a space"], ["cards", "Fit my cards"]],
            onChange: (v) => set({ lengthMode: v }, true),
          }),
      fixed
        ? null
        : params.lengthMode === "cards"
          ? numberField({ label: "Stack thickness", value: params.stackThickness, hint: "Measure the cards lying flat on a table.", onChange: (v) => set({ stackThickness: v }) })
          : numberField({ label: "Outside length", value: params.length, onChange: (v) => set({ length: v }) })
    ),

    h(
      "fieldset.pocket",
      h("legend", "Dividers"),
      segmented({
        label: "Dividers",
        value: params.dividers,
        options: [["none", "None"], ["removable", "Removable"], ["fixed", "Fixed"]],
        onChange: (v) => set({ dividers: v }, true),
      }),
      params.dividers === "removable"
        ? numberField({ label: "Slot spacing", value: params.dividerSpacing, hint: "Distance between slots along the top. Download the divider part and print as many as you need.", onChange: (v) => set({ dividerSpacing: v }) })
        : null,
      fixed ? stacksField(params, set) : null
    ),

    checkbox({ label: "Finger groove along the top", checked: params.groove, onChange: (v) => set({ groove: v }) }),
    checkbox({ label: "Slot in the floor to push cards up", checked: params.floorCutout, onChange: (v) => set({ floorCutout: v }) }),

    h(
      "details.advanced",
      h("summary", "Fit and print settings"),
      numberField({ label: "Card clearance", value: params.cardTolerance, hint: "Added to the card size.", onChange: (v) => set({ cardTolerance: v }) }),
      numberField({ label: "Outside width", value: params.width, hint: "0 to fit the cards. Set a width to fill a space; the side walls get thicker.", onChange: (v) => set({ width: v }) }),
      numberField({ label: "Side walls", value: params.sideWall, onChange: (v) => set({ sideWall: v }) }),
      numberField({ label: "Front and back walls", value: params.endWall, hint: "Thickness at the floor.", onChange: (v) => set({ endWall: v }) }),
      numberField({ label: "Floor", value: params.floorThickness, onChange: (v) => set({ floorThickness: v }) }),
      numberField({ label: "Corner radius", value: params.cornerRadius, onChange: (v) => set({ cornerRadius: v }) }),
      numberField({ label: "Groove width", value: params.grooveWidth, hint: "0 for automatic.", onChange: (v) => set({ grooveWidth: v }) }),
      numberField({ label: "Groove depth", value: params.grooveDepth, hint: "0 for automatic.", onChange: (v) => set({ grooveDepth: v }) }),
      numberField({ label: "Divider thickness", value: params.dividerThickness, onChange: (v) => set({ dividerThickness: v }) }),
      numberField({ label: "Divider slot depth", value: params.slotDepth, hint: "How far removable dividers sink into the walls.", onChange: (v) => set({ slotDepth: v }) })
    )
  );
}

function stacksField(params, set) {
  const id = "stacks-input";
  const input = h("input", { id, type: "text", inputmode: "decimal", value: params.stacks, autocomplete: "off" });
  input.addEventListener("input", () => set({ stacks: input.value }));
  return h(
    "div.field",
    h("label", { for: id }, "Stack thicknesses"),
    input,
    h("p.hint", "One number per section, in mm measured lying flat, separated by commas. For example: 20, 15, 25.")
  );
}
