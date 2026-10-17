// Flight model. The wing flies at an airspeed picked by the brakes and speed bar
// through a damped second-order response (the pitch pendulum — surge and dive),
// and banks through another one (the roll pendulum — the swing you feel in a
// turn). Turn rate comes from bank: ω = g·tan(φ)/V.

import type { Polar } from './polar';
import type { AirSample } from './wind';

export const G = 9.81;

export interface Controls {
  /** 0..1 */
  brakeLeft: number;
  /** 0..1 */
  brakeRight: number;
  /** 0..1 */
  speedBar: number;
  /** −1 (left) .. 1 (right) */
  weightShift: number;
  /** Held to run on the ground. */
  run: boolean;
}

export type Phase = 'ground' | 'flying' | 'crashed' | 'water';

export interface GliderState {
  x: number;
  y: number;
  z: number;
  /** Compass heading, radians, clockwise from north. */
  heading: number;
  bank: number;
  bankRate: number;
  airspeed: number;
  airspeedRate: number;
  /** Net vertical speed over the ground (m/s, up positive). */
  vz: number;
  groundSpeed: number;
  runSpeed: number;
  phase: Phase;
  stalled: boolean;
  stallTimer: number;
  time: number;
  /** Sim time of the last lift-off, for the launch grace period. */
  takeoffAt: number;
  /** Set on a phase change (takeoff, landing…) for the UI to pick up and clear. */
  event: string | null;
}

