# Architecture

The prototype is split so the part that matters, the flight and air model, can move to Unreal later
unchanged in behaviour (translated to C++, same tests).

```
src/sim/    pure TypeScript, no three.js, no DOM — unit-tested
src/game/   three.js scene, input, HUD, audio — the throwaway rendering layer
public/sites/<id>/   site.json + generated terrain data
scripts/fetch-terrain.ts   IGN download → height.bin + ortho.jpg
```

## Frames

Sim frame: **x east, y north, z up**, metres, origin at the site bbox's south-west corner.
three.js: `X = x − e/2, Y = z, Z = e/2 − y` (`toScene` in `src/game/world.ts`), centred on the origin.
Heading is a compass bearing in radians (0 = north, clockwise).

## Flight model (`src/sim/glider.ts`, `polar.ts`)

- **Polar**: `sink(v) = minSink + k·(v − vMinSink)²`, `k` fixed so trim sink is min sink + 0.1 m/s,
  plus a steep mush term in the last ~20 % above the stall. Wing classes live in `src/sim/wings.json` (km/h).
- **Controls → airspeed**: symmetric brake pulls the target from trim to just above the stall,
  the speed bar pushes it to top speed. Airspeed follows the target through a damped second-order
  response (ω 2.0, ζ 0.5): the surge and pitch-back.
- **Turning**: brake difference + weight shift set a target bank; bank follows through another
  second-order response (ω 1.8, ζ 0.4), which is the swing. Turn rate = g·tan(bank)/V; sink grows
  with 1/cos(bank)^1.5.
- **Energy**: half of the airspeed lost to a deceleration turns into height (the flare), and vice versa,
  except in the 2.5 s launch grace.
- **Ground**: run up to 4.2 m/s; lift-off when airspeed (run + headwind) reaches 1.1 × stall, or
  the ground drops away. Touchdown above 3.5 m/s sink or 11 m/s ground speed is a crash.

## Air model (`src/sim/wind.ts`, `thermals.ts`)

Built on a 512² grid over the site (~47 m cells), rebuilt only when the wind direction changes:

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

- **Height**: IGN WCS `Elevacion4083_5` (MDT05, 5 m, REGCAN95 / UTM 28N) resampled to 2048² (~11.7 m),
  3×3 smoothed to hide 1 m terracing, written as Int16 decimetres. Sea (nodata or ≤ 0 m) becomes −15 m.
- **Orthophoto**: IGN WMS `pnoa-ma`, 4096² JPEG over the same bbox.

Both are © Instituto Geográfico Nacional, CC BY 4.0 — the attribution is on screen.
