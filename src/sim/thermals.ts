// Procedural thermals: columns that trigger over land, drift with the wind,
// live for a cycle and top out at the inversion where they mark a cumulus.

import type { Heightmap } from './terrain';

export interface Thermal {
  x: number;
  y: number;
  /** Ground elevation at the trigger point. */
  base: number;
  radius: number;
  /** Peak core climb (m/s) when mature. */
  strength: number;
  born: number;
  life: number;
}

export interface Cloud {
  x: number;
  y: number;
  z: number;
  size: number;
  /** 0..1 — how formed the cloud is. */
  opacity: number;
}

const RAMP_UP = 60;
const RAMP_DOWN = 90;
const MIN_TRIGGER_HEIGHT = 30;

/** Deterministic PRNG so tests and replays see the same sky. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..1 lifecycle envelope: grows, holds, decays. */
export function envelope(th: Thermal, t: number): number {
  const age = t - th.born;
  if (age < 0 || age > th.life) return 0;
  return Math.min(1, age / RAMP_UP, (th.life - age) / RAMP_DOWN);
}

export class ThermalField {
  thermals: Thermal[] = [];
  private readonly rng: () => number;

  constructor(
    private readonly terrain: Heightmap,
    seed = 1,
  ) {
    this.rng = mulberry32(seed);
  }

  /** Keeps `count` thermals alive, respawning the ones whose cycle has ended. */
  update(t: number, strength: number, count = 24): void {
    if (strength <= 0) { this.thermals = []; return; }
    this.thermals = this.thermals.filter((th) => t - th.born < th.life);
    let guard = 0;
    while (this.thermals.length < count && guard++ < 500) {
      const x = this.rng() * this.terrain.extent;
      const y = this.rng() * this.terrain.extent;
      const base = this.terrain.heightAt(x, y);
      if (base < MIN_TRIGGER_HEIGHT) continue;
      const life = 360 + this.rng() * 360;
      // On the first fill, stagger ages so the sky doesn't pop in all at once.
      const born = this.thermals.length === 0 && t === 0 ? -this.rng() * life * 0.8 : t - this.rng() * 20;
      this.thermals.push({ x, y, base, radius: 50 + this.rng() * 50, strength: strength * (0.6 + this.rng() * 0.8), born, life });
    }
  }

  /** Column centre at height z, leaned downwind by the time the air took to climb there. */
  centreAt(th: Thermal, z: number, windU: number, windV: number): [number, number] {
    const rise = Math.max(z - th.base, 0) / Math.max(th.strength, 1);
    return [th.x + windU * rise, th.y + windV * rise];
  }

  /** Vertical air movement from all thermals at a point (m/s, positive = up). */
  sample(x: number, y: number, z: number, t: number, windU: number, windV: number, cloudbase: number): number {
    if (z >= cloudbase) return 0;
    let w = 0;
    for (const th of this.thermals) {
      if (z < th.base) continue;
      const env = envelope(th, t);
      if (env <= 0) continue;
      const [cx, cy] = this.centreAt(th, z, windU, windV);
      const r = Math.hypot(x - cx, y - cy);
      if (r > th.radius * 4) continue;
      const top = Math.min((cloudbase - z) / 150, 1);
      const bottom = Math.min(Math.max((z - th.base) / 60, 0.3), 1);
      const a = th.strength * env * top * bottom;
      const k = r / th.radius;
      const ring = (r - 2.2 * th.radius) / th.radius;
      w += a * Math.exp(-k * k) - 0.25 * a * Math.exp(-ring * ring);
    }
    return w;
  }

  clouds(t: number, windU: number, windV: number, cloudbase: number): Cloud[] {
    const out: Cloud[] = [];
    for (const th of this.thermals) {
      const env = envelope(th, t);
      if (env < 0.3 || th.strength < 0.8 || cloudbase <= th.base + 200) continue;
      const [x, y] = this.centreAt(th, cloudbase, windU, windV);
      out.push({ x, y, z: cloudbase + 60, size: th.radius * 5 * Math.min(th.strength / 2, 1.5), opacity: (env - 0.3) / 0.7 });
    }
    return out;
  }
}
