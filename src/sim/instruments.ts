// Flight-computer maths behind the HUD: glide to a landing and the recent track for
// the thermal assistant. Pure, so it can be tested without a DOM.

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass name for a heading in radians (0 = north, clockwise). */
export function compass(rad: number): string {
  return COMPASS[Math.round(((rad * 180) / Math.PI / 22.5) % 16 + 16) % 16];
}

export type GlideStatus = 'ok' | 'marginal' | 'out' | 'none';

export interface GlideTo {
  /** Horizontal distance (m). */
  distance: number;
  /** Compass bearing to the target (rad). */
  bearing: number;
  /** Glide ratio needed to arrive at the target's height; Infinity when already below it. */
  required: number;
  status: GlideStatus;
}

/** Above the required glide by this factor counts as comfortably reachable. */
export const GLIDE_MARGIN = 1.25;

/**
 * Can the current glide (`glide`, null on the ground, Infinity when climbing) reach a
 * point at height `tz`? Compared against the averaged L/D, so it includes the wind.
 */
export function glideTo(x: number, y: number, z: number, tx: number, ty: number, tz: number, glide: number | null): GlideTo {
  const dx = tx - x, dy = ty - y;
  const distance = Math.hypot(dx, dy);
  const height = z - tz;
  const required = height > 0 ? distance / height : Infinity;
  let status: GlideStatus;
  if (glide === null) status = 'none';
  else if (!Number.isFinite(required)) status = 'out';
  else if (glide >= required * GLIDE_MARGIN) status = 'ok';
  else if (glide >= required) status = 'marginal';
  else status = 'out';
  return { distance, bearing: Math.atan2(dx, dy), required, status };
}

export interface TrackPoint {
  x: number;
  y: number;
  vz: number;
}

/** The last `windowS` seconds of position + climb, sampled every `intervalS`, for drawing lift around the circle. */
export class TurnTrack {
  readonly points: TrackPoint[] = [];
  private timer = 0;

  constructor(private readonly windowS = 30, private readonly intervalS = 0.25) {}

  add(x: number, y: number, vz: number, dt: number): void {
    this.timer += dt;
    if (this.timer < this.intervalS) return;
    this.timer = 0;
    this.points.push({ x, y, vz });
    const max = Math.round(this.windowS / this.intervalS);
    if (this.points.length > max) this.points.splice(0, this.points.length - max);
  }

  /** The strongest-climb point of the track, or null when nothing in it climbs. */
  best(): TrackPoint | null {
    let best: TrackPoint | null = null;
    for (const p of this.points) if (p.vz > 0 && (!best || p.vz > best.vz)) best = p;
    return best;
  }

  reset(): void {
    this.points.length = 0;
    this.timer = 0;
  }
}
