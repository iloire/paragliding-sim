# Architecture

The prototype is split so the part that matters, the flight and air model, can move to Unreal later
unchanged in behaviour (translated to C++, same tests).

```
src/sim/    pure TypeScript, no three.js, no DOM — unit-tested
src/game/   three.js scene, input, HUD, audio — the throwaway rendering layer
public/sites/<id>/   site.json + generated terrain data
scripts/fetch-terrain.ts   IGN download → height.bin + ortho.jpg + detail tiles
```

## Frames

Sim frame: **x east, y north, z up**, metres, origin at the site bbox's south-west corner.
three.js: `X = x − e/2, Y = z, Z = e/2 − y` (`toScene` in `src/game/world.ts`), centred on the origin.
Heading is a compass bearing in radians (0 = north, clockwise).

## Flight model (`src/sim/glider.ts`, `polar.ts`)

The full explanation, with charts from the real model, is in [physics.md](physics.md).

A point mass under lift, drag and gravity, integrated in wind axes (airspeed V, flight-path
angle γ, heading ψ, lift-vector bank μ; L and D per unit mass):

```
dV/dt = −D − g·sin γ
dγ/dt = (L·cos μ − g·cos γ) / V
dψ/dt = L·sin μ / (V·cos γ)
```

Nothing about the flare, the surge, a wingover or a spiral is scripted: they come out of these
equations as speed and height trade.

- **Lift and drag from the polar.** Lift per unit mass is `LIFT_K·V²·CL` (24 m², 95 kg). The drag
  coefficient at each CL is chosen so a steady glide sinks exactly as the wing's polar says
  (`cdFor`), so straight-line performance per wing class (`src/sim/wings.json`) is unchanged.
- **Pitch.** Brakes and bar pick a target speed, hence a target CL. CL follows it through a damped
  second-order response (the pitch pendulum), plus a speed-stability term that pulls the wing back
  towards its trim speed — that damps the phugoid the way the pilot's weight does.
