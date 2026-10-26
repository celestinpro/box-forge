# Box Forge

Design 3D-printable deck boxes and token trays for board games, right in the browser. Enter your card size, check the box in 3D, and download STL files for your slicer (or STEP files to keep editing in CAD).

**Live site:** https://celestinpro.github.io/box-forge/

## What it makes

- **Deck box**: one or more card pockets side by side. Each pocket can have its own card size and stack height. Shallower decks get a raised floor so every deck sits level with the rim. Comes with a cap that slides over the box, a sliding lid, a flat plug-in cover, or no lid.
- **Card tray**: an open tray for game inserts where the cards lean back, so tall cards fit under a low lid. Set the tray height (or the lean angle) and size the length to a space in the box or to your stack of cards. Optional finger groove, floor slot, removable dividers (slots plus a printable divider), or fixed dividers sized per stack.
- **Token tray**: an even grid of compartments with curved (scooped) floors so tokens slide out, plus an optional cap or sliding lid.

Finger slots and corner radii shrink automatically to fit narrow cards, so small sizes like 45 × 14 mm build without hand-tuning.

**Sliding lids** (deck box and token tray): a flat lid with angled sides slides in from the front along grooves in the side walls, sits flush with the top, and clicks shut. Slots near its back make springy fingers that catch on small bumps in the grooves, and a sunken arrow on top gives a thumb grip. Lid thickness and groove clearance are adjustable.

Every setting is stored in the page URL, so you can bookmark a box or send it to someone.

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
| `tests/` | Node tests that build each model across many sizes and check every part is a valid, closed solid. |
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
