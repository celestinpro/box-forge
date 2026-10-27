import { buildQuickDraw, describeQuickDraw } from "./quickDraw.js";
import { buildTokenTray, describeTokenTray } from "./tokenTray.js";
import { buildCardTray, describeCardTray } from "./cardTray.js";
import { buildTokenInsert, describeTokenInsert } from "./tokenInsert.js";

/** Registry of every generator: build() returns parts, describe() a summary. */
export const MODELS = {
  "quick-draw": { build: buildQuickDraw, describe: describeQuickDraw },
  "token-tray": { build: buildTokenTray, describe: describeTokenTray },
  "card-tray": { build: buildCardTray, describe: describeCardTray },
  "token-insert": { build: buildTokenInsert, describe: describeTokenInsert },
};
