# Changelog

## 2026-10-18 11:40 UTC — Legs push the speed bar

- You can see the pilot push the bar: at trim the bent knees make two bumps in the top of the cocoon; on bar the legs straighten, the bumps flatten and ride forward, and the pod's nose goes forward with the feet (45 cm on full bar). It follows the pilot's actual push, fed in as the wing picks up speed.

## 2026-10-18 11:20 UTC — Speed bar flown like a pilot

- Pushing the speed bar no longer dives the glider to −4–6 m/s and then swings it back up nearly to a climb. The pilot feeds the bar in as the wing picks up speed and flies it actively, so the sink steps to the bar's rate (EN-B: 1.1 → 2.1 m/s on full bar, about +1 m/s) and stays there while the speed builds. Letting go pitches the wing back for a moment and it returns to trim within about 6 s, without the old +2 m/s zoom.
- Glides on bar now match the polar: the drag scale is solved at full bar as well as at trim. The EN-B was 0.2 m/s short of its full-bar sink.

## 2026-10-18 04:20 UTC — Orbit camera by default

- The game starts in the orbit camera, off the pilot's right shoulder, so the wing and harness are in view and the mouse can look around them. **C** still cycles orbit → chase → pilot. A reset or air start puts the orbit camera back behind the shoulder.

## 2026-10-18 04:10 UTC — Submarine pilot

- The pilot flies an Ozone Submarine-style harness: a blue hull lofted from rounded-box sections, with a blunt cocoon over the feet, an open cockpit, a tall fairing rising behind the head to a cut-off tail, and a keel under it. On the ground the fairing hangs deflated off the pilot's back.
- A white full-face helmet with a smoked visor, a black vest and tan gloves replace the red open helmet and the dark suit.
- The brake handles hang at chin height by the risers instead of above the head, so the arms no longer reach straight up: the elbows drop and the hands come down to the hips at full brake.

## 2026-10-18 02:05 UTC — Phones and tablets

- **Touch controls**: a thumb pad on each half of the screen, resting wherever the thumb lands. Pull it down to brake that side (analog, a quarter of the screen height is full travel), push it up to run and for speed bar, slide it sideways to shift weight. A ring and knob show where each thumb is. A row of buttons replaces the action keys: camera, air start, reset, sites, instrument, pause.
- On a touch screen the game waits for a tap before it starts, which unlocks the vario sound, fullscreen and the Android landscape lock. In portrait it asks you to turn the phone. The instrument starts minimal, the settings panel starts closed and the attribution moves under the instrument.
- The pixel ratio is capped at 1.5 on touch screens (from 2): a 3x phone was rendering pixels it can't show.
- Sound resumes if iOS created it suspended.

## 2026-10-18 04:00 UTC — Time of day and sunsets

- **Time of day** panel: a solar-time slider (05:00–21:00) and Sunrise / Morning / Midday / Afternoon / Sunset presets. `?time=HH:MM` starts at that time, and the address bar follows. Without it a flight starts at 13:00, the thermals' peak, so the weather sliders behave as before.
- The sun is placed from the region's latitude, today's date and the hour (`src/sim/sun.ts`), and gives a heating factor that peaks in the early afternoon. Heating scales thermal climb and how many thermals are alive, adds convective turbulence (about ±1 m/s at the peak with 2 m/s thermals, none in the evening) and lifts cloudbase from 75 % of the inversion to the inversion.
- A low sun puts the thermals on the slopes facing it; slopes in their own shade trigger none.
- Sunsets: the sky shader, the sun's light colour and angle, the fog, the exposure, the ambient light and the cumulus tint all follow the sun, so near the horizon the sky glows orange and the wing is backlit. The aerial photo's midday shading is baked in, so there are no long sunset shadows yet.
- The weather panel's turbulence slider is now **Wind turbulence**: the mechanical kind, separate from the thermals' own.

## 2026-10-18 03:55 UTC — Castejón de Sos, Àger and Organyà

- Three Pyrenean regions, 24 km IGN bboxes each, launches from ParaglidingEarth: **Castejón de Sos** (Rials, Chía – Abedules, Pedras Blancas, Liri), **Àger** (Sant Alís, Àger) and **Organyà** (Organyà, Santa Fe, Prats, Narieda). They sit in UTM zone 31, which IGN's WCS does not serve, so they use zone 30 extended east.
- `fetch-terrain` refuses heights above 3276 m instead of letting the Int16 decimetres wrap; Castejón's bbox stops south of Aneto and Posets.
- The inland plain is now a ring around the site instead of a full plane, so valley floors below `plainM` are no longer buried. Plain heights set from each region's edge heights.
- Launch headings pinned where the DEM's steepest slope disagrees with the published orientation (Rials, Pedras Blancas, Liri, Prats).

