// Flight model: a point mass driven by lift, drag and gravity, in wind axes —
// airspeed V, flight-path angle γ, heading ψ, bank μ:
//
//   dV/dt = −D − g·sin γ
//   dγ/dt = (L·cos μ − g·cos γ) / V
//   dψ/dt = L·sin μ / (V·cos γ)
//
// (L and D per unit mass.) Energy trades between speed and height on its own, so the
// flare, the surge after a brake release, wingovers and spiral dives are not scripted.
//
// The wing's pitch attitude is the lift coefficient: brakes and bar set a target CL,
// and CL follows it through a damped response (the pitch pendulum), with a speed-
// stability term that pulls the wing back towards its trim speed. Bank is the roll
// pendulum: brake/weight-shift input rolls it with an authority that grows with speed,
// the pilot's weight rolls it back level, and past ~55° at high G that restoring
// moment fades by the wing's spiral tendency — so a held brake winds into a spiral.

import { G, LIFT_K, type Polar } from './polar';
import type { AirSample } from './wind';

export { G };

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
  /** Compass heading of the flight path through the air, radians, clockwise from north. */
  heading: number;
  /** Flight-path angle through the air (radians, up positive). */
  gamma: number;
  airspeed: number;
  /** Bank of the lift vector (radians, right positive). */
  bank: number;
  bankRate: number;
  /** Lift coefficient — the wing's pitch attitude. */
  cl: number;
  clRate: number;
  /** Load factor (G) felt by the pilot. */
  load: number;
  /** Net vertical speed over the ground (m/s, up positive). */
  vz: number;
  groundSpeed: number;
  runSpeed: number;
  phase: Phase;
  stalled: boolean;
  stallTimer: number;
  /** −1 = left side collapsed, 1 = right side, 0 = open. */
  collapse: -1 | 0 | 1;
  collapseTimer: number;
  unloadTimer: number;
  /** Slow-filtered vertical air, so a sudden change shows up as a gust on the wing. */
  airW: number;
  inSpiral: boolean;
  time: number;
  /** Sim time of the last lift-off, for the launch grace period. */
  takeoffAt: number;
  /** Set on a phase change (takeoff, landing, stall…) for the UI to pick up and clear. */
  event: string | null;
}

