# BorderBuilder

Client-side STL generator for picture frames and other borders. You set the **artwork / sight size** and a **moulding profile**; the app builds a single watertight solid and downloads a millimetre-unit STL for 3D printing.

Phase 1 (this tree) is a working rectangular/square frame: swept/mitered profiles, a back-inner rabbet, live 3D preview, and STL export. Later phases add more plan shapes, a profile editor, face decoration, and optional printer-bed split.

Runs entirely in the browser. No backend. Intended host: **GitHub Pages**.

## Phase 1 (what works now)

- **Shapes:** rectangle or square (square locks width = height).
- **Sizing:** artwork/sight width × height, moulding width, moulding height (overall Z).
- **Outer size** is derived: `sight + 2 × moulding width`.
- **Profiles:** Flat, Cove, Ogee, Chamfer — 2D cross-sections swept around four **mitered** sides (not a rounded corner sweep).
- **Rabbet** on the back-inner corner: width (lip overlap) and depth. Optional stacked breakdown (glass + mat + backing + clearance) that sums into depth.
- **Derived readouts:** outer size, rabbet pocket (`sight + 2 × rabbet width`), glass size (`pocket − fit clearance`), effective rabbet depth.
- **Preview:** orbitable Three.js view, updates as you edit.
- **Export:** binary STL, one watertight solid, units in millimetres.
- **Defaults:** 100 × 150 mm artwork, 20 mm moulding, 15 mm thick, 6 mm rabbet width, 5 mm rabbet depth.

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
npm run check:geom  # watertight / bbox / STL header self-check
```

## GitHub Pages

Deploy matches [LithoLab](https://github.com/Elusid108/LithoLab): Vite `base: '/BorderBuilder/'` and a Pages workflow that builds with `npm ci` and uploads `dist`.

1. In the repo **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions** (not “Deploy from a branch”).
2. Merge to `main` (or run the **Deploy static content to Pages** workflow via `workflow_dispatch`).
3. The site is served at `https://elusid108.github.io/BorderBuilder/`.

The workflow is `.github/workflows/deploy.yml`. It needs `pages: write` and `id-token: write`. First deploy may ask you to approve the `github-pages` environment.

## Geometry model

Every frame is three layers of description. Phase 1 implements the first two for rectangles; later phases hang more plan shapes and decorations on the same split.

1. **Plan outline** — the inner opening (sight) as a closed 2D path, plus a constant moulding width that produces the outer path.
2. **Moulding profile** — a closed 2D polyline in `(u, v)`:
   - `u = 0` at the sight edge, increasing toward the outer edge.
   - `v = 0` at the **back**, increasing toward the front face.
   - The **rabbet is part of this profile**: a notch at the back-inner corner (`u` in `[0, rabbetWidth]`, `v` in `[0, rabbetDepth]`). The front opening stays at sight size; the back pocket is larger by about `2 × rabbet width`.
3. **Optional decoration** (phases 5–6) — motifs or text applied on the face after the solid exists, or as displacements of the face polyline.

### How the solid is built

- **Rectangles, squares, and later regular polygons** use **true miters**. Each profile vertex is placed at the intersection of two offset edges (angle-bisector / parallel-offset miter). Adjacent sides share those vertices, so there are no miter caps and the mesh is one manifold solid.
- **Organic paths** (heart, freehand SVG, ellipses that are not stadiums) should **not** fake miters. Use a **parallel-transport sweep**: slide the profile along the path with a smoothly transported frame, and special-case sharp corners if the source path has them.
- The Phase 1 mesher already lives in `src/geom/miterSweep.ts` so n-gons can reuse it. Hearts and imported outlines belong on the sweep path, not a bolted-on second kernel.

Print orientation: `z = 0` is the **back** (rabbet on the bed if you print as-exported). Flip in the slicer if you want the face on the bed.

## Product plan

### Phase 1 — Rectangle / square skeleton (this PR)

Ship a usable tool, not a mock.

- Rectangular and square frames only.
- A short list of swept/mitered presets (Flat, Cove, Ogee, Chamfer).
- Full rabbet controls, including optional stack → depth.
- Live 3D preview and binary STL download.
- GitHub Pages deploy (Actions + `/BorderBuilder/` base).
- Modular geom so later plan shapes do not rewrite the profile or STL writer.

