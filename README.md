# BorderBuilder

Client-side STL generator for picture frames and lithophane borders. You set a **sight size** and **moulding profile**, or import a **LithoLab pack**; the app builds a single watertight solid and downloads a millimetre-unit STL for 3D printing.

**v0.5.0** — LithoLab back rabbets follow the printed pack outline (mask offset by border, matching LithoLab’s magenta outer) plus a live **Fit clearance** gap (default **0.8 mm**). The front opening stays on the mask. Square is gone; Hexagon, Octagon, and Circle size by circumradius. v0.4.2 tried to follow a smoothed sight offset and still sat on the inner magenta. v0.4.1 — Letter-A and other notched organic frames: the moulding follows the traced outline (including the gap between an A’s legs) instead of a convex hull or a straight bar across the bottom; the preview shows the masked letter, not the unclipped photo; offset-loft rings stay corresponded to the sight so the legs no longer fold through the opening. v0.4.0 classified stencil holes and kept gray mask fill inside the silhouette. The original “Phase 1 rectangles only” plan has been overtaken by LithoLab import and mixed plan shapes. This README describes what actually ships, then a tentative backlog.

Runs entirely in the browser. No backend. Intended host: **GitHub Pages**. The header pill, footer, page title, and STL file header all read the version from `package.json`.

## What works now

- **Manual shapes:** rectangle, hexagon, octagon, or circle. Hex / oct / circle size by **radius** (circumradius: centre to vertex, or circle radius); height matches the bounding diameter.
- **LithoLab import:** drop an STL zip or `.litholab` file. The **mask** is the front opening; export width/height set dest/sight. The **back well** is LithoLab’s pack outline (mask disk-offset by `export.border`) plus **Fit clearance** (default **0.8 mm**, minimum 0.8 mm on import) — not the inner plate/border junction. Rabbet depth is lithophane stack height plus **0.4 mm** slack. Changing Fit clearance rebuilds the pocket without re-importing. Preview artwork is `original-masked.png` composited to the letter body; enclosed **counters** stay clear (not filled from the raw photo, not painted as a floating island). Stencil **holes** are classified and **ignored** for moulding: the frame traces the letter’s outer outline (including the gap between an A’s legs) and does not add an inner wall around the triangle. Mid-gray mask fill stays inside (near-black cutoff), so a gradient in the letter body does not punch the silhouette.
- **Imported plan kernels:**
  - **Sharp convex polygons** (triangle through octagon-like corners, every remaining turn ≥ 35°) keep corners and use **true miters**.
  - **Organic silhouettes** (heart, waterdrop, letter, freeform) use a dense routed spline and an **offset loft** (EDT / disk offset). The decorative outer fills concave clefts instead of self-intersecting. The **back rabbet wall** is a forced ring: pack outline plus Fit clearance, not a closest-point sample of a smoothed sight offset. Each ring stays corresponded to the sight so a notch that the outer offset fills (an A’s legs) does not twist or overlap.
- **Sizing:** artwork/sight width × height for rectangles; radius for hex / oct / circle; moulding width; moulding height (overall Z). Outer size is `sight + 2 × moulding width` for rectangles; imported shapes show a bounding box.
- **Profiles:** 16 named mouldings in Simple / Concave / Convex / S-curve / Compound groups (Flat, Chamfer, Reverse chamfer, Step, Cove, Deep scoop, Scotia, Ovolo, Quarter-round, Bullnose, Bead, Ogee, Reverse ogee, Cove + bead, Ogee + fillet, Gallery).
- **Face sliders:** lip width (mm, the flat landing on the glass) and face depth (0–1, how strongly the moulding reads). Independent of the back rabbet.
- **Rabbet** on the back-inner corner: width (overlap) and depth. LithoLab imports keep the front cutout on the mask; the back well is pack outline + Fit clearance (rabbet width stays border + fit so the shelf still covers the magenta). Optional stacked breakdown (glass + mat + backing + clearance) that sums into depth.
- **Fit clearance:** rectangles shrink the glass-size readout so glass is not press-fit. LithoLab import is the lithophane-to-rabbet gap around the pack; drag it to grow or shrink the back wall live (floor 0.8 mm).
- **Derived readouts:** outer size, rabbet pocket, glass size, effective rabbet depth, stack total.
- **Preview:** orbitable Three.js view, updates as you edit. Faceted shading on polygonal imports; smoother shading on organic ones.
- **Export:** binary STL, one watertight solid, millimetres, header `BorderBuilder v0.5.0`.
- **Defaults:** 100 × 150 mm artwork, 20 mm moulding, 15 mm thick, 6 mm rabbet width, 5 mm rabbet depth, 0.8 mm fit clearance.

Validation rejects non-positive sizes, rabbet width ≥ moulding width, and rabbet depth ≥ moulding height.

## Run locally

On Windows, double-click `launch.bat` in the repo root. It installs dependencies on first run, starts the Vite dev server, and opens `http://localhost:5173/BorderBuilder/`.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173/BorderBuilder/`). The `/BorderBuilder/` path is required because Vite `base` matches GitHub Pages.

```bash
npm run build    # tsc && vite build
npm run preview  # serve the production bundle
npm run check:geom  # watertight / bbox / STL header / import self-check
```

Bump the UI / STL version by changing `"version"` in `package.json` only.

## GitHub Pages

Deploy matches [LithoLab](https://github.com/Elusid108/LithoLab): Vite `base: '/BorderBuilder/'` and a Pages workflow that builds with `npm ci` and uploads `dist`.

1. In the repo **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions** (not “Deploy from a branch”).
2. Merge to `main` (or run the **Deploy static content to Pages** workflow via `workflow_dispatch`).
3. The site is served at `https://elusid108.github.io/BorderBuilder/`.

