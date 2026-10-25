# Ideas: maybe one day

Educational features that would build on real data we have or could get for free. Nothing here is
planned or promised. When one gets picked up, it gets its own `plan-*.md` and its line here is
struck through with a link to that plan.

Roughly in order of value for the effort.

## 1. Launch wind roses and landing fields

ParaglidingEarth, where the launch coordinates came from, also rates every take-off for each of the
8 wind directions (0–2) and lists the official landing fields. We only kept the coordinates (and
one landing, Playa de Famara).

- Show each launch's real wind rose against the current wind: "Famara: good in NW, unflyable in S".
  The weather dialog's flyable sector today is a fixed band around the launch heading
  (`weather-panel.ts`); local pilots' ratings would replace it with what actually works there.
- Put all the official landing fields on the map, in `site.json` `landings`.
- Teaches site selection, the first thing a pilot learns.

**Data:** ParaglidingEarth, already used. **Effort:** small.

## 2. Real weather days

Open-Meteo (free, no key) has forecasts and history for any point: wind at several heights, the
temperature profile, cloud cover. Load "today at Famara" or a memorable past day, and derive the
sim's weather from real meteorology instead of presets:

- inversion height from the temperature profile,
- thermal strength from the lapse rate,
- cloud base from (temperature − dew point) × 125 m.

A "why is today like this" panel ties what pilots read in a forecast to what they feel in the air.
This would feed the existing weather dialog (`weather-presets.json`) as one more source.

**Data:** Open-Meteo forecast and archive APIs. **Effort:** medium. The most educational of these.

## 3. Real airspace

Lanzarote airport's controlled zone sits right over Macher and Playa Quemada, and Tenerife has two
airports near its launches. Draw the real boundaries and heights in 3D and warn on infringement.
A real safety lesson, specific to these sites.

**Data:** OpenAIP (free key) or ENAIRE (Spain's official AIP data). **Effort:** medium.

## 4. Hazards from OpenStreetMap

Power lines are the classic killer, plus roads, villages and the sea. Show them near landings and
fold them into the landing check: "touchdown 40 m from a power line".

**Data:** OSM via the Overpass API (free). **Effort:** medium.

## 5. Polar and speed-to-fly

`wings.json` already holds real polar figures per wing class. A live polar diagram in the HUD with
your current point on the curve, plus a speed-to-fly (MacCready) ring: fly faster in sink and into
a headwind. Theory every cross-country pilot needs.

**Data:** none new. **Effort:** small.

## 6. Ghost replays of real flights

We already export IGC. Replay a real flight as a ghost glider over the same terrain to compare
lines, or race it. Your own tracks (e.g. from the esp32-vario) are the easy source; XContest
needs a login.

**Data:** IGC files. **Effort:** medium.

## Smaller ones, also grounded in what we have

- **Sun and thermal triggers:** shade slopes by how much sun they get now (`sun.ts` `heating`), so
  you can see which faces trigger thermals at this time of day.
- **G and line-load coach:** the rigid-body model gives the real line load. Explain it live in
  spirals and wingovers, and score manoeuvres (bank, timing, light top).
- **Glide cone / reachability:** from the polar, the wind and the terrain, shade where you can
  still reach a landing.
- **IGC analysis:** climb rate per thermal, how well you centred, time on glide versus climbing.
- **Landing patterns:** draw a downwind, base and final for each landing field from the real
  terrain and wind.