- **Roll.** Bank is a pendulum (~4.3 s period, lightly damped so a swing keeps its momentum — the
  wingover rhythm). Brake difference + weight shift drive it with an authority that grows with V²,
  so speed from a dive powers the next swing; past 70 % one brake bites much harder. The pilot's
  weight restores it (`sin μ`), with a wall past ~63° that stiffens with load (holds a 3 G spiral,
  lets a wingover's momentum carry past 90°). Above ~55° at high G that restoring moment fades by the wing's
  `spiralTendency`, so a held deep brake winds into a spiral dive.
- **Spiral drag.** Extra drag grows with load factor (the yawed, braked wing and the pilot), so an
  EN-B spiral settles near 75–80° bank, ~3 G, ~10 m/s sink.
- **Gusts and collapses.** A sudden change in vertical air (against a 1 s filtered value) shifts
  the angle of attack. If the load factor drops below 0.3 for 0.15 s, the high side folds:
  less lift, more drag, a roll towards the folded side, reopening after ~2.5 s (faster if you
  pump that side's brake). A sharp down-gust, a badly timed wingover, or swinging past ~125° (too
  far over the wing) causes one.
- **Stall.** Deep symmetric brakes held >1.2 s, or flying far below stall speed: CL collapses and
  drag jumps, the wing drops; hands up to recover.
- **Ground.** Run up to 4.2 m/s; lift-off at 1.1 × stall airspeed (or when the ground drops away),
  leaving at trim speed. Touchdown above 3.5 m/s sink, 11 m/s ground speed or 35° bank is a crash.

Tuning numbers and the expected envelope (EN-B): 0.7 brake turn ≈ 26° bank, 13 s per 360°;
deep brake ≈ 78° / 3.2 G / −10.6 m/s; wingovers pumped in rhythm build past 90° over several
swings, against the rhythm they don't build, overcooked past 125° they fold; flare zooms up at +2 m/s.
`src/sim/glider.test.ts` pins each of these.

## Terrain rendering (`src/game/terrain-view.ts`)

The site is drawn as a grid of square chunks (one per detail tile, 3 km). Every chunk has a coarse
mesh (128² segments, ~23 m) draped with the site-wide photo. A chunk with a detail tile switches,
by camera distance (including height above the ground), to a 10 m mesh under 4.5 km and the
native 5 m mesh under 1.5 km, each with the tile's own 2048² photo (~1.5 m/px). Meshes are built
on demand, one per frame, nearest first, and freed (with the photo) when the camera moves away;
a 20 % hysteresis stops tiles flickering between levels. Every chunk hangs 80 m skirts on its
edges, so a seam between levels shows terrain-coloured wall instead of sky.

The terrain material is a `MeshStandardMaterial` patched in `onBeforeCompile` to add:

- **Grain**: value noise at 0.7, 2.6 and 11 m modulating the colour, and a finer bump in the
  normal, fading out by 700 m / 250 m — the photo is too soft for the last few metres.
- **Lift map**: ridge lift at ridge-top height (`createLiftMap` in `world.ts`), looked up by
  world position and blended over the lit colour when toggled.

Physics uses the same data: `Heightmap.addDetail` registers each tile, and `heightAt` prefers a
tile where one exists, so you touch down on the ground you see.

## Wing and pilot model (`src/game/wing.ts`)

Geometry and how the sim drives it: [physics.md §10](physics.md#10-the-3d-wing-and-pilot).

Procedural, rebuilt per frame so brakes and collapses deform it: elliptical planform with swept
tips on an anhedral arc, NACA-style airfoil, 48 cells with inflated panels, nose intakes and seams;
A/B/C lines cascading in three levels to the risers and brake lines to the toggles; a pod-harness
pilot that stands and runs on the ground, settles seated in flight, and holds the toggles on
two-bone arm IK. The canopy hangs from a pivot at the carabiners, surging ahead and leading
into turns relative to the pilot.

## Air model (`src/sim/wind.ts`, `thermals.ts`)

Explained with diagrams in [physics.md §9](physics.md#9-the-air).

Built on a 512² grid over the site (~82 m cells over the 42 km island bbox), rebuilt only when the wind direction changes:

1. Blur the terrain (σ 120 m), take its gradient, cap the steepness at 0.75 and project it on the
   wind direction. Lift per m/s of wind is that slope — so a 45° cross wind keeps cos 45° ≈ 70 %.
2. Smear positive lift upwind up to 600 m (decay 250 m) — the air starts rising before the face.
3. For every cell, the ridge top the air must climb (max ground 1.5 km downwind) and the foot of
   the slope (min ground 1.5 km upwind). The band is full up to the ridge top and fades out at
   ridge top + 0.7 × relief.
4. The inversion caps the band (fade over 80 m) and, when it sits near or below the ridge top,
   weakens the lift (the flow goes round instead of over).
5. Lee sink near the ground on downward slopes, plus turbulence that is stronger in the lee.

Thermals trigger over land above 30 m, live 6–12 min with a ramp up and down, lean downwind by
the time the air took to climb, have a sink ring, stop at the inversion and mark it with a cumulus.

These rules come from the notes vault's *coastal-soaring-lift-factors* note; the tests in
`src/sim/wind.test.ts` pin each of them on a synthetic cliff.

## Terrain data

`npm run fetch-terrain -- famara` reads `public/sites/famara/site.json` and downloads:

- **Height**: IGN WCS `Elevacion4083_5` (MDT05, 5 m, REGCAN95 / UTM 28N) resampled to 2048² (~20.5 m over the 42 km bbox that covers the whole flyable island),
  3×3 smoothed to hide 1 m terracing, written as Int16 decimetres. Sea (nodata or ≤ 0 m) becomes −15 m.
- **Orthophoto**: IGN WMS `pnoa-ma`, 4096² JPEG over the same bbox.
- **Detail tiles** (`detail` in `site.json`): the bbox cut into `tileM` squares; a tile is fetched
  if it has ≥ 1 % land and its centre is within `radiusM` (per axis) of a launch. Each gets the DEM
  at native 5 m (600², fetched with a one-pixel margin so the smoothing matches across tile edges)
  and a `orthoSize`² photo, as `detail/<col>_<row>.bin|.jpg` (col from the west, row from the
  south), listed in `detail/tiles.json`. Lanzarote (7 launches): 54 tiles, ~65 MB. IGN's WCS offers nothing finer
  than 5 m; the 2 m MDT02 is download-only.

Both are © Instituto Geográfico Nacional, CC BY 4.0 — the attribution is on screen.
