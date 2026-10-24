// The wing's speed polar: sink rate as a function of airspeed, plus how the
// controls pick an airspeed. Specs live in wings.json (km/h), everything here is m/s.
//
// Each class's numbers are for one reference wing: 24 m² flat, at its own flat aspect ratio,
// flown at 95 kg all-up. A `WingSetup` flies that class at another size, aspect ratio and
// weight: every speed and sink scales with √(wing loading), so the glide stays the same, and
// a higher aspect ratio has less induced drag, so it glides better.
//
// For the force-based flight model the polar is also expressed as lift and drag
// coefficients. Lift per unit mass is LIFT_K·V²·CL, so a steady glide at speed V needs
// CL = g/(LIFT_K·V²), and the drag that reproduces the polar's sink there is
// CD = CL·sink(V)/V. Straight glides therefore match the spec exactly.

import wings from './wings.json';

export interface WingSpec {
  label: string;
  stallKmh: number;
  minSinkKmh: number;
  minSink: number;
  trimKmh: number;
  topKmh: number;
  /** How readily a deep spiral keeps itself going: < 1 recovers on its own, > 1 locks in. */
  spiralTendency: number;
  /** Roll response to brake/weight-shift input at trim speed. */
  rollAuthority: number;
  /** Flat aspect ratio of the reference wing the numbers above are for. */
  aspectRatio: number;
  /** Cells on the reference wing (drawn only): more on a higher aspect ratio. */
  cells: number;
}

/** What a pilot picks off a manufacturer's sheet: the size, its flat aspect ratio, the all-up weight. */
export interface WingSetup {
  areaM2: number;
  aspectRatio: number;
  allUpKg: number;
}

export type WingId = keyof typeof wings;
export const WINGS: Record<WingId, WingSpec> = wings;

const KMH = 1 / 3.6;
export const G = 9.81;
/** ½ρ of sea-level air (kg/m³). */
export const HALF_RHO = 0.6;
export const REFERENCE_AREA = 24;
export const REFERENCE_ALL_UP = 95;
/** ρ·S / (2·m) for the reference wing (1/m). */
export const LIFT_K = (HALF_RHO * REFERENCE_AREA) / REFERENCE_ALL_UP;
/**
 * Induced drag is CL²·INDUCED_K / flat aspect ratio: 1/(π·e) with a span efficiency of 0.85, and
 * the arc leaves a projected aspect ratio about 0.76 of the flat one.
 */
const INDUCED_K = 1 / (Math.PI * 0.85 * 0.76);
/** Pilot and harness drag area (m²): the same under any wing, so a bigger share of a small one's drag. */
export const PILOT_CDA = 0.5;
/** Trim sink is min sink plus this much — sets the curvature of the polar. */
const TRIM_SINK_PENALTY = 0.1;

export function referenceSetup(spec: WingSpec): WingSetup {
  return { areaM2: REFERENCE_AREA, aspectRatio: spec.aspectRatio, allUpKg: REFERENCE_ALL_UP };
}

export class Polar {
  readonly setup: WingSetup;
  /** Wing loading over the reference's (95 kg on 24 m²). */
  readonly loading: number;
  /** Aspect ratio over the class reference's. */
  readonly aspect: number;
  /** ρ·S / (2·m) (1/m). */
  readonly liftK: number;
  readonly stall: number;
  readonly minSinkSpeed: number;
  readonly minSink: number;
  readonly trim: number;
  readonly top: number;
  readonly spiralTendency: number;
  readonly rollAuthority: number;
  readonly clMax: number;
  /** Speed at full symmetric brakes, just above the stall. */
  readonly fullBrake: number;
  private readonly curvature: number;
  /** √loading: what every speed and sink is scaled by. */
  private readonly scale: number;
  /** Induced drag coefficient per CL² gained (−) or lost (+) on the reference's aspect ratio. */
  private readonly induced: number;
  /** Drag coefficient the pilot adds (+) or saves (−) over his share of the reference wing's. */
  private readonly pilotCd: number;

  constructor(spec: WingSpec, setup: WingSetup = referenceSetup(spec)) {
    this.setup = setup;
    this.loading = setup.allUpKg / setup.areaM2 / (REFERENCE_ALL_UP / REFERENCE_AREA);
    this.aspect = setup.aspectRatio / spec.aspectRatio;
    this.liftK = (HALF_RHO * setup.areaM2) / setup.allUpKg;
    this.scale = Math.sqrt(this.loading);
    this.induced = INDUCED_K * (1 / setup.aspectRatio - 1 / spec.aspectRatio);
    this.pilotCd = PILOT_CDA * (1 / setup.areaM2 - 1 / REFERENCE_AREA);
    this.stall = spec.stallKmh * KMH * this.scale;
    this.minSinkSpeed = spec.minSinkKmh * KMH * this.scale;
    this.minSink = spec.minSink * this.scale;
    this.trim = spec.trimKmh * KMH * this.scale;
    this.top = spec.topKmh * KMH * this.scale;
    this.spiralTendency = spec.spiralTendency;
    this.rollAuthority = spec.rollAuthority;
    this.fullBrake = this.stall * 1.12;
    this.curvature = (TRIM_SINK_PENALTY * this.scale) / (this.trim - this.minSinkSpeed) ** 2;
    this.clMax = this.clFor(this.stall);
  }

  /** Straight-flight sink rate (positive = down) at an airspeed. */
  sink(airspeed: number): number {
    const base = this.minSink + this.curvature * (airspeed - this.minSinkSpeed) ** 2;
    // Approaching the stall the wing mushes: sink climbs steeply in the last ~20 %.
    const onset = this.stall * 1.2;
    const mush = Math.min(Math.max((onset - airspeed) / (onset - this.stall * 0.8), 0), 1);
    const cl = this.clFor(airspeed);
    return base + 5 * this.scale * mush * mush + (airspeed * (cl * cl * this.induced + this.pilotCd)) / cl;
  }

  /** Lift coefficient for a steady glide at this airspeed. */
  clFor(airspeed: number): number {
    return G / (this.liftK * airspeed * airspeed);
  }

  /** Steady-glide airspeed for a lift coefficient. */
  speedFor(cl: number): number {
    return Math.sqrt(G / (this.liftK * cl));
  }

  /** Drag coefficient at a lift coefficient, so a steady glide sinks exactly as the polar says. */
  cdFor(cl: number): number {
    const v = this.speedFor(Math.min(Math.max(cl, 0.05), this.clMax));
    return (cl * this.sink(v)) / v;
  }

  /** Best glide ratio in still air, and the airspeed it's flown at (scanned between the stall and full bar). */
  bestGlide(): { ratio: number; speed: number } {
    let best = { ratio: 0, speed: this.trim };
    for (let v = this.stall; v <= this.top; v += 0.05) {
      const ratio = v / this.sink(v);
      if (ratio > best.ratio) best = { ratio, speed: v };
    }
    return best;
  }

  /** Airspeed the wing settles at for a symmetric brake (0..1) and speed bar (0..1). */
  targetSpeed(brake: number, bar: number): number {
    const b = Math.min(Math.max(brake, 0), 1);
    const s = Math.min(Math.max(bar, 0), 1) * (1 - b); // brakes and bar fight; brakes win
    return this.trim - (this.trim - this.fullBrake) * b ** 1.3 + (this.top - this.trim) * s;
  }
}
