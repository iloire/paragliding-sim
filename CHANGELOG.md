# Changelog

## 2026-10-17 22:15 UTC — Acro physics and new wing/pilot models

- Flight model rewritten as a lift/drag/gravity point mass in wind axes: energy trades on its own, so flares, surges, wingovers and spiral dives come out of the physics.
- Roll pendulum with speed-dependent authority, deep-brake bite, a pendulum wall and per-wing spiral tendency (EN-B spiral ≈ 78°, 3 G, −10 m/s; EN-C locks harder).
- Gust-driven angle of attack and asymmetric collapses on unloading (fold, turn, reopen; pump to help).
- New procedural canopy (planform, arc, airfoil, inflated cells, intakes, seams), cascaded A/B/C and brake lines, pod-harness pilot with standing/running/seated poses and arm IK on the brake toggles.
- HUD shows G and bank; Shift + A/D is a deep brake.

## 2026-10-17 21:55 UTC — Browser prototype

- Famara terrain from IGN open data (MDT05 height model + PNOA orthophoto), fetched by `npm run fetch-terrain`.
- Flight model: speed polar per wing class (EN-A/B/C), pitch and roll pendulums, stall, takeoff run, launch grace, landing/crash/water.
- Air model: ridge lift from the terrain slope (cos off-angle law, soaring band, inversion lid), lee sink, procedural thermals with cumulus, turbulence.
- three.js world: draped terrain, sea, sky, procedural wing with brake deformation, chase/pilot/orbit cameras.
- Vario audio ported from the esp32-vario firmware, wind noise, HUD, lift map, IGC export, keyboard + gamepad.
