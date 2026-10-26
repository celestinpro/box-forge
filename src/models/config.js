// Plain data (no CAD imports) so the main thread can load it without
// pulling in the 3D engine.

export const CARD_PRESETS = [
  { id: "poker", name: "Standard poker cards", height: 89, width: 64 },
  { id: "poker-sleeved", name: "Standard sleeved cards", height: 92, width: 67 },
  { id: "euro", name: "European playing cards", height: 92, width: 59 },
  { id: "tall", name: "Tall cards (tarot)", height: 120, width: 70 },
  { id: "tall-sleeved", name: "Tall sleeved cards", height: 123, width: 73 },
  { id: "mini-euro", name: "Mini euro cards", height: 68, width: 44 },
  { id: "mini-us", name: "Mini US cards", height: 63, width: 41 },
  { id: "mini-sleeved", name: "Mini sleeved cards", height: 70, width: 47 },
];

export const QUICK_DRAW_DEFAULTS = {
  pockets: [{ cardHeight: 89, cardWidth: 64, deckHeight: 20 }],
  wallThickness: 1.8,
  cardTolerance: 2,
  innerFillet: 3,
  fingerSlot: 15,
  lidType: "lid", // lid | cover | none
  lidTolerance: 0.6,
  align: "center", // center | front
};

export const TOKEN_TRAY_DEFAULTS = {
  width: 90, // outer X
  depth: 64, // outer Y
  height: 20, // outer Z
  columns: 3,
  rows: 2,
  wallThickness: 1.6,
  floorThickness: 1.2,
  cornerRadius: 3,
  scoop: 8, // radius of the curve between floor and walls
  lid: true,
  lidTolerance: 0.6,
};

export const CARD_TRAY_DEFAULTS = {
  cardHeight: 88,
  cardWidth: 63,
  cardTolerance: 2,
  standOn: "long", // long | short: which card edge rests on the floor
  heightMode: "height", // height | angle
  lean: "auto", // auto | angle | upright (when the height is set)
  height: 57,
  angle: 60,
  lengthMode: "space", // space | cards
  length: 150,
  stackThickness: 40,
  dividers: "removable", // none | removable | fixed
  dividerSpacing: 15,
  dividerThickness: 2.4,
  slotDepth: 17,
  stacks: "20, 15, 25",
  groove: true,
  grooveWidth: 0, // 0 = automatic
  grooveDepth: 0, // 0 = automatic
  grooveShoulder: 5,
  floorCutout: false,
  width: 0, // 0 = card + side walls
  sideWall: 2,
  endWall: 2.4,
  floorThickness: 1.2,
  cornerRadius: 3,
};
