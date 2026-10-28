# Box Forge

Design 3D-printable deck boxes and token trays for board games, right in the browser. Enter your card size, check the box in 3D, and download STL files for your slicer (or STEP files to keep editing in CAD).

**Live site:** https://celestinpro.github.io/box-forge/

## What it makes

- **Deck box**: one or more card pockets side by side. Each pocket can have its own card size and stack height. Shallower decks get a raised floor so every deck sits level with the rim. Comes with a cap that slides over the box, a sliding lid, a flat plug-in cover, or no lid.
- **Card tray**: an open tray for game inserts where the cards lean back, so tall cards fit under a low lid. Set the tray height (or the lean angle) and size the length to a space in the box or to your stack of cards. Optional finger groove, floor slot, removable dividers (slots plus a printable divider), or fixed dividers sized per stack.
- **Token insert**: photograph your tokens on plain paper next to a 50 × 50 mm square (or upload an SVG silhouette) and get a tray with a pocket shaped like each token, plus finger notches, optional lift cutouts (round bites in the tray sides so you can lift the insert out of the game box) and optional coloured floor inlays. Tracing runs in the browser; see [How token tracing works](#how-token-tracing-works).
- **Token tray**: compartments with curved (scooped) floors so tokens slide out, plus an optional cap or sliding lid. Start from an even grid, then split any compartment side by side or front to back, drag the walls to resize, or type a compartment's size.

Finger slots and corner radii shrink automatically to fit narrow cards, so small sizes like 45 × 14 mm build without hand-tuning.

**Sliding lids** (deck box and token tray): a flat lid with angled sides slides in from the front along grooves in the side walls, sits flush with the top, and clicks shut. Slots near its back make springy fingers that catch on small bumps in the grooves, and a sunken arrow on top gives a thumb grip. Lid thickness and groove clearance are adjustable.

Every setting is stored in the page URL, so you can bookmark a box or send it to someone.

## How token tracing works

1. **Paper colour**: the page estimates the paper's colour across the photo (so uneven light is fine) and scores how different each pixel is. With *Ignore shadows* on, mild darkening of the paper counts for little, so soft shadows are left out.
2. **Shapes**: pixels above a threshold set from the paper's own noise become shapes. The *Add* and *Erase* brush fixes anything the tracer got wrong.
3. **Edges**: each shape's edge is then placed halfway between the paper colour and that token's colour, which keeps sizes unbiased even with JPEG colour bleed or a slightly soft focus.
4. **Scale**: the 50 mm square's four sides are fitted with straight lines; their corners give a separate X and Y scale (the "50 / measured" correction), so a slightly skewed scan still measures correctly.
5. **Pockets**: each outline is grown by the clearance (0.25 mm by default), joined with its finger notch, and cut into the tray at the token's thickness (times the stack height), or at a pocket depth you set for that token.

Accuracy on the test photos: within about 0.05 mm on edges, and exact scale. For best results use a scanner app, contrasting paper, and soft light.

## Run it locally

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev      # local dev server at http://localhost:5173
npm test         # build every model headlessly and check the geometry
npm run build    # production build into dist/
```

## How it's built

| Piece | What it does |
| --- | --- |
| `src/models/` | The box designs, written with [replicad](https://replicad.xyz/) (a JavaScript API over the OpenCascade CAD kernel). Plain functions: parameters in, solid shapes out. |
| `src/cad/worker.js` | Runs OpenCascade (WebAssembly) in a Web Worker so the page stays responsive, meshes shapes for the preview and exports STL/STEP. |
| `src/viewer.js` | three.js preview. |
| `src/ui/` | Framework-free settings panels and the shared generator page. |
| `src/trace/` | Token tracing (photo → outlines in mm), layout (auto-pack, overlap checks, finger notches) and pocket outlines. Plain JavaScript, runs in its own Web Worker. |
| `tests/` | Node tests that build each model across many sizes and check every part is a valid, closed solid, and check tracing accuracy on synthetic photos with known shapes. |
| `tools/deckbox.py` | A standalone Python/CadQuery version of the deck box for the command line. |

### Adding a new generator

1. Add defaults to `src/models/config.js`.
2. Write `src/models/<name>.js` exporting `build(params)` → `{ parts, layout, warnings }` and `describe(layout)` → summary lines.
3. Register it in `src/models/index.js`.
4. Add a form in `src/ui/` and a route in `src/main.js`.
5. Add test cases to `tests/models.test.mjs`.

## Deployment

Every push to `main` runs the tests, builds the site, and publishes it to GitHub Pages via `.github/workflows/deploy.yml`. In the repository's **Settings → Pages**, the source must be set to **GitHub Actions**.

## Credits

Inspired by Steve Genoud's [Deck in a Box](https://deckinabox.sgenoud.com/). The sliding lid follows the style of Extrutim's [customizable box](https://www.printables.com/model/224016). The card tray follows the leaning-card tray design by [js500](https://www.printables.com/model/449323) and floookay's [parametric card holder](https://www.printables.com/model/769092). Box Forge is an independent implementation and contains no code from those projects. 3D modelling by [replicad](https://github.com/sgenoud/replicad) (MIT) and [OpenCascade](https://dev.opencascade.org/) (LGPL 2.1, loaded unmodified as WebAssembly via `replicad-opencascadejs`).

## License

[MIT](LICENSE) for the Box Forge code. Third-party libraries keep their own licenses.
