# Plan: a welcome screen over the live landscape

Today the game opens on a dark "FAMARA GLIDE · Loading terrain…" card and drops you 120 m over the
launch, already flying. Site choice hides behind **M**, time of day, wing and pilot behind lil-gui.
The welcome screen puts all of that in one menu, laid over the real scene: the camera slowly
circles the chosen launch while a wing soars the ridge, and every choice changes what you see.

Inspiration: the title screen of *Updraft* (themaserbutcher.github.io/Updraft). Its code is
"all rights reserved", so this borrows the idea only — nothing from its source.

## Decisions

- **Backdrop:** orbiting camera first, then a wing soaring the ridge on autopilot.
- **Scope:** the menu replaces the site picker and the flight half of lil-gui. **Esc / M** in
  flight pauses and brings it back. lil-gui keeps only weather tuning.
- **Title:** stays *Famara Glide*; the region is the subtitle.

## The screen

```
┌──────────────────────────────────────────────────────────────┐
│                (live 3D: camera circling the launch)         │
│                                                              │
│  LANZAROTE · SPAIN                          ┌──────────────┐ │
│  FAMARA GLIDE                               │ HOW TO FLY │ │ │
│  ‹  Famara — Las Bajas  ›                   │ SITES        │ │
│  [WIND NE 22] [THERMALS 2 m/s] [INV 1200 m] │ (tab body)   │ │
│  [Sunrise][Morning][Midday][Afternoon][Sunset]│            │ │
│  Wing ‹ EN-B ›  Pilot ‹ Solo ›  [stats]     └──────────────┘ │
│  [ FLY → ]  [ TAKE OFF ]                         a1b2c3d     │
└──────────────────────────────────────────────────────────────┘
```

- **Launch ‹ ›** — cycles the region's launches; the camera glides to the new one (same terrain,
  no reload). The **Sites** tab lists every region; another region reloads, and says how big it is.
- **Time chips** — the existing `PRESETS` through `setTime()`: sun, light and cloud tint move live.
- **Wing / pilot** — `Polar` stats as chips (trim, top speed, best L/D, min sink); `model.setCrew`
  swaps solo/tandem on the wing you are looking at.
- **Condition chips** — from the region's `weather` (or `?wind=`), so a link's setup shows.
- **FLY** — starts in the air as `reset()` does now. **TAKE OFF** — standing on launch, hold W to run.
- **How to fly** — the `#help` table moves here; in flight it starts collapsed.
- **Phones** — the FLY tap is the gesture that unlocks audio, fullscreen and the landscape lock,
  replacing the "Tap to fly" card. Layout stacks; the side panel becomes a sheet.
- Deep links (`?region=…&launch=…&time=…`) open the menu preselected rather than skipping it.

## The hand-off

FLY fades the menu and swoops the camera from its orbit into the chase seat over ~1.5 s, sim
running, so there is no cut. Esc / M pauses, and the camera eases back out into the orbit.

## Build

1. ~~Worktree `welcome-screen`~~ ✅
2. ~~**`src/game/welcome.ts`** — DOM overlay in the style of `picker.ts`: render, keyboard
   (arrows, Enter = FLY, Tab between rows), callbacks `onLaunch`, `onTime`, `onWing`, `onCrew`,
   `onRegion`, `onFly(mode)`. Absorbs `picker.ts` (Sites tab) and the `#help` table.~~ ✅ (plus a Weather tab, with *Change weather* / *All sites* buttons)
3. ~~**`CameraRig` showcase mode** — orbit around a target at radius/height/rate, `glideTo(target)`
   for launch changes, and a blend into the flight camera for the hand-off.~~ ✅
4. ~~**`main.ts` menu state** — `mode: 'menu' | 'flying'`; in menu the sim is paused (step 1) or
   flown by the autopilot (step 5), input goes to the menu, HUD hidden.~~ ✅
5. **Autopilot** — steer figure-eights along the ridge in the lift band: a target heading that
   flips at the beat ends, brakes from heading error. Pure function in `src/sim/`, unit tested
   (stays airborne over N minutes at Famara in the default weather).
6. **First paint** — show the menu over a still of the region while terrain loads, then crossfade
   into the live scene.
7. Tests for the menu's state logic; README controls + screenshot retaken; CHANGELOG; GA event
   for which start button was used.

First cut to look at: steps 2–4 with a static wing, then 5 and 6.

## Open questions

- Does the autopilot wing stay in the scene after FLY (an AI buddy), or is it you? Plan: it *is*
  you — FLY hands its state to the player, so the swoop lands behind a wing already flying.
- Orbit radius per launch: a fixed 700 m suits Famara; Pyrenees launches may need a `menuView`
  hint in `site.json`.
