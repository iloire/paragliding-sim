# Architecture

The prototype is split so the part that matters, the flight and air model, can move to Unreal later
unchanged in behaviour (translated to C++, same tests).

```
src/sim/    pure TypeScript, no three.js, no DOM — unit-tested
src/game/   three.js scene, input, HUD, audio — the throwaway rendering layer
public/sites/index.json   the regions the game offers (ids)
public/sites/<id>/   site.json + generated terrain data, one folder per region
scripts/fetch-terrain.ts   IGN download → height.bin + ortho.jpg + detail tiles
```

## Frames

Sim frame: **x east, y north, z up**, metres, origin at the site bbox's south-west corner.
three.js: `X = x − e/2, Y = z, Z = e/2 − y` (`toScene` in `src/game/world.ts`), centred on the origin.
Heading is a compass bearing in radians (0 = north, clockwise).

## Flight model (`src/sim/glider.ts`, `polar.ts`)

The full explanation, with charts from the real model, is in [physics.md](physics.md).

The paraglider is **one rigid body**: the pilot (89 kg) at the bottom of 7.5 m of lines, the
canopy (6 kg plus the air in its cells) at the top, with full attitude and angular velocity
(Newton for the centre of mass, Euler's equations for the rotation, 4 sub-steps per 120 Hz step).
The pendulum is the geometry: lift at the top, mass at the bottom.

- **Canopy as strips.** Six strips along an arched span, each with its own position, tilt, airflow
  (`v + ω × r`) and brake. Lift and drag come from each strip's angle of attack; roll and yaw
  damping, the arc's dihedral, roll into a turn and adverse yaw all fall out of that.
- **From the polar.** Coefficients derive from the wing's speed polar; the rigging angle and a drag
  scale are solved (pitch balance, lift = weight) so a straight glide at trim matches the polar.
- **Brakes** turn a strip's chord nose-up, camber it, add drag, and curl the tip down (the side's
  lift leans out, which is what banks the glider). Braked speeds emerge; the numbers were tuned to
  land near the polar's.
- **Pitch stability** is a moving centre of pressure (aft with angle of attack, far aft past the
  stall); **pitch damping** acts on the canopy's rotation relative to its flight path.
- **Load** is the force the lines put on the pilot. Below 0.3 G for 0.15 s the lines are slack and
  the high side folds (reopens after ~2.5 s, faster if you pump that side).
- **Stall.** Past its stall angle a strip flies like a flat plate; held deep brakes deepen it.
- **Ground.** Run up to 4.2 m/s; lift-off at 1.1 × stall airspeed (or when the ground drops away),
  leaving trimmed at trim speed. Touchdown above 3.5 m/s sink, 11 m/s ground speed or 35° bank is
  a crash.

Envelope (EN-B), pinned by `src/sim/glider.test.ts`: 70 % brake ≈ 28° bank, 14 s per 360°;
80 % held ≈ 80° / 3 G / −12 m/s spiral that exits hands-up; wingovers pumped in the swing's ~6 s
rhythm pass 90° with a load under 1 G at the top; full brakes stall in about a second and recover
hands-up.

## Wing and pilot model (`src/game/wing.ts`)

