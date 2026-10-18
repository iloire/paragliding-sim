// The air: base wind with a surface gradient, dynamic (ridge) lift computed
// from the terrain, an inversion lid, lee sink, thermals and turbulence.
// The ridge-lift physics follows the notes vault's coastal-soaring-lift-factors:
// lift ≈ V · slope · cos(off-angle), weaker under a low inversion, gone above the band.

import type { Heightmap } from './terrain';
import { ThermalField } from './thermals';

export interface Weather {
  windSpeedKmh: number;
  /** Compass direction the wind blows FROM, degrees. */
  windFromDeg: number;
  /** Inversion height MSL (m) — also cloudbase. */
  inversionM: number;
  /** Average thermal core climb (m/s), 0 = no thermals. */
  thermalStrength: number;
  /** 0..1 */
  turbulence: number;
}

export interface AirSample {
  u: number; // east m/s
  v: number; // north m/s
  w: number; // up m/s
}

const BLUR_SIGMA_M = 120;
/** Lift reaches this far upwind of the face, decaying with this length. */
const UPWIND_REACH_M = 600;
const UPWIND_DECAY_M = 250;
/** How far downwind to look for the ridge top, and upwind for the foot of the slope. */
const RIDGE_LOOKAHEAD_M = 1500;
/** Band top = ridge top + this × ridge relief. */
const BAND_ABOVE_RIDGE = 0.7;
/** Convective turbulence (m/s) per m/s of thermal climb at full heating. */
const THERMAL_TURBULENCE = 0.5;
/** Cloudbase at no heating as a share of the inversion: it rises to the inversion at the day's peak. */
const MORNING_CLOUDBASE = 0.75;
/** Caps the slope term so a sheer face gives strong (~4 m/s at 22 km/h), not absurd, lift. */
const MAX_SLOPE = 0.75;

export class WindField {
  readonly grid: number;
  readonly cell: number;
  readonly thermals: ThermalField;
  /** Ridge lift per m/s of wind (positive part, smeared upwind). Row 0 = south. */
  lift: Float32Array;
  /** Lee-side sink per m/s of wind (≤ 0). */
  lee: Float32Array;
  /** Height of the ridge the air at this cell has to climb over. */
  ridgeTop: Float32Array;
  /** Lowest ground upwind — the foot of the slope the air has been climbing. */
  ridgeBase: Float32Array;
  private readonly base: Float32Array;
  private readonly smooth: Float32Array;
  private weather: Weather;
  private dirFrom = NaN;
  /** 0..1 — the sun's heating (sun.ts); 1 = the day's peak, which the sliders describe. */
  private heat = 1;

