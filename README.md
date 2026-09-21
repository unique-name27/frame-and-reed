# Jaw Harp Case Generator

Design a 3D-printable case for a jaw harp in a browser. Start from a stock size or photograph your own harp from above, pick a case style and a way of holding the harp, check the fit, and download the STL.

The whole app is one static page, `index.html`, served straight from this repository with GitHub Pages. Nothing runs on a server; the model is built in the browser and three.js is loaded from a CDN.

## Using it

Open the published page, choose a harp (a stock size, or **Upload a photo of your harp**, taken from straight above, and type in its length), choose a case, and press **Download the STL**. Slice it flat on the bed, no supports, 0.4 mm nozzle, 0.2 mm layers. PLA is the safer first material.

Seven ways of holding the harp, from nothing-to-break to most enclosed: cord lashing (two slots, you supply the cord), a sliding cover, turn-buttons on captive pegs, hidden blades driven from the side or from the top, a single spine bolt, and twin bolts.

Four patterns for the top of the case: Damascus steel, botanical scrollwork, a flowering vine, and Japanese seigaiha waves with sakura. Each is drawn fresh to fit the case's outline, and can be raised, engraved, or pierced right through as filigree (the clamshell lid, the sleeve roof and the pendant floor have open space beneath them to pierce). Choose **Filament** or **Resin** to size the detail for the printer; resin also widens the gap around the moving parts to 0.6 mm.

## Building it yourself

`index.html` is generated from `src/` by `build.js`:

```
npm install
npm run build        # writes dist/site/index.html (and test pages under dist/)
cp dist/site/index.html index.html
```

- `src/engine.js` — the geometry: raster-mask 2D engine, the five case styles, the seven holds, the fit check and removal simulation, STL/OBJ export
- `src/decor.js` — the ornament: distance transforms, the vine-growing and blossom drawing, Damascus and seigaiha
- `src/tracer.js` — photo outline tracer
- `src/app.js` — the page logic, three.js stage, downloads
- `src/page.html` — the page itself (markup and styles)

The models are free to use and yours to keep.
