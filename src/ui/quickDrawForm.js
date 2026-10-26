import { h, numberField, segmented } from "./dom.js";
import { slidingFields } from "./slidingFields.js";
import { CARD_PRESETS } from "../models/config.js";

const MAX_POCKETS = 8;

function presetFor(pk) {
  return CARD_PRESETS.find((c) => c.height === pk.cardHeight && c.width === pk.cardWidth)?.id ?? "custom";
}

export function quickDrawForm(params, update, rerender) {
  const pockets = params.pockets.map((p) => ({ ...p }));
  const setPockets = (next, redraw = false) => {
    update({ pockets: next });
    if (redraw) rerender();
  };

  const pocketCards = pockets.map((pk, i) => {
    const change = (patch, redraw = false) => {
      const next = pockets.map((p, j) => (j === i ? { ...p, ...patch } : p));
      pockets[i] = next[i];
      setPockets(next, redraw);
    };

    const preset = h(
      "select",
      { "aria-label": `Pocket ${i + 1} card type` },
      ...CARD_PRESETS.map((c) => h("option", { value: c.id }, `${c.name} (${c.height} × ${c.width})`)),
      h("option", { value: "custom" }, "Custom size")
    );
    preset.value = presetFor(pk);
    preset.addEventListener("change", () => {
      const c = CARD_PRESETS.find((x) => x.id === preset.value);
      if (c) change({ cardHeight: c.height, cardWidth: c.width }, true);
    });

    return h(
      "fieldset.pocket",
      h(
        "legend",
        pockets.length > 1 ? `Pocket ${i + 1}` : "Cards",
        pockets.length > 1
          ? h(
              "button.remove",
              { type: "button", "aria-label": `Remove pocket ${i + 1}`, on: { click: () => setPockets(pockets.filter((_, j) => j !== i), true) } },
              "Remove"
            )
          : null
      ),
      h("div.field", h("span.label", "Card type"), preset),
      h(
        "div.field-row",
        numberField({ label: "Card height", value: pk.cardHeight, onChange: (v) => { change({ cardHeight: v }); preset.value = presetFor(pockets[i]); } }),
        numberField({ label: "Card width", value: pk.cardWidth, onChange: (v) => { change({ cardWidth: v }); preset.value = presetFor(pockets[i]); } })
      ),
      numberField({ label: "Deck thickness", value: pk.deckHeight, hint: "Height of the card stack, measured with the cards flat.", onChange: (v) => change({ deckHeight: v }) })
    );
  });

  const addPocket = h(
    "button.add",
    {
      type: "button",
      disabled: pockets.length >= MAX_POCKETS,
      on: { click: () => setPockets([...pockets, { ...pockets[pockets.length - 1] }], true) },
    },
    pockets.length >= MAX_POCKETS ? "Up to 8 pockets per box" : "Add a pocket next to it"
  );

  return h(
    "div.form",
    ...pocketCards,
    addPocket,
    segmented({
      label: "Lid",
      value: params.lidType,
      options: [["lid", "Cap"], ["sliding", "Sliding"], ["cover", "Cover"], ["none", "None"]],
      onChange: (v) => {
        update({ lidType: v });
        rerender();
      },
    }),
    params.lidType === "sliding"
      ? slidingFields(params, update)
      : h(
          "p.hint",
          { style: "margin-top:-8px" },
          { lid: "A cap that slides down over the whole box.", cover: "A flat cover with a plug that drops into each pocket.", none: "Just the box." }[params.lidType] ?? ""
        ),
    pockets.length > 1
      ? segmented({
          label: "Shorter cards sit",
          value: params.align,
          options: [["center", "In the middle"], ["front", "Against one wall"]],
          onChange: (v) => update({ align: v }),
        })
      : null,
    h(
      "details.advanced",
      h("summary", "Fit and print settings"),
      numberField({ label: "Wall thickness", value: params.wallThickness, hint: "Also used for the walls between pockets.", onChange: (v) => update({ wallThickness: v }) }),
      numberField({ label: "Card clearance", value: params.cardTolerance, hint: "Added to the card size so cards drop in easily. 2 mm suits most printers.", onChange: (v) => update({ cardTolerance: v }) }),
      numberField({ label: "Pocket corner radius", value: params.innerFillet, hint: "Shrinks automatically for narrow cards.", onChange: (v) => update({ innerFillet: v }) }),
      numberField({ label: "Finger slot width", value: params.fingerSlot, hint: "Shrinks automatically for narrow cards. 0 for no slot.", onChange: (v) => update({ fingerSlot: v }) }),
      numberField({ label: "Cap and cover clearance", value: params.lidTolerance, hint: "Increase if the cap or cover is too tight on your printer.", onChange: (v) => update({ lidTolerance: v }) })
    )
  );
}
