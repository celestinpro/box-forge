import "./style.css";
import { h } from "./ui/dom.js";
import { generatorPage } from "./ui/generatorPage.js";
import { quickDrawForm } from "./ui/quickDrawForm.js";
import { tokenTrayForm } from "./ui/tokenTrayForm.js";
import { QUICK_DRAW_DEFAULTS, TOKEN_TRAY_DEFAULTS } from "./models/config.js";
import { warmUp } from "./cad/client.js";

const deckBoxArt = `
<svg viewBox="0 0 200 120" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">
    <path d="M30 70 L90 92 L170 62 L110 40 Z"/>
    <path d="M30 70 L30 40 L110 12 L170 34 L170 62"/>
    <path d="M90 92 L90 62 L170 34"/><path d="M90 62 L30 40"/>
    <path d="M70 55 L70 25" opacity=".55"/><path d="M130 33 L130 51" opacity=".55"/>
    <path d="M52 48 q8 10 16 6" /><path d="M118 24 q8 10 16 6"/>
  </g>
</svg>`;

const trayArt = `
<svg viewBox="0 0 200 120" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">
    <path d="M20 72 L92 100 L180 66 L108 38 Z"/>
    <path d="M20 72 L20 54 L108 20 L180 48 L180 66"/>
    <path d="M92 100 L92 82 L180 48"/><path d="M92 82 L20 54"/>
    <path d="M50 66 L138 32" opacity=".55"/><path d="M71 74 L159 40" opacity=".55"/>
    <path d="M56 40 L128 68" opacity=".55"/><path d="M82 30 L154 58" opacity=".55"/>
  </g>
</svg>`;

const GENERATORS = [
  {
    path: "quick-draw",
    title: "Deck box",
    blurb: "One box, one or more decks. Each pocket can take a different card size and stack height, with a finger slot to pull the cards out.",
    art: deckBoxArt,
  },
  {
    path: "token-tray",
    title: "Token tray",
    blurb: "A grid of compartments with curved floors so tokens slide out, and a lid that slides over the top.",
    art: trayArt,
  },
];

function home() {
  return h(
    "main.home",
    h(
      "section.hero",
      h("h1", "Boxes for your cards and tokens, sized to the millimetre."),
      h("p", "Enter your card size, check the box in 3D, and download files ready for your slicer. Everything runs in your browser.")
    ),
    h(
      "section.tiles",
      ...GENERATORS.map((g) =>
        h(
          "a.tile",
          { href: `#/${g.path}` },
          h("div.art", { html: g.art }),
          h("h2", g.title),
          h("p", g.blurb),
          h("span.open", `Design a ${g.title.toLowerCase()}`)
        )
      )
    ),
    h(
      "section.notes-home",
      h("h2", "Good to know"),
      h(
        "ul",
        h("li", "Measure the deck with the cards lying flat, and add a millimetre or two if they're sleeved."),
        h("li", "Card clearance and lid clearance are under ", h("em", "Fit and print settings"), ". Raise them if a test print is tight."),
        h("li", "STL files go straight into your slicer. STEP files open in Fusion, Onshape or FreeCAD if you want to customise further.")
      )
    )
  );
}

const ROUTES = {
  "": home,
  "quick-draw": () =>
    generatorPage({
      model: "quick-draw",
      title: "Deck box",
      intro: "Add a pocket for each deck. Pockets sit side by side, and shallower decks get a raised floor so every deck is level with the top.",
      defaults: QUICK_DRAW_DEFAULTS,
      form: quickDrawForm,
    }),
  "token-tray": () =>
    generatorPage({
      model: "token-tray",
      title: "Token tray",
      intro: "Set the outside size and how many compartments you want. Compartments are divided evenly.",
      defaults: TOKEN_TRAY_DEFAULTS,
      form: tokenTrayForm,
    }),
};

const app = document.getElementById("app");
let current = null;
let currentRoute = null;

function route() {
  const path = location.hash.replace(/^#\/?/, "").split("?")[0];
  const key = path in ROUTES ? path : "";
  if (key === currentRoute) return;
  current?.dispose?.();
  currentRoute = key;
  current = ROUTES[key]();
  app.replaceChildren(current);
  document.title = key ? `${current.querySelector("h1").textContent} · Box Forge` : "Box Forge";
  document.querySelectorAll("header nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#/${key}` ? "page" : "false"));
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
warmUp();