export interface Environment {
  air(x: number, y: number, z: number, t: number): AirSample;
  ground(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
}

const PITCH = { omega: 2.0, zeta: 0.5 };
const ROLL = { omega: 1.8, zeta: 0.4 };
const RUN_MAX = 4.2;
const RUN_ACCEL = 2.5;
const HARD_LANDING_SINK = 3.5;
const HARD_LANDING_SPEED = 11;
/** Fraction of airspeed lost to a deceleration that turns into height (the flare). */
const ENERGY_RETENTION = 0.5;
/** Seconds after lift-off when the wing is still being flown off the hill: no surge dive,
 *  and brushing the slope while still running is a stumble, not a landing. */
const LAUNCH_GRACE = 2.5;

export function createGlider(x: number, y: number, z: number, heading: number, phase: Phase = 'ground', airspeed = 0): GliderState {
  return {
    x, y, z, heading,
    bank: 0, bankRate: 0,
    airspeed, airspeedRate: 0,
    vz: 0, groundSpeed: 0, runSpeed: 0,
    phase, stalled: false, stallTimer: 0, time: 0, takeoffAt: -Infinity, event: null,
  };
}

function secondOrder(value: number, rate: number, target: number, p: { omega: number; zeta: number }, dt: number): [number, number] {
  const acc = p.omega * p.omega * (target - value) - 2 * p.zeta * p.omega * rate;
  const r = rate + acc * dt;
  return [value + r * dt, r];
}

export function stepGlider(s: GliderState, c: Controls, polar: Polar, env: Environment, dt: number): void {
  s.time += dt;
  if (s.phase === 'flying') fly(s, c, polar, env, dt);
  else if (s.phase === 'ground') ground(s, c, polar, env, dt);
}

function fly(s: GliderState, c: Controls, polar: Polar, env: Environment, dt: number): void {
  const brake = (c.brakeLeft + c.brakeRight) / 2;
  const turn = c.brakeRight - c.brakeLeft;

  // Stall: deep symmetric brakes held too long. Recovery needs the hands up.
  s.stallTimer = brake > 0.9 ? s.stallTimer + dt : Math.max(s.stallTimer - 2 * dt, 0);
  if (!s.stalled && s.stallTimer > 1.5) { s.stalled = true; s.event = 'stall'; }
  if (s.stalled && brake < 0.4) { s.stalled = false; s.stallTimer = 0; s.airspeedRate += 3; s.event = 'recovered'; }

  const target = s.stalled ? 3 : polar.targetSpeed(brake, c.speedBar);
  [s.airspeed, s.airspeedRate] = secondOrder(s.airspeed, s.airspeedRate, target, PITCH, dt);
  s.airspeed = Math.max(s.airspeed, 1);

  const bankInput = Math.max(-1, Math.min(1, turn * 0.9 + c.weightShift * 0.25));
  const bankTarget = s.stalled ? 0 : bankInput * polar.maxBank;
  [s.bank, s.bankRate] = secondOrder(s.bank, s.bankRate, bankTarget, ROLL, dt);
  s.heading = wrapAngle(s.heading + ((G * Math.tan(s.bank)) / Math.max(s.airspeed, 5)) * dt);

  const air = env.air(s.x, s.y, s.z, s.time);
  const sink = s.stalled ? 6 : polar.sink(s.airspeed) / Math.cos(s.bank) ** 1.5;
  // Speed bled off (a flare, a pitch-back) is partly converted into height, and vice versa.
  const launching = s.time - s.takeoffAt < LAUNCH_GRACE;
  const zoom = launching ? 0 : (-s.airspeed * s.airspeedRate / G) * ENERGY_RETENTION;
  const ve = s.airspeed * Math.sin(s.heading) + air.u;
  const vn = s.airspeed * Math.cos(s.heading) + air.v;
  s.vz = -sink + air.w + zoom;
  s.x += ve * dt;
  s.y += vn * dt;
  s.z += s.vz * dt;
  s.groundSpeed = Math.hypot(ve, vn);

  const g = env.ground(s.x, s.y);
  if (s.z <= g) {
    s.z = g;
    if (env.isWater(s.x, s.y)) { s.phase = 'water'; s.event = 'water'; return; }
    if (launching && c.run) {
      s.phase = 'ground';
      s.runSpeed = Math.min(s.groundSpeed, RUN_MAX);
      return;
    }
    const hard = -s.vz > HARD_LANDING_SINK || s.groundSpeed > HARD_LANDING_SPEED || s.stalled;
    s.phase = hard ? 'crashed' : 'ground';
    s.event = hard ? 'crashed' : 'landed';
    s.runSpeed = 0;
    s.bank = 0;
    s.bankRate = 0;
    s.stalled = false;
  }
}

function ground(s: GliderState, c: Controls, polar: Polar, env: Environment, dt: number): void {
  // On the ground the brakes steer you on the spot (facing the wing round).
  if (s.runSpeed < 1) s.heading = wrapAngle(s.heading + (c.brakeRight - c.brakeLeft) * 0.9 * dt);
  s.runSpeed = c.run ? Math.min(s.runSpeed + RUN_ACCEL * dt, RUN_MAX) : Math.max(s.runSpeed - 4 * dt, 0);

  const air = env.air(s.x, s.y, s.z + 2, s.time);
  const headwind = -(air.u * Math.sin(s.heading) + air.v * Math.cos(s.heading));
  const airspeed = s.runSpeed + headwind;

  const nx = s.x + s.runSpeed * Math.sin(s.heading) * dt;
  const ny = s.y + s.runSpeed * Math.cos(s.heading) * dt;
  const ng = env.ground(nx, ny);
  const dropsAway = ng < s.z - 1;
  s.x = nx;
  s.y = ny;
  s.groundSpeed = s.runSpeed;
  s.vz = 0;

  if (env.isWater(s.x, s.y)) { s.phase = 'water'; s.event = 'water'; return; }

  // Lift-off: enough airspeed under a flying wing, or running off the edge with some.
  const flyingSpeed = polar.stall * 1.1;
  if (c.run && (airspeed >= flyingSpeed || (dropsAway && airspeed > polar.stall * 0.6))) {
    s.phase = 'flying';
    if (s.time - s.takeoffAt > LAUNCH_GRACE) s.event = 'takeoff';
    s.takeoffAt = s.time;
    // The wing overhead is already flying when the feet leave the ground.
    s.airspeed = Math.max(airspeed, polar.minSinkSpeed);
    s.airspeedRate = 0;
    s.z = ng + 0.3;
    return;
  }
  s.z = ng;
}

export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
