# Jaw Harp Case Generator

**Live site: [unique-name27.github.io/frame-and-reed](https://unique-name27.github.io/frame-and-reed/)**

Design a 3D-printable case for a jaw harp in a browser. Start from a stock size or photograph your own harp from above, pick a case style and a way of holding the harp, check the fit, and download the STL.

The whole app is one static page, `index.html`, served straight from this repository with GitHub Pages. Nothing runs on a server; the model is built in the browser and three.js is loaded from a CDN.

## Using it

Open [the page](https://unique-name27.github.io/frame-and-reed/), choose a harp (a stock size, or **Upload a photo of your harp**, taken from straight above, and type in its length), choose a case, and press **Download the STL**. Slice it flat on the bed, no supports, 0.4 mm nozzle, 0.2 mm layers. PLA is the safer first material. Every length on the page can be shown in millimetres or inches; the switch is in the header, in the corner of the 3D view, and in the photo tracer, and they all flip together.

Seven ways of holding the harp, from nothing-to-break to most enclosed: cord lashing (two slots, you supply the cord), a sliding cover, turn-buttons on captive pegs, hidden blades driven from the side or from the top, a single spine bolt, and twin bolts. Everything prints without supports: the pads under the turn-buttons stand on small loose posts that you push out afterwards.

**Stands:** besides the five cases there are two easels for showing harps off on a shelf: one for a single harp, and a long one for two to six in a row. The harp stands bow down on a ledge and leans back against two legs that touch only its frame, either side of the reed. Each easel is one solid piece that prints standing up, exactly as it stands, with no supports; the lean is adjustable from 8° to 25°.

**Having it printed by a shop:** use **No printer? Have one printed** rather than the ordinary download. It writes files made for a print bureau: each piece of the case as one closed solid in its own STL, with no parts printed inside other parts and no hollows that could trap resin. A shop can make the easels, and the cases held by cord lashing (one piece) or the sliding cover (case + cover); the latches, turn-buttons and bolts print already assembled inside the case, which works on your own printer but is not something a shop will take on. Pick **PLA** or **Resin** there before saving: the files are made for the material — the pattern's finest detail, and the play round the sliding cover (0.4 mm in PLA, 0.3 mm in resin) — and the file names and the notes for the shop say which.

Cases are plain by default. Four optional patterns for the top of the case: Damascus steel, botanical scrollwork, a flowering vine, and Japanese seigaiha waves with sakura. Each is drawn fresh to fit the case's outline, and can be raised, engraved, or pierced right through as filigree (the clamshell lid, the sleeve roof and the pendant floor have open space beneath them to pierce). Choose **Filament** or **Resin** to size the detail for the printer; resin also widens the gap around the moving parts to 0.6 mm.

## Building it yourself

`index.html` is generated from `src/` by `build.js`:

```
npm install
npm run build        # writes dist/site/index.html (and test pages under dist/)
cp dist/site/index.html index.html
```

- `src/engine.js` — the geometry: raster-mask 2D engine, the five case styles and the two easel stands, the seven holds, the fit check and removal simulation, STL/OBJ export
- `src/solid.js` — the print-file clean-up: a boolean union (manifold-3d, carried in the page as WebAssembly) that turns the overlapping slabs into one closed solid per piece
- `src/decor.js` — the ornament: distance transforms, the vine-growing and blossom drawing, Damascus and seigaiha
- `src/tracer.js` — photo outline tracer
- `src/app.js` — the page logic, three.js stage, downloads
- `src/page.html` — the page itself (markup and styles)

The models are free to use and yours to keep.