  constructor(
    readonly terrain: Heightmap,
    weather: Weather,
    grid = 512,
    seed = 1,
  ) {
    this.grid = grid;
    this.cell = terrain.extent / grid;
    this.weather = weather;
    const n = grid * grid;
    this.lift = new Float32Array(n);
    this.lee = new Float32Array(n);
    this.ridgeTop = new Float32Array(n);
    this.ridgeBase = new Float32Array(n);
    this.base = new Float32Array(n);
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        this.base[j * grid + i] = terrain.groundAt((i + 0.5) * this.cell, (j + 0.5) * this.cell);
      }
    }
    this.smooth = gaussianBlur(this.base, grid, BLUR_SIGMA_M / this.cell);
    this.thermals = new ThermalField(terrain, seed);
    this.setWeather(weather);
  }

  get current(): Weather {
    return this.weather;
  }

  /** Unit vector the wind blows TOWARDS (east, north). */
  get direction(): [number, number] {
    const a = (this.weather.windFromDeg * Math.PI) / 180;
    return [-Math.sin(a), -Math.cos(a)];
  }

  get speed(): number {
    return this.weather.windSpeedKmh / 3.6;
  }

  /** Where the sun is and how hard it heats: drives the thermals, their turbulence and cloudbase. */
  setSun(heat: number, dir: [number, number, number]): void {
    this.heat = heat;
    this.thermals.activity = heat;
    this.thermals.sun = dir;
  }

  /** Thermal tops: low and soft in the morning, up at the inversion when heating peaks. */
  get cloudbase(): number {
    return this.weather.inversionM * (MORNING_CLOUDBASE + (1 - MORNING_CLOUDBASE) * this.heat);
  }

  setWeather(weather: Weather): void {
    this.weather = weather;
    // Speed scales linearly; only a direction change needs the grids rebuilt.
    if (weather.windFromDeg !== this.dirFrom) {
      this.dirFrom = weather.windFromDeg;
      this.buildRidgeGrids();
    }
  }

  private buildRidgeGrids(): void {
    const g = this.grid, c = this.cell;
    const [dx, dy] = this.direction;
    const slope = new Float32Array(g * g);
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const gx = (this.at(this.smooth, i + 1, j) - this.at(this.smooth, i - 1, j)) / (2 * c);
        const gy = (this.at(this.smooth, i, j + 1) - this.at(this.smooth, i, j - 1)) / (2 * c);
        // Rise of the ground along the wind: positive on the windward face. The cap
        // applies to the steepness before projecting, so lift keeps its cos(off-angle) law.
        const steep = Math.hypot(gx, gy);
        const cap = steep > MAX_SLOPE ? MAX_SLOPE / steep : 1;
        slope[j * g + i] = (gx * dx + gy * dy) * cap;
      }
    }
    const reach = Math.round(UPWIND_REACH_M / c);
    const look = Math.round(RIDGE_LOOKAHEAD_M / c);
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        let lift = 0, top = this.base[j * g + i], foot = this.base[j * g + i];
        for (let k = 0; k <= look; k++) {
          const si = Math.round(i + dx * k), sj = Math.round(j + dy * k);
          const s = this.at(slope, si, sj);
          if (k <= reach && s > 0) lift = Math.max(lift, s * Math.exp((-k * c) / UPWIND_DECAY_M));
          top = Math.max(top, this.at(this.smooth, si, sj));
          foot = Math.min(foot, this.at(this.base, Math.round(i - dx * k), Math.round(j - dy * k)));
        }
        this.ridgeBase[j * g + i] = foot;
        this.lift[j * g + i] = lift;
        this.lee[j * g + i] = Math.min(slope[j * g + i], 0);
        this.ridgeTop[j * g + i] = top;
      }
    }
  }

  private at(a: Float32Array, i: number, j: number): number {
    const g = this.grid;
    return a[Math.min(Math.max(j, 0), g - 1) * g + Math.min(Math.max(i, 0), g - 1)];
  }

  private bilinear(a: Float32Array, x: number, y: number): number {
    const u = x / this.cell - 0.5, v = y / this.cell - 0.5;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    return (
      (this.at(a, i, j) * (1 - fu) + this.at(a, i + 1, j) * fu) * (1 - fv) +
      (this.at(a, i, j + 1) * (1 - fu) + this.at(a, i + 1, j + 1) * fu) * fv
    );
  }

  /** Dynamic lift (m/s) at a point: terrain slope × wind, shaped by the band and the inversion. */
  ridgeLift(x: number, y: number, z: number): number {
    const U = this.speed;
    if (U <= 0) return 0;
    const top = this.bilinear(this.ridgeTop, x, y);
    const relief = Math.max(top - this.bilinear(this.ridgeBase, x, y), 0);
    const bandTop = top + BAND_ABOVE_RIDGE * Math.max(relief, 50);
    const band = z <= top ? 1 : Math.max(1 - (z - top) / (bandTop - top), 0);
    const inv = this.weather.inversionM;
    const lid = Math.min(Math.max((inv - z) / 80, 0), 1);
    // A lid at or below the ridge top makes the flow go around instead of over.
    const stability = Math.min(Math.max(0.4 + (inv - top) / 300, 0.25), 1);
    const up = this.bilinear(this.lift, x, y) * U * band * lid * stability;
    // Lee sink hugs the ground on the downwind side, whatever the ridge ahead.
    const leeBand = Math.min(Math.max(1 - (z - this.terrain.groundAt(x, y)) / 400, 0), 1);
    const down = this.bilinear(this.lee, x, y) * U * 0.7 * leeBand;
    return up + down;
  }

  /** Horizontal wind speed at a point: surface gradient near the ground, weaker above the lid. */
  windSpeedAt(x: number, y: number, z: number): number {
    const agl = z - this.terrain.groundAt(x, y);
    const surface = agl < 40 ? 0.6 + 0.4 * Math.max(agl, 0) / 40 : 1;
    const above = z > this.weather.inversionM ? 0.5 : 1;
    return this.speed * surface * above;
  }

  sample(x: number, y: number, z: number, t: number): AirSample {
    const [dx, dy] = this.direction;
    const s = this.windSpeedAt(x, y, z);
    const u = dx * s, v = dy * s;
    let w = this.ridgeLift(x, y, z);
    const cloudbase = this.cloudbase;
    w += this.thermals.sample(x, y, z, t, u, v, cloudbase);
    const leeness = -this.bilinear(this.lee, x, y);
    w += turbulence(x, y, t) * this.weather.turbulence * (0.4 + 2 * leeness) * Math.min(this.speed / 6, 1.5);
    // Midday air is rough: the thermals churn it, shorter and faster than the mechanical kind.
    const convective = this.weather.thermalStrength * this.heat;
    if (convective > 0 && z < cloudbase) w += THERMAL_TURBULENCE * convective * turbulence(x * 1.9 + 517, y * 1.9 - 233, t * 1.6);
    return { u, v, w };
  }
}

/** Smooth pseudo-noise in −1..1 from incommensurate sines — cheap, deterministic, no grid. */
export function turbulence(x: number, y: number, t: number): number {
  return (
    0.5 * Math.sin(x * 0.021 + t * 0.9) * Math.cos(y * 0.017 - t * 0.7) +
    0.3 * Math.sin(x * 0.053 - y * 0.041 + t * 2.3) +
    0.2 * Math.sin(y * 0.097 + t * 4.1 + Math.sin(x * 0.011))
  );
}

function gaussianBlur(src: Float32Array, n: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let sum = 0;
  for (let k = -r; k <= r; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); kernel.push(w); sum += w; }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const clamp = (i: number) => Math.min(Math.max(i, 0), n - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[j * n + clamp(i + k)] * kernel[k + r];
      tmp[j * n + i] = acc;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[clamp(j + k) * n + i] * kernel[k + r];
      out[j * n + i] = acc;
    }
  }
  return out;
}
