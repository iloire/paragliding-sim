// The wing's speed polar: sink rate as a function of airspeed, plus how the
// controls pick an airspeed. Specs live in wings.json (km/h), everything here is m/s.
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
}

export type WingId = keyof typeof wings;
export const WINGS: Record<WingId, WingSpec> = wings;

const KMH = 1 / 3.6;
export const G = 9.81;
/** ρ·S / (2·m) for a 24 m² wing at 95 kg all-up in sea-level air (1/m). */
export const LIFT_K = (1.2 * 24) / (2 * 95);
/** Trim sink is min sink plus this much — sets the curvature of the polar. */
const TRIM_SINK_PENALTY = 0.1;

export class Polar {
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

  constructor(spec: WingSpec) {
    this.stall = spec.stallKmh * KMH;
    this.minSinkSpeed = spec.minSinkKmh * KMH;
    this.minSink = spec.minSink;
    this.trim = spec.trimKmh * KMH;
    this.top = spec.topKmh * KMH;
    this.spiralTendency = spec.spiralTendency;
    this.rollAuthority = spec.rollAuthority;
    this.fullBrake = this.stall * 1.12;
    this.curvature = TRIM_SINK_PENALTY / (this.trim - this.minSinkSpeed) ** 2;
    this.clMax = this.clFor(this.stall);
  }

  /** Straight-flight sink rate (positive = down) at an airspeed. */
  sink(airspeed: number): number {
    const base = this.minSink + this.curvature * (airspeed - this.minSinkSpeed) ** 2;
    // Approaching the stall the wing mushes: sink climbs steeply in the last ~20 %.
    const onset = this.stall * 1.2;
    const mush = Math.min(Math.max((onset - airspeed) / (onset - this.stall * 0.8), 0), 1);
    return base + 5 * mush * mush;
  }

  /** Lift coefficient for a steady glide at this airspeed. */
  clFor(airspeed: number): number {
    return G / (LIFT_K * airspeed * airspeed);
  }

  /** Steady-glide airspeed for a lift coefficient. */
  speedFor(cl: number): number {
    return Math.sqrt(G / (LIFT_K * cl));
  }

  /** Drag coefficient at a lift coefficient, so a steady glide sinks exactly as the polar says. */
  cdFor(cl: number): number {
    const v = this.speedFor(Math.min(Math.max(cl, 0.05), this.clMax));
    return (cl * this.sink(v)) / v;
  }

  /** Airspeed the wing settles at for a symmetric brake (0..1) and speed bar (0..1). */
  targetSpeed(brake: number, bar: number): number {
    const b = Math.min(Math.max(brake, 0), 1);
    const s = Math.min(Math.max(bar, 0), 1) * (1 - b); // brakes and bar fight; brakes win
    return this.trim - (this.trim - this.fullBrake) * b ** 1.3 + (this.top - this.trim) * s;
  }
}