export interface Environment {
  air(x: number, y: number, z: number, t: number): AirSample;
  ground(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
}

const PITCH = { omega: 2.2, zeta: 0.55 };
/** Roll pendulum: ~4.3 s natural period, lightly damped — the rhythm of a wingover. */
const ROLL = { omega: 1.45, zeta: 0.28 };
/** How strongly the wing pitches to hold its trim speed (pendulum stability). */
const SPEED_STABILITY = 0.6;
/** Extra drag per G above 1: the yawed, braked wing and the pilot in a spiral. */
const SPIRAL_DRAG = 0.04;
const TURN_DRAG = 0.02;
const WEIGHT_SHIFT_SHARE = 0.35;
const DEEP_BRAKE = 0.7;
const DEEP_BRAKE_GAIN = 0.8;
const AUTHORITY_MAX = 1.2;
/** Past this bank the pilot's weight swings far out and pulls back hard — the pendulum's wall. */
const BANK_WALL = 1.1;
const BANK_WALL_GAIN = 20;
/** Load factor below which the wing unloads and a side folds. */
const COLLAPSE_LOAD = 0.3;
const COLLAPSE_SECONDS = 2.5;
const SPIRAL_LOAD = 2.2;
/** CL change per (m/s of vertical gust ÷ airspeed): a sharp down-gust drops the angle of attack. */
const GUST_CL = 2.5;
const GUST_TAU = 1.0;
const STALL_CL_FACTOR = 0.3;
const STALL_CD = 1.0;
const GAMMA_LIMIT = 1.45;
const RUN_MAX = 4.2;
const RUN_ACCEL = 2.5;
const HARD_LANDING_SINK = 3.5;
const HARD_LANDING_SPEED = 11;
/** Seconds after lift-off when brushing the slope while still running is a stumble, not a landing. */
const LAUNCH_GRACE = 2.5;

export function createGlider(x: number, y: number, z: number, heading: number, phase: Phase = 'ground', airspeed = 0): GliderState {
  return {
    x, y, z, heading,
    gamma: 0, airspeed,
    bank: 0, bankRate: 0,
    cl: airspeed > 0 ? steadyCl(airspeed) : 0, clRate: 0,
    load: 1, vz: 0, groundSpeed: 0, runSpeed: 0,
    phase, stalled: false, stallTimer: 0,
    collapse: 0, collapseTimer: 0, unloadTimer: 0, airW: 0, inSpiral: false,
    time: 0, takeoffAt: -Infinity, event: null,
  };
}

/** CL of a steady glide at this airspeed (the polar-free form, for spawning). */
function steadyCl(v: number): number {
  return G / (LIFT_K * v * v);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

export function stepGlider(s: GliderState, c: Controls, polar: Polar, env: Environment, dt: number): void {
  s.time += dt;
  if (s.phase === 'flying') fly(s, c, polar, env, dt);
  else if (s.phase === 'ground') ground(s, c, polar, env, dt);
}

function fly(s: GliderState, c: Controls, polar: Polar, env: Environment, dt: number): void {
  const brake = (c.brakeLeft + c.brakeRight) / 2;
  const turn = c.brakeRight - c.brakeLeft;
  const launching = s.time - s.takeoffAt < LAUNCH_GRACE;

  // Stall: deep symmetric brakes held, or the wing simply flying too slow. Hands up to recover.
  s.stallTimer = brake > 0.9 || s.airspeed < polar.stall * 0.8 ? s.stallTimer + dt : Math.max(s.stallTimer - 2 * dt, 0);
  if (!s.stalled && s.stallTimer > 1.2) { s.stalled = true; s.event = 'stall'; s.collapse = 0; }
  if (s.stalled && brake < 0.4 && s.stallTimer < 0.6) { s.stalled = false; s.event = 'recovered'; }
  if (s.stalled && brake < 0.4) s.stallTimer = Math.max(s.stallTimer - 2 * dt, 0);

  // Pitch: brakes/bar pick a CL; the pendulum holds the wing near the speed that CL flies at.
  const target = polar.targetSpeed(brake, c.speedBar);
  const clTarget = polar.clFor(target);
  const clCmd = s.stalled
    ? polar.clMax * STALL_CL_FACTOR
    : Math.min(clTarget * (1 + (SPEED_STABILITY * (s.airspeed - target)) / target), polar.clMax * 1.05);
  const clAcc = PITCH.omega ** 2 * (clCmd - s.cl) - 2 * PITCH.zeta * PITCH.omega * s.clRate;
  s.clRate += clAcc * dt;
  s.cl = Math.max(s.cl + s.clRate * dt, 0.02);

  const V = Math.max(s.airspeed, 1);
  const air = env.air(s.x, s.y, s.z, s.time);
  const gust = air.w - s.airW;
  s.airW += gust * (1 - Math.exp(-dt / GUST_TAU));

  // A folded side lifts less and drags more; a gust moves the angle of attack for a moment.
  const folded = s.collapse !== 0 ? 1 : 0;
  const cl = Math.max(s.cl * (1 - 0.35 * folded) + (GUST_CL * gust) / V, -0.2);
  const lift = LIFT_K * V * V * cl;
  s.load = lift / G;
  const cd = s.stalled
    ? STALL_CD
    : polar.cdFor(s.cl) + SPIRAL_DRAG * Math.max(s.load - 1, 0) + TURN_DRAG * Math.abs(turn) + 0.04 * folded;
  const drag = LIFT_K * V * V * cd;

  // Roll pendulum.
  // Past ~70 % one brake bites much harder: the inner wing slows, yaws in, and the turn tightens.
  const deep = Math.max(Math.abs(turn) - DEEP_BRAKE, 0) / (1 - DEEP_BRAKE);
  const input = Math.max(-2, Math.min(2, turn + Math.sign(turn) * DEEP_BRAKE_GAIN * deep + c.weightShift * WEIGHT_SHIFT_SHARE));
  const authority = Math.min(V / polar.trim, AUTHORITY_MAX) * polar.rollAuthority;
  const spiral = polar.spiralTendency * smoothstep(0.95, 1.3, Math.abs(s.bank)) * smoothstep(1.5, 3, s.load);
  const over = Math.max(Math.abs(s.bank) - BANK_WALL, 0);
  const restoring = Math.sin(s.bank) * (1 - spiral) + Math.sign(s.bank) * BANK_WALL_GAIN * over * over;
  const collapseRoll = s.collapse * 0.55;
  const rollAcc = ROLL.omega ** 2 * (authority * input + collapseRoll - restoring) - 2 * ROLL.zeta * ROLL.omega * s.bankRate;
  s.bankRate += rollAcc * dt;
  s.bank += s.bankRate * dt;
  if (s.stalled) s.bank *= 1 - 2 * dt;

  // Wind-axes point-mass equations.
  const cosG = Math.cos(s.gamma);
  s.airspeed = Math.max(V + (-drag - G * Math.sin(s.gamma)) * dt, 0.5);
  s.gamma += ((lift * Math.cos(s.bank) - G * cosG) / V) * dt;
  s.gamma = Math.max(-GAMMA_LIMIT, Math.min(GAMMA_LIMIT, s.gamma));
  s.heading = wrapAngle(s.heading + ((lift * Math.sin(s.bank)) / (V * Math.max(cosG, 0.15))) * dt);

  // Unloading (the top of a mistimed wingover) folds the high side.
  s.unloadTimer = s.load < COLLAPSE_LOAD && !s.stalled && !launching ? s.unloadTimer + dt : 0;
  if (s.collapse === 0 && s.unloadTimer > 0.15) {
    s.collapse = s.bank >= 0 ? -1 : 1;
    s.collapseTimer = COLLAPSE_SECONDS;
    s.event = 'collapse';
  }
  if (s.collapse !== 0) {
    // Pumping the folded side's brake helps it reopen.
    const pump = s.collapse < 0 ? c.brakeLeft : c.brakeRight;
    s.collapseTimer -= dt * (1 + pump);
    if (s.collapseTimer <= 0) { s.collapse = 0; s.event = 'reinflated'; }
  }

  if (!s.inSpiral && s.load > SPIRAL_LOAD && Math.abs(s.bank) > 0.9) { s.inSpiral = true; s.event = 'spiral'; }
  if (s.inSpiral && s.load < 1.4) s.inSpiral = false;

  const horizontal = s.airspeed * Math.cos(s.gamma);
  const ve = horizontal * Math.sin(s.heading) + air.u;
  const vn = horizontal * Math.cos(s.heading) + air.v;
  s.vz = s.airspeed * Math.sin(s.gamma) + air.w;
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
    const hard = -s.vz > HARD_LANDING_SINK || s.groundSpeed > HARD_LANDING_SPEED || s.stalled || Math.abs(s.bank) > 0.6;
    s.phase = hard ? 'crashed' : 'ground';
    s.event = hard ? 'crashed' : 'landed';
    s.runSpeed = 0;
    s.bank = 0;
    s.bankRate = 0;
    s.gamma = 0;
    s.stalled = false;
    s.collapse = 0;
    s.inSpiral = false;
    s.load = 1;
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
    // The wing overhead is already flying at trim when the feet leave the ground.
    s.airspeed = Math.max(airspeed, polar.trim);
    s.cl = polar.clFor(s.airspeed);
    s.clRate = 0;
    s.gamma = 0;
    s.z = ng + 0.3;
    return;
  }
  s.z = ng;
}

export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