## 2026-10-18 03:30 UTC — Loarre, the first mainland region

- New region `loarre` (Huesca Pre-Pyrenees): a 30 km IGN bbox in ETRS89 / UTM 30N with the Loarre (1277 m, S–SW) and Tiacuto launches from ParaglidingEarth, plus detail tiles around both. Default weather is a light southerly thermal day with the inversion at 2600 m.
- Inland regions: `plainM` in `site.json` puts flat land at that height beyond the bbox instead of open sea, in the physics (no ditching off the edge) and on screen (the edge slopes down to a farmland-coloured plane).
- Picking a launch in another region no longer carries the current wind across; the new region starts with its own weather.
- The inversion slider goes up to 4000 m, for mountain sites.

## 2026-10-18 03:10 UTC — Site picker and deep links

- Sites are now regions: `public/sites/famara/` is `public/sites/lanzarote/`, and `public/sites/index.json` lists the regions the game offers. `site.json` gains `country`.
- **M** opens a site picker (Country › Region › Launch; arrows, Enter, Esc). A launch in the loaded region switches in place; another region reloads with its terrain. The sim pauses while it is open.
- Deep links: `?region=lanzarote&launch=mala&wind=300/18`. The URL follows the current launch and wind; unknown ids fall back to the first region and launch.
- `docs/plan-sites.md`: the plan for more regions inside and outside the Canaries (wind wedges, map picker, data sources, storage).

## 2026-10-18 01:33 UTC — Instrument panel rework

- Laid out by priority in a compact strip (~600×110 px, down from ~790×160): big vario with a vertical ±5 m/s scale, then AGL large, then smaller reference readouts; flight time moved to a footer row.
- AGL turns amber below 50 m and red below 20 m. G and bank are dimmed in straight flight and light up past 25° bank or outside 0.6–1.8 G.
- Thermal assistant: the last 30 s of track heading-up, coloured by climb, with the best climb ringed.
- Wind rose with the glider fixed at the centre and the arrow along the flow; wind shown as the compass direction it comes from (e.g. NNW 24 km/h).
- Glide to landing: nearest field from the new `landings` list in `site.json` (Playa de Famara), with distance, bearing and the L/D needed, graded green/amber/red against the current L/D.
- L/D is now a ratio of 4 s averages (ground speed over sink) instead of an average of instant ratios, which snapped to ∞ in a moment of lift and then took seconds to come down from ~70 — showing ∞ (and the landing readout green) while sinking.
- Vario flashes when climb first passes +2 m/s. **I** cycles the panel full → minimal → hidden; phones get the minimal layout.

## 2026-10-18 01:32 UTC — Rigid-body flight model

- The glider is now one rigid body: pilot (89 kg) at the bottom of 7.5 m of lines, canopy (6 kg plus its trapped air) at the top, with full attitude and angular velocity. The pendulum is the geometry, not a tuned oscillator.
- The canopy is six strips on an arched span, each with its own airflow, angle of attack and brake. Roll and yaw damping, the arc's dihedral stability, roll into a turn and adverse yaw come out of the strips. A brake drags, cambers and curls its tip down, which banks the glider; weight shift moves the pilot sideways.
- Coefficients and rigging are derived from each wing's polar (straight glides match it). Pitch stability is a moving centre of pressure; past the stall strips fly like a flat plate, so stalled wings recover hands-up.
- The load is the force the lines put on the pilot: the top of a well-pumped wingover goes light (< 1 G), and slack lines fold a side. The old bank threshold for "over the wing" is gone.
- EN-B: 70 % brake ≈ 28°; 80 % held ≈ 80° / 3 G / −12 m/s spiral that exits hands-up; wingovers in the ~6 s rhythm pass 90°. EN-A resists spirals, EN-C spirals sooner. The flare is softer (+0.5 m/s): the canopy pitches back as it slows.
- The 3D model is posed from the body's attitude; the cosmetic canopy swing is gone. Physics doc, architecture doc, figures, README screenshot and tests updated; plan marked done.

## 2026-10-17 23:23 UTC — Wingovers: momentum and timing

