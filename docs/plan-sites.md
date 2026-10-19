# Plan: more flying sites, inside and outside the Canaries

The game started as Famara and grew to seven Lanzarote launches. The next step is more places to
fly — other Canary islands first, then sites abroad — and a way to pick between them.

## The model

**World → Region → Launch.**

- A **region** is one terrain download: a bbox, a heightmap, an orthophoto and detail tiles, in
  `public/sites/<region>/`. Its `site.json` is what the game and `fetch-terrain` read. Today
  there is one region, `lanzarote`, with seven launches.
- A **launch** is a point inside a region. Switching launch is instant (same terrain); switching
  region is a new download, so it goes back through the loading screen.
- `public/sites/index.json` lists the regions. Each region's `site.json` (≈1 KB) carries everything
  the picker shows, so the manifest is only a list of ids — no second copy of names or launches.

## What constrains it

- **Data sources.** `fetch-terrain` only knows IGN (MDT05 + PNOA). That covers all of Spain,
  every Canary island included. Abroad needs another source: Copernicus GLO-30 (30 m, worldwide)
  for height, and an open photo layer whose licence allows it (Sentinel-2 cloudless: check which
  year's licence).
- **Credits.** The IGN attribution is hardcoded in `index.html`. It must come from the region.
- **Size.** A region is ~74 MB committed in git. Twenty regions would be ~1.5 GB, so terrain has
  to move out of plain git (Git LFS or object storage) before the count grows much.

## UI

1. **Site picker (list)** — Country › Region › Launch, opened with **M**. Picking a launch in the
   loaded region switches in place; picking one in another region loads it. Keyboard (arrows,
   Enter, Esc) and mouse. Cheap, works on mobile, and reads the same data the map will.
2. **Deep links** — `?region=lanzarote&launch=famara&wind=345/24`. The URL follows the current
   launch and wind, so a copied address reproduces the setup. Also used to change region.
3. **"Works today"** — each launch gets the wind directions it works in (`windFrom: [300, 30]`).
   The picker shows a small wind wedge per launch and highlights the ones that work in the current
   weather panel's wind.
4. **Map picker** — a map start screen (MapLibre/Leaflet + OSM) with region clusters and launch
   pins carrying the wind wedge; clicking a pin opens a card (name, altitude, orientation, best
   wind, download size, cached?) with **Fly**. Same data as the list.
5. **In-flight map** — the region with launches and your position, on the same **M** key once
   the map picker exists.

## Authoring

- `site.json` stays the source of truth (config over code).
- Launch fields to add: `windFrom`, `altitude` (or read it from the DEM), optional `landing`,
  `notes`.
- `site.json` gets `source` (`ign` | `copernicus`) and `attribution`; `fetch-terrain` picks the
  provider from `source`.
- An `add-site` CLI: name + centre → proposed bbox, nearby take-offs from the ParaglidingEarth
  API to tick, writes `site.json`, runs `fetch-terrain`.
- A dev-only editor page (drag bbox, drop pins, drag heading/wind wedge, save `site.json`) only
  if adding sites by hand gets tedious.

## Steps

1. ~~Manifest (`public/sites/index.json`), `famara` folder renamed `lanzarote`, deep links,
   list picker on **M**.~~ ✅
2. `windFrom` per launch; wind wedges and "works today" in the picker.
3. Map picker.
4. ~~First region off the Canaries: **Loarre** (Huesca), IGN in UTM 30N, with `plainM` for an
   inland horizon instead of the sea.~~ ✅
   ~~Castejón de Sos, Àger and Organyà (UTM 30 extended into zone 31).~~ ✅
   Still to do: `source` + `attribution` per region and credits from the region (needed once a
   non-IGN region lands). ~~Another Canary island: Gran Canaria (Los Giles, La Isleta).~~ ✅
   ~~Tenerife (La Corona, Izaña, Güímar, Ifonche, Taucho, Los Gigantes), with Teide.~~ ✅
   Seven regions are ~375 MB in git, so terrain storage (step 5) is due before many more.
5. Copernicus provider for the first site outside Spain (Ölüdeniz, Bassano or Annecy); terrain
   storage out of plain git.
6. Editor page, only if needed.

## Open questions

- Gamepad navigation of the picker (d-pad + A) — not in step 1.
- Where terrain lives once it leaves git: LFS keeps the repo self-contained; R2/Blob keeps clones
  small and lets the game cache per region.
