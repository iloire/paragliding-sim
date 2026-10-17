# Plan: two-body flight model (canopy + pilot on lines)

Status: proposal, not started. Written 2026-10-18 after the wingover work in `5ab7996`.

## Why

Today the glider is one point mass (`src/sim/glider.ts`). Pitch and roll are tuned oscillators
bolted on top, and lift, AoA and line tension are inputs to the model rather than results. That
was enough to prove the ridge-soaring feel, and since `5ab7996` wingovers build from momentum and
timing. But some things a pilot knows can't come out of a single point mass:

- **The top of a wingover is light.** On a real wing the pilot swings up level with the canopy or
  above it, the speed bleeds off and the lines go nearly slack. Here the top stays at 2–3 G.
- **"Too far over the wing" is a line-tension event,** not a bank angle. Today it's a threshold
  (`OVER_WING` = 126°).
- **Pitch and roll pendulums are real swings** of a heavy pilot under a light canopy, so they
  couple: a surge after a dive, a dive after a stall, the pilot swinging forward on a frontal.
- **Collapses come from unloading,** and recovery comes from the canopy refilling, not timers.

The two-body model makes all of these fall out of the physics, the same way the point-mass
model did for flares and spirals.

## The model

Two bodies joined by lines that can only pull:

| Body | What it is | Forces on it |
|---|---|---|
| **Pilot** | Point mass, ~85 kg with harness | Gravity, pilot + harness drag (CdA ≈ 0.5 m²), line tension |
| **Canopy** | Point mass ~6 kg plus the air it carries (apparent mass, ~10–15 kg for a 24 m² wing), with an attitude | Gravity, lift and drag from its own relative wind, line tension |

**Lines** are a distance constraint of length `l` ≈ 7.5 m (carabiners to canopy), tension-only.
Solve it as a position-based constraint each sub-step: if the bodies are further apart than `l`,
pull them together, splitting the correction by inverse mass, and record the impulse as the
tension. If they are closer, do nothing: the lines are slack. That is stable at any stiffness
and gives tension (the load factor the pilot feels) for free.

**Canopy attitude** comes from three parts:

- **Roll** follows the line axis (pilot → canopy). The canopy can't roll relative to its lines
  while they're loaded.
- **Pitch** is the line axis plus the rigging trim angle (set by the speed bar: shorter A-risers
  pitch it forward), plus a small pitch moment from the brakes.
- **Yaw** turns towards the canopy's relative wind with a time constant (weathervane), plus a
  yaw moment from brake difference. This gives sideslip and adverse yaw for free, which the
  point-mass model can't do ("no yaw dynamics" in `docs/physics.md` §12).

**Aerodynamics on the canopy.** AoA is the angle between the canopy chord and its relative wind.
CL(α) and CD(α) are per wing class, with brakes adding camber (more CL and CD, lower stall α).
Split the span in two halves (left/right) so differential brake gives the roll and yaw moments
directly instead of through an `authority` constant.

**What comes out of it, unscripted:**

- **Roll pendulum.** The pilot hangs below the canopy; brake turns the canopy, the pilot swings out.
- **Pitch pendulum and surge.** The canopy decelerates faster than the pilot (low mass, high drag).
- **Light top of a wingover.** The trajectory slows at the apex; the canopy's AoA drops as the
  pilot swings over; tension falls.
- **Slack lines.** Tension stays near zero for more than ~0.15 s: collapse (and the side that
  folds is the one whose half-span went to negative AoA first).
- **Spiral.** Comes from the yaw–roll coupling and the pilot's centrifugal swing, not from a
  `spiralTendency` blend. The per-wing spiral tendency becomes yaw damping and canopy geometry.

## What stays

- `Environment`, `Controls`, `Polar` / `wings.json`, the HUD, IGC export and the air model.
- `GliderState` keeps its fields for the UI (`bank`, `gamma`, `heading`, `load`, `vz`,
  `airspeed`…). They become *derived* values: bank = line-axis roll, load = line tension / pilot
  weight, gamma/heading from the pilot's velocity through the air. New fields: canopy position
  and attitude, line tension, pilot swing angles.
