# Flight physics

How the simulator decides where the glider goes: the flight model in `src/sim/glider.ts` and
`polar.ts`, the air in `src/sim/wind.ts` and `thermals.ts`, and the 3D wing and pilot in
`src/game/wing.ts` that show it.

Most charts here come from **running the real sim code** (`npm run physics-figures`, see
[Regenerating the figures](#regenerating-the-figures)), so they show what the model does, not what
we hoped it does. The concept diagrams are drawn by hand.

**Contents**

1. [The big picture](#1-the-big-picture)
2. [How the pilot and paraglider are modelled](#2-how-the-pilot-and-paraglider-are-modelled)
3. [Forces and the equations of motion](#3-forces-and-the-equations-of-motion)
4. [The polar: making each wing class fly like its spec](#4-the-polar-making-each-wing-class-fly-like-its-spec)
5. [Pitch: brakes, speed bar and the pitch pendulum](#5-pitch-brakes-speed-bar-and-the-pitch-pendulum)
6. [Roll: turns, spirals and wingovers](#6-roll-turns-spirals-and-wingovers)
7. [Stalls, gusts and collapses](#7-stalls-gusts-and-collapses)
8. [On the ground: take-off and landing](#8-on-the-ground-take-off-and-landing)
9. [The air](#9-the-air)
10. [The 3D wing and pilot](#10-the-3d-wing-and-pilot)
11. [Tuning constants](#11-tuning-constants)
12. [Limits and known gaps](#12-limits-and-known-gaps)
13. [Regenerating the figures](#regenerating-the-figures)

---

## 1. The big picture

The browser loop in `src/main.ts` runs the physics at a **fixed 120 Hz**, however fast the
screen refreshes. Each frame it adds the elapsed time to an accumulator and calls `stepGlider()`
in steps of exactly 1/120 s until the accumulator is spent (capped at 0.25 s, so a stalled tab
doesn't fast-forward the flight). A fixed step means the same inputs always produce the same
flight, on a 60 Hz laptop or a 144 Hz monitor, and the tests can assert exact behaviour.

Each step is split into four sub-steps (480 Hz) for the rigid body
([§3](#3-forces-and-the-equations-of-motion)).

**Coordinate frame.** x points east, y north, z up, in metres, with the origin at the site's
south-west corner. Heading is a compass bearing in radians (0 = north, clockwise). The renderer
converts to three.js axes in `toScene()` (`src/game/world.ts`); the physics never sees them.

**The split.** `src/sim/` is plain TypeScript with no three.js and no DOM. It holds the part
that has to move to the Unreal build unchanged, and it is the part the unit tests cover.
`src/game/` only draws what the sim says.

---

## 2. How the pilot and paraglider are modelled

A real paraglider is a canopy and a pilot joined by about 7 m of lines. The pilot carries most of
the mass and hangs well below the wing. The sim models it as **one rigid body**, canopy, lines and
pilot together, with a full attitude (a quaternion) and angular velocity:

| What | How the sim represents it |
|---|---|
| The pilot | A point of 89 kg at the bottom of the lines, with his own drag (0.5 m²) |
| The canopy | 6 kg (its weight) plus ~5 kg of air in its cells (inertia only), 7.5 m above the pilot |
| The canopy's aerodynamics | **Six strips** along an arched span (11 m of arc, 24 m², ~108° of arc on the EN-B). Each has its own position, tilt and brake |
| Mass and inertia | 100 kg inertial, 95 kg weight; centre of mass 0.8 m above the pilot; inertia from where the masses sit |
| Wing class (EN-A/B/C) | The speed polar (§4), plus spiral tendency (how deep the arc is) and roll authority (how far a brake curls the tip) |
| The load the pilot feels | The force the lines must put on him to give him his acceleration, along the lines, over his weight |

Because the mass is at the bottom and the lift at the top, the **pendulum is the geometry
itself**: nothing in the code says "swing". Surges, the canopy pitching back on a hard flare, the
pilot swinging out in a turn and back under the wing when he lets go all come from forces on a
rigid body.

**The state** (`GliderState`): the body's centre of mass, velocity, attitude and angular velocity;
derived values for the HUD and the 3D model (pilot position, airspeed, flight-path angle, heading,
bank of the lines about the path, body yaw/pitch/roll, load, mean CL and angle of attack); and
flags for phase, stall, collapse side and spiral.

---

## 3. Forces and the equations of motion

Each strip sees **its own airflow**: the body's velocity plus its rotation at that point
(`v + ω × r`), minus the wind there. From the flow in its own plane (chord and its tilted normal)
it gets an angle of attack, and from that lift (across the flow) and drag (against it), with
coefficients derived from the polar (§4). Flow along the span adds a small drag: the arched
canopy acting as a fin.

![Forces on the glider, side view](physics/forces.svg)

The forces and their moments about the centre of mass (the strips, the pilot's drag and weight at
his point, the canopy's weight at its own) drive Newton for the centre of mass and Euler's
equations for the rotation:

```
m · dv/dt = Σ F
I · dω/dt = Σ (r × F) − ω × (I·ω)
```

Banking is the body rolling: every strip's lift tilts with it, and the horizontal part turns you.

![Bank tilts the lift, rear view](physics/bank.svg)

### Why nothing is scripted

- **Damping comes from the strips.** Rolling, the descending half meets the air at a higher angle
  and lifts more; yawing, the advancing half drags more. Roll and yaw damping, and roll into a
  turn from the yaw rate, fall out of each strip having its own airflow.
- **Pitch stability is a centre of pressure.** Each strip's lift and drag act at a point on its
  chord that moves aft as the angle of attack rises above trim, and far aft past the stall. Real
  forces at a real point can't create energy; an earlier attempt that used pseudo-moments did,
  and pumped energy into spins.
- **Pitch damping** resists the canopy pitching *relative to its airflow*: the body's pitch rate
  minus the rotation of its flight path, so a steady turn or a pull-up isn't damped as if the
  canopy were tumbling.
- **Turns.** A brake drags its side (yaw), cambers it, and curls its tip down so that side's lift
  leans out: the canopy is pushed towards the braked side and the glider banks. The arc's dihedral
  (its lift passes through the arc's centre, above the centre of mass) rolls it back level.

### Integration details

The physics steps at 120 Hz in four sub-steps (semi-implicit Euler; the quaternion is
renormalised each sub-step). The body is placed in trimmed straight flight at an air start or
lift-off. One guard: the flight path's rotation used by the pitch damper is bounded to 2 rad/s,
so a near-vertical tumble can't feed it.

Position is the pilot's point. Vertical speed over the ground includes the air's own motion, which
is what the vario hears.

---

## 4. The polar: making each wing class fly like its spec

Paraglider performance is published as a **speed polar**: sink rate against airspeed. The sim
starts from six numbers per wing (`src/sim/wings.json`, in km/h):

| Wing | Stall | Min sink | at | Trim | Top (full bar) | Spiral tendency | Roll authority |
|---|---|---|---|---|---|---|---|
| EN-A school | 21 | 1.05 m/s | 30 | 36 | 46 | 0.55 | 0.6 |
| EN-B intermediate | 22 | 1.00 m/s | 32 | 38 | 52 | 0.85 | 0.7 |
| EN-C sport | 24 | 0.95 m/s | 34 | 40 | 58 | 1.3 | 0.8 |

`Polar.sink(V)` turns those into a curve: a parabola through min sink, sitting 0.1 m/s lower than
the sink at trim, plus a steep "mush" term in the last 20 % before the stall:

```
sink(V) = minSink + c·(V − V_minSink)² + 5·mush²        mush: 0 above 1.2 × stall, 1 at 0.8 × stall
```

![Speed polar and glide ratio for the three wings](physics/polar.svg)

### From the polar to lift and drag coefficients

The force model needs CL and CD, not a sink curve. The polar gives them directly:

1. In a steady glide, lift balances weight, so **CL = g / (K·V²)**. Each airspeed has exactly
   one CL, and vice versa.
2. In a steady glide, sink/V = D/L = CD/CL, so **CD = CL · sink(V) / V**.

`Polar.cdFor(CL)` runs those two steps backwards: from a CL it finds the speed it flies at, reads
the sink there, and returns the CD that reproduces it. **A straight glide therefore matches the
spec exactly**, and the tests check that (`glider.test.ts`, "glides at the polar ratio").

Worked numbers at trim, from the code:

| Wing | Trim | CL | CD | Sink | Glide (L/D) | CL max (at stall) | Sink at full bar |
|---|---|---|---|---|---|---|---|
| EN-A | 36 km/h | 0.647 | 0.0744 | 1.15 m/s | 8.7 | 1.90 | 1.76 m/s |
| EN-B | 38 km/h | 0.581 | 0.0605 | 1.10 m/s | 9.6 | 1.73 | 2.11 m/s |
| EN-C | 40 km/h | 0.524 | 0.0495 | 1.05 m/s | 10.6 | 1.46 | 2.55 m/s |

Best glide falls at about trim speed for all three, as it does on most real wings.

---

## 5. Pitch: brakes, speed bar and the pitch pendulum

### Rigging, brakes and the speed bar

The canopy's chord sits at a **rigging angle** to the lines, fixed by the line lengths. It's
solved, not tuned: for hands-up and each speed-bar setting, `Rig.solve` finds the rigging and the
body's tilt at which the pitch moment about the centre of mass vanishes and the lift carries the
weight at the polar's speed. Two drag scales solved the same way absorb what the arc costs, one
at trim and one on full bar, blended by lift coefficient between them, so straight glides match
the polar's speed and sink across the whole bar travel (the tests check the glide ratio at trim
and the extra sink on full bar).

A brake pulls its strips' trailing edge down, the outer strips most: the chord turns nose-up a
little, the profile cambers (more lift at the same angle), it drags a bit more, and near the tip
it curls the canopy down (§6). Braked speeds then **emerge** from the physics instead of being
looked up. The brake numbers were tuned so they land near the polar's target speeds
(`Polar.targetSpeed`):

![Target airspeed against brake and bar travel](physics/controls.svg)

| EN-B | Polar | Sim |
|---|---|---|
| Hands up | 38.0 km/h, 1.10 m/s | 38.0 km/h, 1.10 m/s |
| 50 % brake | 32.6 km/h, 1.00 m/s | 31.9 km/h, 1.12 m/s |
| 80 % brake | 28.0 km/h, 1.04 m/s | 29.6 km/h, 1.20 m/s |
| Half bar | 45.0 km/h, 1.47 m/s | 45.2 km/h, 1.46 m/s |
| Full bar | 52.0 km/h, 2.11 m/s | 52.0 km/h, 2.11 m/s |

Brake effects are scaled by each wing's lift range from trim to the stall, so full brake brings
every wing near its own stall, not past it.

### Flying the speed bar

Full bar takes about 3° off the angle of attack. Stamped in at once, that is a step into the pitch
pendulum's slow speed-for-height mode: the canopy dives (−4.9 m/s on the EN-B), swings back up
until the glider almost climbs, and keeps going up and down for a minute; releasing the bar does
the same in reverse, with a +2 m/s zoom. A pilot doesn't fly it that way, so the sim flies the bar
for the player, the way a pilot's legs do (`BAR_*` in `glider.ts`):

- **Feeding it in:** the bar the canopy feels (`GliderState.bar`) runs at most 30 % of its travel
  ahead of the speed the wing has already reached, and when letting go at most 5 % behind.
- **Flying it actively:** while the bar is in, it gets more bar when the glide is flatter than the
  polar's for the bar the player asks for and less when it's steeper. The sink steps to the bar's
  sink straight away and stays there while the speed builds; there's no dive and no swing back.
- **Letting go:** the wing is allowed a small zoom, in proportion to the speed it still has to lose,
  so it trades the speed for a little height instead of only bleeding it into drag.

On the EN-B, full bar takes the sink from 1.1 to 1.7 m/s at once, to 2.1 m/s (never past 2.2) as
the wing reaches 52 km/h in about 8 s. Letting go eases the sink to about 0.3 m/s for a moment
and the wing is back at trim within about 6 s.

### The pitch pendulum

Brake and release, and the body swings: the canopy pitches back as it slows, then surges ahead
when you let go.

![Pitch response to half brakes and release](physics/pitch-response.svg)

### The flare

Full brakes from trim: CL jumps, the canopy pitches back as it slows, and the glider zooms up
briefly (about +0.8 m/s on the EN-A, +1.2 on the EN-B and +1.6 on the EN-C) while the airspeed falls from 38 to about 21 km/h.
Hold the brakes and the speed runs out into a stall (§7). The zoom is smaller than the old point-
mass model's +2 m/s: a canopy falling back loses its own airspeed relative to the pilot, as a real
one does when you stab the brakes.

![Flare: full brakes from trim](physics/flare.svg)

---

## 6. Roll: turns, spirals and wingovers

### Gentle turns

One brake: its side drags (the glider yaws), cambers, and its tip curls down so that side's lift
leans outward. The canopy is pushed towards the braked side, the lines tilt, the lift tilts with
them, and the path curves. The arc's dihedral holds the bank where the brake's push balances it.
Weight shift moves the pilot 15 cm sideways, which rolls the body directly (about 14° on its own).

![Steady bank and sink against one held brake](physics/steady-turn.svg)

At 70 % brake, after 25 s:

| Wing | Bank | 360° takes | Sink |
|---|---|---|---|
| EN-A | 20° | 16.9 s | 1.4 m/s |
| EN-B | 28° | 13.4 s | 1.5 m/s |
| EN-C | 30° (and slowly winding in: a spiral-prone wing) | 11.5 s | 2.3 m/s |

### Spiral dives

Hold a deep brake and a wing willing to spiral winds in: steeper bank, faster, higher G, more
sink, until the drag of the faster, steeper wing balances it. On release the stored speed comes
out as a big zoom climb, then the pendulum swings it back to level.

**More brake winds it tighter.** In a developed spiral the inner, braked half flies just past its
stall (the canopy rolls about its chord as it circles, so the inner side meets the air at a high
angle) and the outer half carries the load. A brake pulled past 70 % keeps that half's profile
cambered past the stall (`STALL_CAMBER_CL`, fading out 0.3 rad past it), so it keeps more lift
the deeper it's pulled and the spiral winds faster. Below that, a stalled strip is a flat plate
with too little lift (`FLAT_CL` 0.8) to keep a spiral going, so eased back to a turn's brake the
spiral unwinds. Before, the flat plate had `FLAT_CL` 1.1 and no camber term: every spiral settled
at the same ~62°, 60°/s, 7.5 m/s and 1.9 G from 60 % to full brake, and a 70 % turn tipped over
by a gust or weight shift locked into it. Managing a spiral is now managing the inner brake: ease
it off to bring the G down, and release it gradually: letting go at 6 G sends the wing up into a
short climb and a ±30° swing before it settles.

![Spiral dive and exit for the three wing classes](physics/spiral.svg)

One brake held, after 30 s:

| Wing | 80 % | 90 % | 100 % |
|---|---|---|---|
| EN-A | 24°, 1.1 G, 1.4 m/s (a steep turn: the school wing resists spiralling) | 25°, 1.1 G, 1.5 m/s | 28°, 1.1 G, 1.5 m/s |
| EN-B | 87°/s, 2.6 G, 11.0 m/s | 151°/s, 4.8 G, 17.3 m/s | 178°/s, 5.9 G, 19.3 m/s |
| EN-C | 98°/s, 2.7 G, 13.3 m/s | 153°/s, 4.8 G, 18.4 m/s | 199°/s, 6.9 G, 21.9 m/s |

Bank sits at 73–81° in all of these; the depth shows in turn rate, G and sink. Locked in at 80 %
and then pulled to full, the EN-B goes from about 90°/s, 2.6 G and 11 m/s to 177°/s, 6 G and
20 m/s within 6 s. In bumpy air a 70 % turn can still be tipped into a spiral for a few seconds,
but it comes back out by itself. All three come out on their own when released (EN-B within about 5 s from
80 %). A full one-sided brake at low speed is past the spiral: the braked tip nears its stall,
which is how a real spin starts. The HUD flags `spiral` when the load passes 2.2 G above about
52° bank, and clears it below 1.4 G.

### Wingovers

Pump brake and lean side to side **in the swing's own rhythm** (about 6 s on the EN-B) and each
pull adds to the last: the bank passes 90°, the pilot swings up level with and over the wing, and
at the top the line load drops below 1 G, because his momentum, not gravity, is keeping the lines
tight. Rush the rhythm (3 s) and the swing never builds.

![Wingovers built by pumping](physics/wingover.svg)

---

## 7. Stalls, gusts and collapses

### Stall

A strip stalls past its own stall angle (lower with more brake). Past the stall each strip flies
like a **flat plate**: lift `0.8·sin 2α`, drag `1.8·sin²α`. Holding both brakes past 90 % keeps
pulling the trailing edge down over 1.2 s, which deepens the stall. The glider counts as
**stalled** when most of *both* halves are past their stall angle for 0.4 s. (One half past its
stall is a deep spiral's inner side, not a stall.)

**Full stall.** Stalled with both brakes still held past 70 %, the inlets no longer face the air
and the canopy **deflates** over 0.7 s (`deflation` 0 → 1). A deflated canopy keeps 15 % of its
lift and shows 70 % of its drag area, its centre of pressure moves to the middle (a sack has no
profile), and it no longer weathervanes into the airflow. So the lift goes, the canopy falls back
behind the pilot, the lines unload (about 0.25–0.4 G) and the pilot drops into them. It settles
with the canopy overhead in a horseshoe, sinking **9–10 m/s** with almost no forward speed, even
drifting slightly backwards. Brakes up, it refills over 1 s, the centre of pressure runs aft again,
the wing pitches forward and picks up speed: about 3.5 s and 30 m from hands-up to flying.

Without the deflation the stalled flat plate still had an L/D of about 1.7, and holding full
brakes settled into a mushy 28 km/h glide sinking 4.9 m/s — nothing like a real stall.

Falling straight down, the path has no horizontal direction, so heading and bank are measured
about the chord's direction once the path is steeper than about 60°.

### Gusts

There is no gust filter any more. A strip's angle of attack comes from the air at the canopy, so
a sharp down-gust drops it at once, and the canopy's pitch stability and the pendulum respond as
they would to anything else.

### Collapses

If the **line load stays below 0.3 G for 0.15 s**, the lines are slack and one side folds: the
high side of the current bank, or the left when level. The folded side keeps 30 % of its lift and
drags more, so the glider turns towards it. It reopens after 2.5 s (faster if you pump that
side's brake), and there's no collapse during the 2.5 s launch grace.

A 5 m/s down-gust from still air shows the chain:

![A sharp down-gust: unload, fold, turn, reopen](physics/gust-collapse.svg)

The load drops to about −1.8 G (the canopy is pushed down towards the pilot), a side folds, the
glider banks about 70° towards it, and when the side reinflates at t ≈ 4.7 s it pulls about 2 G.
Ordinary bumps (±0.6 m/s) never fold it; a test checks that.

---

## 8. On the ground: take-off and landing

On the ground the glider isn't flying. Its airspeed is just your run speed plus the headwind.

- **Running** (hold W) builds speed at 2.5 m/s² up to 4.2 m/s. With no run speed, the brakes
  turn you on the spot to face the wing round.
- **Lift-off** happens when the airspeed reaches 1.1 × stall, or when the ground drops more
  than 1 m ahead and you have at least 0.6 × stall. The wing overhead is already flying, so you
  leave at trim speed and trim CL.
- **Launch grace.** For 2.5 s after lift-off, touching the slope while still running is a
  stumble: you go back to running, not to a landing.
- **Touchdown** is a **crash** if any of these is true: sink above 3.5 m/s, ground speed above
  11 m/s, stalled, or bank above 0.6 rad (34°). Otherwise it's a landing. Touching the sea is
  `water`.

---

## 9. The air

`WindField.sample(x, y, z, t)` gives the air's velocity (u east, v north, w up) at any point.
It's the sum of four parts: the wind, ridge lift and lee sink from the terrain, thermals, and
turbulence.

### Wind and its gradient

The wind blows from one direction at one speed (the weather panel), shaped by height:

![Wind speed against height](physics/wind-gradient.svg)

- **Near the ground:** 60 % of the set speed at the surface, rising linearly to full speed at
  40 m. That's surface friction, and it's why a landing feels calmer than the air you
  were soaring in.
- **Above the inversion:** half speed. A crude two-layer atmosphere.

### Ridge lift

The air has to climb over terrain in its way. How fast it rises depends on how steep the slope
is **along the wind**: a face square to the wind lifts most, and one the wind runs along
doesn't lift at all. The model follows the notes vault's *coastal-soaring-lift-factors* note:

![How ridge lift is built from the terrain](physics/ridge.svg)

It's built once per wind direction on a 512² grid over the site (about 82 m cells over the
42 km island), and only scaled when the wind speed changes:

1. **Smooth** the heightmap with a 120 m Gaussian blur, so the air sees the shape of the
   cliff, not every gully.
2. **Slope along the wind**, from the gradient of the smoothed ground projected on the wind
   direction. The steepness is capped at 0.75 (37°) *before* projecting, so a sheer cliff gives
   strong lift, not infinite lift, and the cosine law survives.
3. **Reach upwind.** The air starts rising before it hits the face. Each cell takes the
   strongest windward slope within 600 m downwind of it, weighted by `exp(−distance/250 m)`.
4. **Ridge top and foot.** For each cell: the highest ground within 1.5 km downwind (the ridge
   the air must clear) and the lowest within 1.5 km upwind (where the climb started).

At runtime, `ridgeLift()` combines those with the weather:

```
lift   = slope·U · band · lid · stability
band   = 1 below the ridge top, fading to 0 at ridge top + 0.7 × relief (relief ≥ 50 m)
lid    = fades to 0 over the last 80 m below the inversion
stability = 0.4 + (inversion − ridge top)/300, clamped to 0.25–1
lee    = negative slope·U · 0.7, only within 400 m of the ground
```

A **low inversion** does two things: the lid caps the band, and when it sits at or below the
ridge top, `stability` weakens the lift as the air goes round the hill instead of over it. Here
is the model on the test cliff (400 m high, 22 km/h straight onto it), with a high inversion and
then a low one:

![Ridge lift cross-section, high and low inversion](physics/ridge-section.svg)

And the wind-angle law, with the wind swung off the face normal and lift measured 50 m above the
cliff top:

![Ridge lift against the wind's angle to the face](physics/off-angle.svg)

It tracks `cos(angle)` almost exactly, as the projection in step 2 intends. The small dip near
90° comes from the blur and the cap. At Famara this is why a north-westerly works and a
northerly, running along the Risco, barely does.

### Thermals

`ThermalField` keeps **24 thermals** alive over the site, from a seeded random generator, so a
replay or a test sees the same sky.

![Anatomy of a thermal](physics/thermal.svg)

- **Trigger:** a random point on land above 30 m. Strength is 0.6–1.4 × the day's setting,
  radius 50–100 m.
- **Life:** 6–12 minutes, with a 60 s ramp up and a 90 s decay, and replaced when it ends. On
  the first fill their ages are staggered, so the sky doesn't pop into existence all at once.
- **Drift:** the column leans downwind. At height h above its trigger, the centre has moved by
  `wind × h / strength`, the distance the wind carried the air while it climbed.
- **Profile:** a Gaussian core, plus a ring of sink at 2.2 radii, a quarter as strong. You can
  feel the edges, and you can fall out of one.
- **Vertical shape:** 30 % strength at the trigger, reaching full strength over the first 60 m,
  and fading over the last 150 m below cloudbase (the inversion). Above it there's nothing.
- **Cumulus:** a mature thermal (envelope above 0.3, strength at least 0.8 m/s, cloudbase at
  least 200 m above the trigger) puts a cloud at cloudbase, over the leaned top of the column.

### The sun and the time of day

The time of day is **solar time** (12:00 = sun due south), so "sunset" means the sun on the
horizon at every site and on every date. `src/sim/sun.ts` places the sun from the site's
latitude, today's day of year and the hour, and turns it into a **heating** factor, 0..1:

`heating = (sin(elevation) − sin 10°) × min((hour − sunrise) / 7 h, 1)`, normalised to the
day's peak.

The first term is the sun's height, with nothing below 10°, so thermals are gone an hour or so
before sunset. The second is the ground warming up, so the same sun heats less at 10:00 than at
14:00. Together they peak early in the afternoon (about 13:00 solar at Famara in October)
rather than at noon. The weather sliders describe that peak, and heating scales it down:

- **Thermals:** the core climb is multiplied by heating, and fewer of them are kept alive
  (`24 × min(1.5 × heating, 1)`). A morning has a handful of weak ones; at 17:00 there are none.
- **Where they trigger:** a candidate spot survives with probability `exposure / 1.6`, where
  exposure is the sun on that slope relative to flat ground. At midday every slope is much the
  same; with a low sun, the slopes facing it take the thermals and the ones in their own shade
  get none.
- **Convective turbulence:** midday air is rough. A second noise layer, shorter and faster than
  the mechanical one, adds `0.5 × thermals × heating` m/s below cloudbase. With 2 m/s thermals
  that is about ±1 m/s at the peak and nearly nothing in the evening, which is when the air
  goes smooth and only the ridge works.
- **Cloudbase** rises through the day, from 75 % of the inversion with no heating to the full
  inversion at the peak. The ridge lift's inversion lid stays where the slider puts it.

![Vertical air across a thermal's core](physics/thermal-profile.svg)

![Core strength over a thermal's life](physics/thermal-life.svg)

![Core strength with height](physics/thermal-height.svg)

### Turbulence

Turbulence is cheap, smooth pseudo-noise: three layers of sines at unrelated frequencies in x, y
and t, returning −1..1. No grid, no state, deterministic. Its amplitude is
`turbulence × (0.4 + 2 × leeness) × min(U/6, 1.5)`: stronger in the lee of the hill, and
stronger the windier it is. It enters as vertical air, so it reaches the wing through the gust
term in [§7](#7-stalls-gusts-and-collapses), and on a rough day it can fold a side. Thermal
activity adds its own convective layer on top (see above), which depends on the time of day,
not on the wind.

---

## 10. The 3D wing and pilot

Everything above is the physics. `src/game/wing.ts` is what you **see**. It is procedural:
built from parameters in code, not loaded from a model file, so every frame it can bend the
canopy for brakes and collapses and pose the pilot. It reads the sim's state and never writes
to it.

![Geometry of the 3D wing and pilot](physics/wing-model.svg)

### The canopy

- **Planform:** 48 cells over a 12.1 m flat span. The chord follows an ellipse,
  `0.45 + 2.3·√(1 − t²)` m, where t runs −1..1 tip to tip, so the root chord is 2.75 m and the
  tips 0.45 m. The trailing edge is nearly straight (`1.7 − 0.25·t²` m behind the pilot), so
  the leading edge sweeps back about 2 m to the tips, as on a real wing. The pilot hangs under
  about 38 % of the root chord.
- **Arc:** the span is bent around a 5.6 m radius, through 62° each side
  (`angle = 62°·|t|^1.3`, flatter in the middle). The top of the wing sits 7.4 m above the
  carabiners.
- **Section:** a NACA 4-digit thickness shape, cosine-spaced (16 points per surface) so the
  rounded nose is smooth, with a flatter underside (45 % of the top's thickness).
- **Cells:** three spanwise vertices per cell. The top surface puffs out between ribs, the
  trailing edge scallops in mid-cell, and the intakes under the nose are dark gaps between
  the ribs.
- **Colours:** red, with two white chevrons per side swept back from the nose and a darker
  trailing edge, slightly darker seams on every rib, shaded underside. A `MeshPhysicalMaterial` with
  sheen gives the fabric its soft highlight.

### Lines and risers

Each half-wing has four line rows: **A** (10 % chord), **B** (33 %), **C** (60 %) and
**brakes** (trailing edge, outer 80 % of the span). Each row **cascades** the way real lines
do. Groups of four attachment points join at an upper node, groups of three upper nodes join at
a middle node, and each middle node runs to the riser. A and B go to the A riser, C to the rear
riser, and the brake lines run to the brake handles. The lines are recomputed from the deformed
canopy every frame, so they follow a collapse or a brake pull.

### Driving the model from the sim

| Seen | Driven by |
|---|---|
| Whole rig's position and orientation | Position; yaw from heading; roll from bank and pitch from γ while flying |
| Canopy **surges ahead / drops back** | `clRate × 0.9` (clamped ±0.4 rad), smoothed. The wing pitches forward when CL is falling: the surge. |
| Canopy **leads into turns** | `−bankRate × 0.12`, smoothed: the wing rolls first and the pilot swings after it |
| **Brake deflection** | The rear 45 % of the chord is pulled down, quadratically towards the trailing edge, more towards the tips (30 % at the centre, 100 % at the tip) |
| **Collapse** | The outer span folds down and under about a hinge at 40 % semispan, up to 155°, and drags back. It folds fast (rate 9/s) and reopens slowly (2/s). |
| Pilot **hands** | Two-bone IK (0.30 m upper arm and forearm) to the brake handles, which hang from the canopy, so the hands move when the wing surges. The elbows point out and back. |
| Pilot **lean** | Weight shift rolls the body up to 0.14 rad |

### The pilot

The pilot is built from primitives: a cylinder torso under a black vest, sphere joints, cylinder
limbs, tan gloves, and a white full-face helmet with a smoked mirror visor and a camera mount on
top. The arms are two-bone IK to the brake handles, which hang at chin height beside the risers,
so the elbows drop down and out and the hands come down to the hips at full brake.

The harness is modelled on the Ozone **Submarine**: a hull lofted from rounded-box sections
(superellipses) along the body, in three pieces: the **cocoon**, a blunt nose over the feet
with a flight deck on top; the **fairing**, an open cockpit around the hips that rises behind
the head into a tall ram-air fairing and runs back to a cut-off tail 1.65 m behind the seat;
and a **keel** hanging under the fairing. It is blue, with a dark band along each side and the
fairing's baffles drawn as panel lines.

Two key poses blend with a filter of about 0.4 s:

- **Standing / running** on the ground: legs scissor with run speed, body leans forward, and the
  harness hangs off the back, the fairing deflated and the cocoon folded under the seat.
- **Seated** in flight: reclined, legs forward inside the cocoon (the legs are hidden once it
  closes), head tilted to look ahead.

### The tandem crew

**Flight → Pilot → Tandem** swaps the solo pilot for a tandem crew (`src/game/tandem.ts`); the
canopy, lines and flight model stay as they are. Two spreader bars, one per side, hang from the
main carabiners by a short link. The **passenger** is clipped to their front ends and sits in
front and about 30 cm lower, legs hanging out of an open seat harness, hands on the shoulder
straps. The **pilot** is clipped to the rear ends, sits up behind so they see over the
passenger's helmet, knees either side of the passenger's seat, and flies the brakes on the same
arm IK as the solo pilot. Their brake handles hang 18 cm further back to match.

Both wear softshells with a white chevron on the chest, high collars, sunglasses and open-face
helmets (a sphere cap tilted back so it sits above the brow and covers the nape): the pilot in
charcoal with dark trousers, an orange helmet and a beard, the passenger in black with black
shorts and bare legs, a black helmet and a slightly smaller build. The harness webbing is black
with mint loops. Standing, both run one behind the other, legs scissoring out of phase.

Under each seat hangs the **airbag** every tandem harness carries, lofted from rounded-box
sections like the Submarine hull, in the seat's own frame (up the spine, out behind the back).
It is deepest just behind the hips, about 40 cm below the seat, tapers forward under the thighs
and curves up behind the back: to the shoulder blades on the pilot (black), only to the small of
the back on the passenger (slate green), whose back rests against the pilot. A mint piping seam
runs round where the seat part meets the back part. On the ground a morph target empties it into
a flat pouch hanging behind the thighs, and it fills as the crew settles into the seats after
takeoff.

A tandem wing has trimmers, not a speed bar, so nobody's legs move when the wing speeds up.

---

## 11. Tuning constants

The constants that shape the feel, all in `src/sim/glider.ts` unless noted. The geometry ones are
physical. The aerodynamic ones were tuned together with a search scored on the tests' envelope
(turns, spiral and exit, wingovers, braked speeds, stall and flare), because they interact.
Change one, then run `npm test` and `npm run physics-figures`.

| Constant | Value | Effect |
|---|---|---|
| `LIFT_K` (`polar.ts`) | 0.1516 /m | ρS/2m: 24 m², 95 kg, sea level |
| `PILOT_MASS`, `CANOPY_MASS`, `CANOPY_INERTIAL` | 89, 6, 11 kg | Weight at the bottom and top; the canopy's inertia includes its trapped air |
| `LINE_LENGTH` | 7.5 m | Pilot to canopy: the pendulum's length |
| `SPAN`, `CHORD`, `STRIPS` | 11 m, 2.4 m, 6 | Canopy size and how finely it's sliced |
| `ARC`, `ARC_PER_SPIRAL_TENDENCY` | 1.879 rad, 0.15 | How deep the arc is on the EN-B, and how much flatter a spiral-prone wing's is |
| `LIFT_SLOPE` | 5 /rad | Lift-curve slope of a strip |
| `STRIP_CL_MAX` | 1.12 × the polar's | A strip's lift limit (the arc tilts lift, so strips work harder) |
| `FLAT_CL`, `FLAT_CD` | 0.8, 1.8 | Flat-plate lift and drag past the stall (more lift keeps light-brake spirals going) |
| `BRAKE_INCIDENCE`, `CAMBER_CL`, `BRAKE_CD` | 0.065 rad, 0.132, 0.005 | What a full brake does to a strip: nose-up, camber, drag (scaled per wing) |
| `BRAKE_SHARE` | 0.6 / 1 / 1.4 | How much of a side's brake reaches its inner, middle and tip strips |
| `TIP_TILT` | 0.049 rad | How far a full brake curls the tip down (× roll authority / 0.7) |
| `CP_ALPHA`, `CP_STALL` | 3 chords/rad, 0.72 chords | How far aft the centre of pressure moves with angle of attack, and past the stall |
| `CM_Q` | 30 | Pitch damping relative to the airflow |
| `CD_CROSS` | 0.047 | Drag of flow along the span (the arc as a fin) |
| `DEEP_BRAKE`, `STALL_CAMBER_CL`, `STALL_CAMBER_FADE` | 70 %, 2.5, 0.3 rad | A brake past 70 % keeps camber lift past the stall (up to +2.5 CL at full brake, gone 0.3 rad past it): how much more brake tightens a spiral |
| `DEEP_STALL_INCIDENCE`, `DEEP_HOLD` | 0.2 rad, 1.2 s | How held deep brakes deepen the stall |
| `WEIGHT_SHIFT_M` | 0.15 m | How far the pilot leans |
| `COLLAPSE_LOAD`, `COLLAPSE_SECONDS` | 0.3 G, 2.5 s | When slack lines fold a side, and how long it stays folded |
| `SPIRAL_LOAD` | 2.2 G | Threshold for the HUD's spiral flag |
| `RUN_MAX`, `RUN_ACCEL` | 4.2 m/s, 2.5 m/s² | Take-off run |
| `HARD_LANDING_SINK`, `HARD_LANDING_SPEED` | 3.5 m/s, 11 m/s | Crash thresholds |
| `LAUNCH_GRACE` | 2.5 s | Stumble window after lift-off |
| `BLUR_SIGMA_M` (`wind.ts`) | 120 m | How smooth a hill the air sees |
| `UPWIND_REACH_M`, `UPWIND_DECAY_M` | 600 m, 250 m | How far upwind lift starts |
| `BAND_ABOVE_RIDGE` | 0.7 | Band height, as a share of relief |
| `MAX_SLOPE` | 0.75 | Strongest slope the lift formula uses |

---

## 12. Limits and known gaps

These are choices, not bugs, unless marked. They're fine for proving the feel in a prototype,
and worth revisiting for the Unreal build:

- **Rigid lines.** Canopy, lines and pilot are one rigid body. The line *load* is real (the force
  the pilot's motion needs), but the lines can't actually go slack and let the pilot fall towards
  the canopy; slack is detected and becomes a fold. No riser twist either.
- **No apparent-mass tensor.** The air the canopy carries is a single added inertia, not the
  direction-dependent apparent mass of a real canopy.
- **The flare is soft.** About +0.8 to +1.6 m/s, because the canopy pitches back and loses airspeed. Real
  flares at the ground are progressive, and the sim rewards that too.
- **Collapses and stalls are states, not shapes.** The aerodynamics don't know what the canopy
  looks like. A fold is "one side keeps 30 % of its lift and drags more", and there are no
  cravattes, front collapses or line-overs.
- **Fixed air density and weight.** Sea-level air and 95 kg all-up for every wing. Higher
  launches and other wing loadings would change trim speed (∝ √(1/ρ), √m); `LIFT_K` is the
  place to add it.
- **Tuned constants.** The aerodynamic numbers in [§11](#11-tuning-constants) were fitted to an
  envelope (turns, spiral and exit, wingovers, braked speeds, stall), not measured on a real wing.
- **Simple air.** One wind direction for the whole site, a two-layer atmosphere, no rotor
  model beyond lee sink plus turbulence, and thermals that ignore terrain shape apart from
  needing land above 30 m.
- **The 3D airfoil is thinner than intended (bug, cosmetic).** In `wing.ts`, `airfoil()` divides
  the NACA polynomial by 0.5 and its comment says that normalises it to 1 at max thickness. The
  polynomial actually peaks at 0.1, so the result peaks at 0.2. With `THICKNESS = 0.15` the
  canopy is built about 2 % thick instead of about 15 %. Dividing by 0.1 instead would make it
  match the constant. It doesn't affect the physics.

---

## Regenerating the figures

```bash
npm run physics-figures      # rewrites the generated SVGs in docs/physics/
```

`scripts/physics-figures.ts` runs the real `stepGlider`, `Polar`, `WindField` and `ThermalField`
on flat ground, the tests' synthetic 400 m cliff (`src/sim/fixtures.ts`) and a single injected
thermal, then draws each result as an SVG chart. **Run it after any change to the flight or air
model** and commit the updated figures with the change, so this page keeps telling the truth.

| Generated by the script | Drawn by hand |
|---|---|
| `polar`, `controls`, `pitch-response`, `flare`, `steady-turn`, `spiral`, `wingover`, `gust-collapse`, `ridge-section`, `off-angle`, `wind-gradient`, `thermal-profile`, `thermal-life`, `thermal-height` | `forces`, `bank`, `ridge`, `thermal`, `wing-model` (from the formulas in `wing.ts`) |

The hand-drawn diagrams quote numbers from the code (for example 600 m upwind reach, 62° arc).
If you change one of those constants, update the matching SVG text too.