The workflow is `.github/workflows/deploy.yml`. It needs `pages: write` and `id-token: write`. First deploy may ask you to approve the `github-pages` environment.

## Geometry model

Every frame is three layers of description. The first two are implemented for rectangles, imported polygons, and organic masks.

1. **Plan outline** — the inner opening (sight) as a closed 2D path, plus a constant moulding width that produces the outer path.
2. **Moulding profile** — a closed 2D polyline in `(u, v)`:
   - `u = 0` at the sight edge, increasing toward the outer edge.
   - `v = 0` at the **back**, increasing toward the front face.
   - The **rabbet is part of this profile**: a notch at the back-inner corner (`u` in `[0, rabbetWidth]`, `v` in `[0, rabbetDepth]`). The front opening stays at sight size (the mask). On LithoLab imports the back pocket wall is the pack silhouette (mask offset by border) plus Fit clearance, not a disk offset of the smoothed sight. On organic shapes that pocket keeps concavities that have not yet filled; only the decorative outer moulding fills deep clefts.
3. **Optional decoration** — motifs or text on the face after the solid exists (not built yet).

### How the solid is built

- **Rectangles, hexagons, octagons, and sharp imported polygons** use **true miters** in `src/geom/miterSweep.ts`. Each profile vertex is placed at the intersection of two offset edges. Adjacent sides share those vertices, so the mesh is one manifold solid. Circles use the organic offset loft (~96 vertices).
- **Organic imported paths** (heart, waterdrop, letter, freeform) use `src/geom/offsetLoft.ts`: a distance-transform offset of the sight at each profile `u`, then a loft between those rings. The outer ring is corresponded with `mergeWalk` so convex tip caps stay round. When a LithoLab pack is imported, the **rabbet wall** (`u = rabbetWidth`) is forced to the pack outline plus Fit clearance instead of `offset(smoothed sight, border+fit)`. Rings stay corresponded to the sight so a deep notch that the outer offset fills does not fold the moulding through the opening. Concave clefts fill on the outer moulding instead of colliding; large-radius curves do not collapse to a few mitered chords.
- Classification lives in `asPolygonCorners` (`src/geom/plan.ts`): after a 0.6 mm simplify, a convex loop with 3–12 vertices whose **every** remaining turn is at least 35° is treated as a polygon. Teardrops and other shallow sweeps stay organic.

Print orientation: `z = 0` is the **back** (rabbet on the bed if you print as-exported). Flip in the slicer if you want the face on the bed.

## Tentative plan

Shipped work is the new baseline. What follows is a **tentative** backlog: keep what still makes sense, drop the fiction that we are still in “Phase 1.”

### Next (prove it prints)

1. **Print a LithoLab pack** (heart, triangle, waterdrop) at 0.8 mm XY fit and 0.4 mm depth slack. If it is tight or sloppy, tweak **Fit clearance** — not more UI.
2. **Back retainer** so a lithophane cannot fall out of the rabbet (clips, a thin back lip, or a snap ring). Highest-value feature once frames actually fit.

### Still a good idea

- **First-class plan presets** beyond today’s hex / oct / circle: rounded rectangle, ellipse, parametric heart / gear — without requiring a LithoLab zip.
- **Two opening modes** for decorative outers: matching-shape rabbet (today’s LithoLab behaviour) vs a **rectangular artwork well** inside a fancy outer, so a standard print still fits.
- **SVG path import** (and standalone PNG silhouette) with documented mm-per-unit / px-per-mm. Reject or repair self-intersecting traces.
- **Profile editor:** edit the `(u, v)` polyline with the existing section sketch; store a custom profile in `localStorage`. Optionally **adapt** LithoLab router presets from [`Elusid108/LithoLab` `src/border/*`](https://github.com/Elusid108/LithoLab/tree/main/src/border) into BorderBuilder’s sight→outer, back→front frame (do not copy the files wholesale).
- **Face decoration:** repeating motifs, then text along the face centreline. Start with shallow displacement so the mesh stays one body.
- **Bed split + joinery** and a hanging hole / easel only after people are printing frames that do not fit a typical 220–250 mm bed.

### Lower priority / later

- Printable disconnected islands in counters (the lithophane already owns that fill).
- Curvature-adaptive resampling if a large organic curve still looks coarse after a real print.
- User toggle for “force miter vs force organic” — classification is enough until it is not.

## Repository layout

```
src/version.ts            App / STL version from package.json
src/geom/types.ts         FrameParams, ProfileId, mesh types, defaults
src/geom/profiles.ts      2D preset polylines (including rabbet)
src/geom/derived.ts       outer / pocket / glass sizes + validation
src/geom/plan.ts          loops, simplify, polygon vs organic classify
src/geom/miterSweep.ts    mitered sweep for rectangles and sharp polygons
src/geom/offset.ts        EDT disk offset
src/geom/offsetLoft.ts    organic loft from offset rings
src/geom/maskTrace.ts     mask → sight polygon + holes
src/geom/frame.ts         pick miter vs loft
src/geom/rectFrame.ts     rectangle / hex / oct / circle → mesh
src/geom/stl.ts           binary STL
src/geom/validate.ts      watertight / bbox inspection
src/geom/selfcheck.ts     geometry + import checks
src/import/litholabPack.ts  zip / .litholab unpack + param map
src/preview/viewer.ts     Three.js orbit preview + artwork plane
src/preview/artwork.ts    letter-body alpha composite (counters left clear)
src/ui/                   sidebar params + section sketch
src/main.ts               wiring
.github/workflows/deploy.yml
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
