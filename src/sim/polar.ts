// The wing's speed polar: sink rate as a function of airspeed, plus how the
// controls pick an airspeed. Specs live in wings.json (km/h), everything here is m/s.

import wings from './wings.json';

export interface WingSpec {
  label: string;
  stallKmh: number;
  minSinkKmh: number;
  minSink: number;
  trimKmh: number;
  topKmh: number;
  maxBankDeg: number;
}

export type WingId = keyof typeof wings;
export const WINGS: Record<WingId, WingSpec> = wings;

const KMH = 1 / 3.6;
/** Trim sink is min sink plus this much — sets the curvature of the polar. */
const TRIM_SINK_PENALTY = 0.1;

export class Polar {
  readonly stall: number;
  readonly minSinkSpeed: number;
  readonly minSink: number;
  readonly trim: number;
  readonly top: number;
  readonly maxBank: number;
  /** Speed at full symmetric brakes, just above the stall. */
  readonly fullBrake: number;
  private readonly curvature: number;

  constructor(spec: WingSpec) {
    this.stall = spec.stallKmh * KMH;
    this.minSinkSpeed = spec.minSinkKmh * KMH;
    this.minSink = spec.minSink;
    this.trim = spec.trimKmh * KMH;
    this.top = spec.topKmh * KMH;
    this.maxBank = (spec.maxBankDeg * Math.PI) / 180;
    this.fullBrake = this.stall * 1.12;
    this.curvature = TRIM_SINK_PENALTY / (this.trim - this.minSinkSpeed) ** 2;
  }

  /** Straight-flight sink rate (positive = down) at an airspeed. */
  sink(airspeed: number): number {
    const base = this.minSink + this.curvature * (airspeed - this.minSinkSpeed) ** 2;
    // Approaching the stall the wing mushes: sink climbs steeply in the last ~20 %.
    const onset = this.stall * 1.2;
    const mush = Math.min(Math.max((onset - airspeed) / (onset - this.stall * 0.8), 0), 1);
    return base + 5 * mush * mush;
  }

  /** Airspeed the wing settles at for a symmetric brake (0..1) and speed bar (0..1). */
  targetSpeed(brake: number, bar: number): number {
    const b = Math.min(Math.max(brake, 0), 1);
    const s = Math.min(Math.max(bar, 0), 1) * (1 - b); // brakes and bar fight; brakes win
    return this.trim - (this.trim - this.fullBrake) * b ** 1.3 + (this.top - this.trim) * s;
  }
}