- **The ground phase** (`ground()`, take-off run) stays as is. At lift-off, spawn the canopy
  `l` above the pilot, flying at trim. Canopy ground handling is out of scope.
- `wing.ts` draws the real canopy pose instead of the cosmetic `surge`/`lead` swing.

## Tuning targets (acceptance tests)

Every current envelope test stays and must pass on the new model unchanged, because they are what
"flies like a paraglider" means today:

- Glides at the polar ratio in still air: trim speed, min sink and top speed per wing class
  within ±1 km/h / ±0.05 m/s. This means fitting CL(α), CD(α) and the rigging angles to
  `wings.json`, the same job `Polar.cdFor` does now.
- 70 % brake ≈ 26° bank / 13 s per 360° (EN-B); spiral ≈ 78° / 3.2 G / −10.6 m/s and it
  exits hands-up; flare climbs > +1 m/s; stall and recovery; take-off; soft and hard landings;
  gust fold and reopen; small bumps don't fold it.

New tests, the reason for doing this:

- **Wingover top is light:** pumped in rhythm, load at the peak bank < 1 G on EN-B, and the
  bank peak comes while the path is climbing (γ > 0), not at the bottom of a dive.
- **Pilot over the wing:** a big wingover reaches line-axis bank > 110° with tension > 0.
- **Overcooked folds from slack lines,** not a bank threshold. Delete `OVER_WING`.
- **Pitch coupling:** a sudden release from deep brake surges the canopy ahead of the pilot
  (canopy pitch forward > 20°) before the pilot catches up.

## Steps

1. **Prototype side by side:** `src/sim/glider2.ts` behind a "Flight model: classic /
   two-body" toggle in the panel, so we can fly both. No UI changes beyond the toggle.
2. **Integration first, aero second:** the pilot hanging under a canopy in a steady wind with
   fixed CL. Check the constraint is stable at 120 Hz with 4 sub-steps, and that tension equals
   weight in a steady glide.
3. **Fit the aero to the polar** per wing class, then pass the steady glide test.
4. **Brakes and speed bar:** camber, trim angle, half-span split. Pass the turn, spiral, flare
   and stall tests.
5. **Collapses from tension;** delete the timers where the physics now covers them. Keep a
   minimum fold duration so it stays readable.
6. **Wingover tests** (above), then fly it, with the gamepad if possible.
7. **Make it the default,** delete the old model and its tuning constants, and rewrite
   `docs/physics.md` §2, §3, §5–§7, §11 and §12 and the figures (`npm run physics-figures`).

## Risks

- **Polar fidelity.** Fitting CL(α)/CD(α) so the steady glide still matches `wings.json` is the
  part most likely to eat time. Mitigation: keep `Polar` as the source of truth and derive the
  curves from it, as `cdFor` does today.
- **Stiffness.** Lines are a stiff link between a light body and a heavy one. Position-based
  constraints avoid the explosion; sub-steps keep the canopy's fast pitch response.
- **Feel regressions** in the ridge soaring that already works. Mitigation: step 1's toggle and
  the unchanged envelope tests.
- **Unreal port.** The model stays pure TypeScript with no three.js, like today, so it translates
  the same way. Unreal's own physics could do the constraint, but keeping it ours keeps it
  deterministic and tested.

## Rough size

Steps 1–4 are the bulk: about two to three focused sessions, mostly tuning. Steps 5–7 are about
one more. Nothing ships until step 7. Until then the classic model stays the default.

## Open questions

1. Is the planned Unreal build likely to use its own physics (Chaos) for the lines? If so, keep
   the TS model simple and treat it as the spec for the Unreal one.
2. Apparent mass and canopy inertia: is there real data (wing manufacturer or a paper) to start
   from, or do we tune by feel against video of real wingovers?
3. Scope of collapses: asymmetric only (as today), or frontals too once the pitch coupling exists?