Geometry and how the sim drives it: [physics.md §10](physics.md#10-the-3d-wing-and-pilot).

Procedural, rebuilt per frame so brakes and collapses deform it: elliptical planform with swept
tips on an anhedral arc, NACA-style airfoil, 48 cells with inflated panels, nose intakes and seams;
A/B/C lines cascading in three levels to the risers and brake lines to the toggles; a pod-harness
pilot that stands and runs on the ground, settles seated in flight, and holds the toggles on
two-bone arm IK. The canopy hangs from a pivot at the carabiners, surging ahead and leading
into turns relative to the pilot. A tandem crew (`src/game/tandem.ts`) can replace the solo pilot:
passenger in front, pilot behind, on spreader bars. `src/game/body.ts` holds what both share:
placing limbs between two points, the arm IK and the standing-to-seated gait.

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

The time of day (`src/sim/sun.ts`, solar time) sets the sun's position and a 0..1 heating that
peaks in the early afternoon. Heating scales thermal climb and count, adds convective turbulence
and lifts cloudbase toward the inversion; a low sun puts the thermals on the slopes facing it
([physics.md](physics.md#the-sun-and-the-time-of-day)). On screen, `Sunlight` in
`src/game/world.ts` drives the sky shader, the sun's light, the fog, the exposure and the cloud
tint from the same sun, so a low sun turns the scene into a sunset.

These rules come from the notes vault's *coastal-soaring-lift-factors* note; the tests in
`src/sim/wind.test.ts` pin each of them on a synthetic cliff.

## Instrument panel (`src/game/hud.ts`, `src/sim/instruments.ts`)

A compact strip (~600×110 px) laid out by what a pilot glances at: the vario (big number and a
vertical ±5 m/s scale), height above ground (amber below 50 m, red below 20 m), then smaller
reference readouts. L/D is a ratio of 4 s averages (ground speed over sink), not an average of
instant ratios, so it recovers straight away on leaving lift. G and bank stay dimmed until a manoeuvre makes them matter (bank over 25°, load outside
0.6–1.8 G). The vario number flashes when climb first passes +2 m/s.

- **Thermal assistant**: the last 30 s of track, heading up, 80 m to the edge, dots sized and
  coloured by climb, with a ring on the best climb so you can shift the circle towards it.
- **Wind rose**: the glider is fixed pointing up at the centre; the arrow sits on the upwind rim and
  points along the flow. The text gives the compass direction the wind comes *from*.
- **Glide to landing**: the nearest field from `landings` in `site.json`, with distance, a bearing
  arrow and the L/D needed to arrive at its height. Green when the current averaged L/D beats it by
  25 %, amber when it just makes it, red when it doesn't. Hidden for a site with no landings.
- **I** cycles full → minimal (vario, AGL, wind) → hidden. Phones get the minimal layout.

The maths (glide-to, track buffer, compass) is pure and tested in `instruments.test.ts`;
`hud.ts` only draws.

## Input (`src/game/input.ts`, `touch.ts`)

Keyboard, gamepad and touch all feed the same `Controls`, taking the strongest of each (brakes,
bar) and summing weight shift, so any can be used mid-flight. Keys are digital and ramp; triggers
and thumbs are analog and used as they are.

**Touch** is on when the main pointer is coarse (`(pointer: coarse)`, phones and tablets). Each half
of the screen is a thumb pad that rests wherever the thumb lands: pulling it down is that brake,
pushing it up runs on the ground and is speed bar in the air, sliding it sideways shifts weight.
A quarter of the screen height is full travel. Small offsets are ignored, and weight shift needs a
bigger slide (`SHIFT_DEAD`) because a thumb drifts sideways while braking. The mapping is the pure
`thumbControls`, unit-tested; `TouchPad` turns pointer events into it and draws the ring and knob.
A row of buttons stands in for the action keys.

On touch the game also waits for a tap before starting (sound, fullscreen and the Android
landscape lock all need one), asks for landscape in portrait, starts the instrument in its
minimal layout, closes the settings panel, and caps the pixel ratio at 1.5. The orbit camera
can't be dragged on touch: the thumb pads take the canvas.

## Regions, launches and the URL

A **region** is one terrain download (`public/sites/<id>/`); its `site.json` names it, gives its
`country` and lists its **launches**. `public/sites/index.json` lists the region ids. At boot
`src/game/catalog.ts` reads the manifest and every `site.json` (≈1 KB each), then the URL picks
what to load: `?region=lanzarote&launch=famara&wind=345/24` (wind = from ° / km/h). Unknown ids
fall back to the first region and launch, so an old link still flies. The game keeps the URL in
step with the current launch and wind (`history.replaceState`), so the address bar is always a
link to the setup.

The site picker (**M**, `src/game/picker.ts`) lists Country › Region › Launch. A launch in the
loaded region switches in place; one in another region sets the URL and reloads, since the
terrain, wind field and lift map are all built for one region. The roadmap (wind wedges, map
picker, sites outside Spain) is in [plan-sites.md](plan-sites.md).

## Terrain data

`npm run fetch-terrain -- lanzarote` reads `public/sites/lanzarote/site.json` and downloads:

- **Height**: IGN WCS `Elevacion<EPSG>_5` (MDT05, 5 m) in the region's `crs` — `4083` (REGCAN95 / UTM 28N)
  for the Canaries, `25830` (ETRS89 / UTM 30N) for the mainland — resampled to 2048² (~20.5 m over
  Lanzarote's 42 km bbox, ~14.6 m over Loarre's 30 km, ~11.7 m over the 24 km Pyrenean ones), 3×3
  smoothed to hide 1 m terracing, written as Int16 decimetres. Sea (nodata or ≤ 0 m) becomes −15 m.
  IGN offers no `25831` coverage, so Castejón, Àger and Organyà (all in zone 31) use zone 30 extended
  east: < 0.2 % scale error, and grid north sits ~3° off true north there.
  **Int16 decimetres stop at 3276.7 m**, and `fetch-terrain` refuses anything higher rather than
  let it wrap; Castejón's bbox stops south of Aneto and Posets for that reason (its top is 3046 m).
- **Orthophoto**: IGN WMS `pnoa-ma`, 4096² JPEG over the same bbox.
- **Detail tiles** (`detail` in `site.json`): the bbox cut into `tileM` squares; a tile is fetched
  if it has ≥ 1 % land and its centre is within `radiusM` (per axis) of a launch. Each gets the DEM
  at native 5 m (600², fetched with a one-pixel margin so the smoothing matches across tile edges)
  and a `orthoSize`² photo, as `detail/<col>_<row>.bin|.jpg` (col from the west, row from the
  south), listed in `detail/tiles.json`. Lanzarote (7 launches): 54 tiles, ~65 MB. IGN's WCS offers nothing finer
  than 5 m; the 2 m MDT02 is download-only.

`landings` in `site.json` is a list of `{ id, name, lat, lon }` like `launches`; the ground height
comes from the DEM. The Famara beach landing (29.114, −13.56) was placed on the flat 5 m ground
behind Playa de Famara on the DEM; check it against the local landing before trusting it.

Both are © Instituto Geográfico Nacional, CC BY 4.0 — the attribution is on screen.

**Beyond the bbox.** An island region is surrounded by open sea: the heightmap returns the sea
floor outside it and the terrain's last 700 m slope down into the water. An inland region sets
`plainM` in `site.json`: outside the bbox is then dry ground at that height, the terrain edge
slopes down to it, and a flat land-coloured ring with a hole for the site replaces the sea out to
the horizon (a full plane would bury any valley floor below `plainM`). Set it near the 10th
percentile of the heights along the bbox edge: Loarre 450, Castejón 1000, Àger 450, Organyà 800 m.

**Launch headings.** A launch faces the steepest descent around it in the DEM unless `site.json`
gives `headingDeg`. Pin it where that disagrees with the published orientation (Rials, Pedras
Blancas and Liri at Castejón, Prats at Organyà).
