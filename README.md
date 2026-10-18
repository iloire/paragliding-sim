# Famara Glide

[![CI](https://github.com/iloire/paragliding-sim/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/iloire/paragliding-sim/actions/workflows/ci.yml)

A paragliding simulator prototype at the real **Famara** take-off on Lanzarote, running in the
browser. It is for pilots who know the site and want the air to behave like it does: ridge lift
that depends on the wind angle against the Risco de Famara, a soaring band that tops out, an
inversion that kills it, thermals that mark themselves with cumulus. The glider is a rigid body —
an arched canopy of six strips 7.5 m above the pilot — so turns, spirals, wingovers with a light
top, stalls and gust collapses come out of the physics. The
terrain and aerial photo are the real IGN data. The Lanzarote map covers the island's flyable sites:
Famara, Mala, Mirador del Río, Tenesar, El Cuchillo, Macher and Playa Quemada (**N** cycles through
them). Four mainland regions in the Pyrenees and Pre-Pyrenees follow: **Loarre** (Loarre, Tiacuto),
**Castejón de Sos** (Rials, Chía, Pedras Blancas, Liri), **Àger** (Sant Alís, Àger) and **Organyà**
(Organyà, Santa Fe, Prats, Narieda). **M** picks between regions.

This is the **browser prototype** of a planned Unreal Engine game — it proves the flight feel and
the lift model cheaply first. The plan lives in the notes vault (`Projects/paragliding-simulator/plan.md`).

![Soaring the Risco de Famara in a 24 km/h north-westerly](docs/screenshots/famara-cliff.png)

![Instrument panel: vario, AGL, thermal assistant, wind rose and glide to the Famara beach landing](docs/screenshots/instrument-panel.png)

![Spiral dive over Lanzarote: 82° bank, 3.4 G, −13.7 m/s](docs/screenshots/spiral-dive.png)

![Above the Famara launch: native 5 m terrain and 1.5 m/px photo near the camera](docs/screenshots/terrain-detail.png)

![Sunset over Famara: the sun on the horizon, the wing backlit](docs/screenshots/sunset.png)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

You start in the air above the launch, facing into the wind (so does switching launch with **N**,
or picking one from the site list on **M**).
**A/D** brake left/right, **T** air-starts again, **R** puts you on the ground at the launch, where
**W** runs off it into the wind. **L** shows the lift map. **Shift + A/D** is a deep brake (hold it for a spiral dive);
**A/D with Q/E** in rhythm with the swing builds wingovers. A gamepad works too (triggers = brakes), and so does a phone held sideways: pull a thumb down on either
half of the screen to brake that side, push it up to run, slide it sideways to shift weight. The weather panel on the
right changes wind, inversion and thermals live, and **Time of day** moves the sun: thermals are
weak in the morning, strongest and roughest in the early afternoon, gone by the evening, and the
Sunset preset puts the sun on the horizon. The address bar follows along, so a link like
`?region=lanzarote&launch=mala&wind=300/18&time=17:20` starts that launch in that wind at that
(solar) time.

## Check it

```bash
npm test           # flight + air model unit tests (Vitest)
npm run lint
npm run build      # typecheck + production bundle
```

CI runs the same three on every push to `main` and every pull request.

## Terrain data

The height map and orthophoto are committed under `public/sites/lanzarote/`, plus 3 km detail tiles
(native 5 m heights, 1.5 m/px photo) around the launches in `detail/`. To rebuild them, or to add
a region, edit its `site.json`, list it in `public/sites/index.json` and run
`npm run fetch-terrain -- <region>` (`--detail` redoes only the tiles). The plan for more sites is
in [docs/plan-sites.md](docs/plan-sites.md). See
[docs/architecture.md](docs/architecture.md) for the data pipeline, the flight model and the
air model, and [docs/physics.md](docs/physics.md) for how the physics works, with diagrams
and charts generated from the model.

## Deploy

Not deployed. It is a static Vite build (`dist/`), so any static host works when it is time.

Terrain: MDT05 and PNOA © [Instituto Geográfico Nacional](https://www.ign.es), CC BY 4.0.
