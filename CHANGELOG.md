# Changelog

## 2026-10-17 21:55 UTC — Browser prototype

- Famara terrain from IGN open data (MDT05 height model + PNOA orthophoto), fetched by `npm run fetch-terrain`.
- Flight model: speed polar per wing class (EN-A/B/C), pitch and roll pendulums, stall, takeoff run, launch grace, landing/crash/water.
- Air model: ridge lift from the terrain slope (cos off-angle law, soaring band, inversion lid), lee sink, procedural thermals with cumulus, turbulence.
- three.js world: draped terrain, sea, sky, procedural wing with brake deformation, chase/pilot/orbit cameras.
- Vario audio ported from the esp32-vario firmware, wind noise, HUD, lift map, IGC export, keyboard + gamepad.