### Phase 2 — Regular polygons + rounded rect + circle / ellipse

- Regular n-gons (triangle through high-n “circle approximation”) using the same miter sweep; miters are well-defined at every vertex.
- Rounded rectangle: straight sides + circular-arc corners. Straights keep miters; corner arcs use a local rotational sweep so the profile stays upright.
- True circle and ellipse: treat as closed organic paths (parallel-transport), or as a high-n polygon if the user wants faceted “pane” miters.
- Keep sizing by **inner sight** + moulding width; show derived outer bounding box (important once the outer is no longer a rectangle).

### Phase 3 — Heart, gear, and outline import

- Heart and gear as first-class plan presets (parametric, not a hidden SVG).
- **SVG path** and **PNG silhouette** import: trace / potrace-style bitmap to a single outer outline (and later holes).
- Two opening modes, because decorative frames are not always “artwork-shaped”:
  - **Matching-shape rabbet:** the pocket follows the plan (heart-shaped photo well).
  - **Rectangular artwork well:** decorative outer (heart, gear, flourish) with a rectangular sight and rectangular rabbet, so a standard print still fits.
- Document winding and scale (mm per SVG unit, PNG px → mm). Reject self-intersecting traces or offer a repair step.

### Phase 4 — Profile editor (+ optional LithoLab presets)

- Edit the `(u, v)` polyline: add points, arcs, and cove/ogee segments; live section sketch (Phase 1 already draws the preset).
- Preset library remains the default; “custom” is stored in `localStorage`.
- Optionally **port LithoLab router presets** from [`Elusid108/LithoLab` `src/border/*`](https://github.com/Elusid108/LithoLab/tree/main/src/border) (`routerCatalog.ts`, `routerGeometry.ts`, `routerPresets.ts`, …). Those profiles are lithophane-border oriented (left = inside). Adapt them to BorderBuilder’s `u`/`v` frame (sight → outer, back → front) and attach a rabbet instead of copying the files wholesale.
- Keep the editor output as a closed profile so the existing sweeper does not change.

### Phase 5 — Embossed repeating motifs

- Flowers, hearts, and similar stamps along the **face** (the decorative `v ≈ height` span).
- Controls: motif, size, spacing / count, inset from sight and outer, relief height (emboss or deboss).
- Implementation sketch: place instances in the face’s unrolled `(s, u)` domain, then displace or boolean-union onto the swept solid. Start with a shallow vertex displacement so the mesh stays one body; graduate to robust CSG if overlap gets hard.
- Miters: motifs should not straddle a miter badly — stop at a margin or rotate to the bisector.

### Phase 6 — Text along path

- A line of text following the face centreline (or a user offset).
- Font: a small built-in sans (or user-supplied) converted to outlines, then swept/stamped like motifs.
- Controls: string, size, tracking, alignment (start / centre / justify around the loop), relief.
- Rectangular frames can still use four straight runs with mitered glyph clipping; organic paths use the same parallel-transport frame as Phase 3.

### Phase 7 (optional) — Split, joinery, hang

- Split a large frame into bed-sized segments with **alignment joinery** (dovetail, half-lap, or pin-and-hole) and a multi-file STL zip.
- Hanging hole, sawtooth boss, or easel stand as optional back features that do not break the rabbet pocket.
- Only worth doing once people are printing Phase 1–3 frames that do not fit a typical 220–250 mm bed.

## Repository layout

```
src/geom/types.ts       FrameParams, ProfileId, mesh types, defaults
src/geom/profiles.ts    2D preset polylines (including rabbet)
src/geom/derived.ts     outer / pocket / glass sizes + validation
src/geom/miterSweep.ts  generic mitered sweep for a plan polygon
src/geom/rectFrame.ts   rectangle / square → mesh
src/geom/stl.ts         binary STL
src/geom/validate.ts    watertight / bbox inspection
src/preview/viewer.ts   Three.js orbit preview
src/ui/                 sidebar params + section sketch
src/main.ts             wiring
.github/workflows/deploy.yml
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
