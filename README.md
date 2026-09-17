# Frame & Reed — jaw harp case builder

Design a 3D-printable case for a jaw harp in a browser: start from a stock size or photograph your own harp from above, pick a case style and how it holds the harp, check the fit, and download the STL.

The whole app is one static page, `index.html`, served straight from this repository with GitHub Pages. Nothing runs on a server; the model is built in the browser and three.js is loaded from a CDN.

## Using it

Open the published page, choose a harp (stock size, or **Photograph your harp** and type its length), choose a case, and press **Download the STL**. Slice it flat on the bed, no supports, 0.4 mm nozzle, 0.2 mm layers. Every latch prints in place with 0.4 mm of air around it; PLA is the safer first material.

## Building it yourself

`index.html` is generated from `src/` by `build.js`:

```
npm install
npm run build        # writes dist/site/index.html (and test pages under dist/)
cp dist/site/index.html index.html
```

- `src/engine.js` — the geometry: raster-mask 2D engine, the five case styles, the four holds, the fit check and removal simulation, STL/OBJ export
- `src/tracer.js` — photo outline tracer
- `src/app.js` — the page logic, three.js stage, downloads
- `src/page.html` — the page itself (markup and styles)

The models are free to use and yours to keep.