- Roll pendulum damping 0.28 → 0.18, so a swing keeps most of its momentum into the next.
- Roll authority grows with V² (dynamic pressure) instead of V, capped at 2.2× trim: the speed from diving out of one swing powers the next pull.
- The pendulum wall past 63° stiffens with load (9 per G), so a 3 G spiral is still held near 78° but a wingover's momentum carries the pilot past 90°, over the wing.
- Swinging past 125° (too far over the wing) folds the high side. EN-B builds to ~100° at 60 % brake pumped in rhythm and folds when pumped at full brake; EN-C folds at 85 %; the EN-A school wing tops out near 120°.
- Tests pin it: rhythm builds past 95° over several swings, pumping against the swing stays under 20°, full-brake pumping folds. Physics doc, figures and tuning tables updated.
- Known gap: the top of the swing stays at 2–3 G; a light top needs the two-body canopy + pilot model.

## 2026-10-17 23:12 UTC — Red wing, pod the right way round, a real head

- The pod harness pointed backwards: its pointed foot now sits out front under the instrument deck, with the rounded back protector behind the pilot.
- The pilot has a head: a face with wraparound glasses under a red open-shell helmet with a white centre stripe and a camera mount.
- The wing is red with two white chevrons per side and a darker trailing edge.
- Switching to the orbit camera starts off the pilot's right shoulder instead of inside the helmet.

## 2026-10-17 23:03 UTC — Wing planform the right way round

- The canopy's trailing edge is now nearly straight and the leading edge sweeps back about 2 m to the tips, like a real paraglider. Before, the front was flat and the back curved, which is backwards. The physics doc and wing diagram are updated to match.

## 2026-10-17 22:21 UTC — Start in the air

- The game starts with an air start above the first launch, and switching launch (N or the panel) air-starts too. R still resets to the ground at the launch for take-off practice.

## 2026-10-17 22:18 UTC — Physics documentation

- `docs/physics.md`: how the flight model, the air and the 3D wing/pilot work, with hand-drawn diagrams and charts generated by running the sim (`npm run physics-figures`).

## 2026-10-17 22:15 UTC — Tenesar, El Cuchillo, Macher and Playa Quemada

- Four new launches (coordinates from ParaglidingEarth): Tenesar, El Cuchillo, Macher, Playa Quemada.
- Site bbox grown from 24 km to 42 km (616–658 km E, 3193–3235 km N) so the whole flyable island fits; the site is now named "Lanzarote". Base heightmap ~20.5 m (was ~11.7 m), lift grid ~82 m.
- Detail tiles regenerated on the new grid: 54 tiles (~65 MB) around all seven launches.

## 2026-10-17 22:03 UTC — Terrain detail near the launches

- 25 detail tiles (3 km) around Famara, Mala and Mirador: native 5 m heights and 1.5 m/px PNOA photo, fetched by `npm run fetch-terrain -- famara --detail`.
- Terrain rendered as chunks with distance LOD (23 m → 10 m → 5 m mesh), built and freed on demand, with skirts hiding the seams.
- Close-up grain and bump in the terrain shader; the lift map is now drawn by the terrain shader instead of a second mesh.
- Physics (ground contact, launch heights, camera clamp) uses the 5 m data where it exists.

## 2026-10-17 20:15 UTC — Acro physics and new wing/pilot models

- Flight model rewritten as a lift/drag/gravity point mass in wind axes: energy trades on its own, so flares, surges, wingovers and spiral dives come out of the physics.
- Roll pendulum with speed-dependent authority, deep-brake bite, a pendulum wall and per-wing spiral tendency (EN-B spiral ≈ 78°, 3 G, −10 m/s; EN-C locks harder).
- Gust-driven angle of attack and asymmetric collapses on unloading (fold, turn, reopen; pump to help).
- New procedural canopy (planform, arc, airfoil, inflated cells, intakes, seams), cascaded A/B/C and brake lines, pod-harness pilot with standing/running/seated poses and arm IK on the brake toggles.
- HUD shows G and bank; Shift + A/D is a deep brake.

## 2026-10-17 19:55 UTC — Browser prototype

- Famara terrain from IGN open data (MDT05 height model + PNOA orthophoto), fetched by `npm run fetch-terrain`.
- Flight model: speed polar per wing class (EN-A/B/C), pitch and roll pendulums, stall, takeoff run, launch grace, landing/crash/water.
- Air model: ridge lift from the terrain slope (cos off-angle law, soaring band, inversion lid), lee sink, procedural thermals with cumulus, turbulence.
- three.js world: draped terrain, sea, sky, procedural wing with brake deformation, chase/pilot/orbit cameras.
- Vario audio ported from the esp32-vario firmware, wind noise, HUD, lift map, IGC export, keyboard + gamepad.
