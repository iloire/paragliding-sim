// Flight model: the paraglider as one rigid body — canopy, lines and pilot — with full attitude
// and angular velocity. The pilot is a heavy point at the bottom of the lines, the canopy a light
// arched wing 7.5 m above, so the pendulum is the geometry itself: lift at the top, mass at the
// bottom.
//
// The canopy is a row of strips along its arc. Each strip has its own position and tilt on the
// arc, sees its own airflow (the body's velocity plus its rotation) and its own brake, and makes
// lift and drag from its own angle of attack. Nothing about turning is lumped: roll and yaw
// damping, roll into a turn, the arc's dihedral stability, adverse yaw, the side force in a slip
// and the brake turn all come out of the strips. Weight shift moves the pilot's point sideways.
//
// The load the pilot feels is the force the lines must put on him to give him his acceleration.
// If it drops towards zero — over the top of a slow wingover, in a sharp down-gust — the lines are
// slack and the high side folds.
//
// The polar stays the source of truth: each strip's lift and drag are derived from it, and the
// canopy's rigging angle for each brake/bar setting is solved so the body hangs in pitch balance
// and flies straight at the polar's speed (`Rig`).

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

type Vec = [number, number, number];
/** Unit quaternion [w, x, y, z], body → world. */
type Quat = [number, number, number, number];

export interface GliderState {
  /** Pilot position (m). */
  x: number;
  y: number;
  z: number;
  /** Compass heading of the pilot's path through the air, radians, clockwise from north. */
  heading: number;
  /** Pilot's flight-path angle through the air (radians, up positive). */
  gamma: number;
  /** Pilot's airspeed. */
  airspeed: number;
  /** Roll of the line axis about the flight path (radians, right positive). Past ±90° the pilot is over the wing. */
  bank: number;
  bankRate: number;
  /** Body attitude for drawing: compass yaw of the chord, its pitch (nose up +), its roll (right down +). */
  yaw: number;
  pitch: number;
  roll: number;
  /** Mean lift coefficient of the canopy. */
  cl: number;
  clRate: number;
  /** Mean angle of attack of the canopy (radians). */
  alpha: number;
  /** Force the lines put on the pilot, over his weight: the G he feels. Below zero, they're slack. */
  load: number;
  /** Net vertical speed over the ground (m/s, up positive). */
  vz: number;
  groundSpeed: number;
  runSpeed: number;
  phase: Phase;
  stalled: boolean;
  stallTimer: number;
  /** How long both brakes have been held past 90 % (s). */
  deepTimer: number;
  /** −1 = left side collapsed, 1 = right side, 0 = open. */
  collapse: -1 | 0 | 1;
  collapseTimer: number;
  unloadTimer: number;
  inSpiral: boolean;
  time: number;
  /** Sim time of the last lift-off, for the launch grace period. */
  takeoffAt: number;
  /** Set on a phase change (takeoff, landing, stall…) for the UI to pick up and clear. */
  event: string | null;
  /** Rigid body: centre of mass position and velocity (world), attitude, angular velocity (body). */
  cg: Vec;
  vel: Vec;
  q: Quat;
  omega: Vec;
  /** Set when the body needs placing in steady trimmed flight on the next step (spawn, lift-off). */
  trimPending: boolean;
}

export interface Environment {
  air(x: number, y: number, z: number, t: number): AirSample;
  ground(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
}

// ---------------------------------------------------------------- the body
// Body axes: x forward along the chord, y to the left, z up the lines.

const PILOT_MASS = 89;
const CANOPY_MASS = 6;
/** The canopy plus the air trapped in its cells: what its inertia is made of (its weight is CANOPY_MASS). */
const CANOPY_INERTIAL = 11;
const MASS = PILOT_MASS + CANOPY_INERTIAL;
/** Pilot's centre of mass to the canopy's (m). */
const LINE_LENGTH = 7.5;
/** Centre of mass above the pilot. */
const CG_HEIGHT = (CANOPY_INERTIAL * LINE_LENGTH) / MASS;
const AREA = 24;
/** Length of the canopy's arc along the span (m), and its chord. */
const SPAN = 11;
const CHORD = 2.4;
const STRIPS = 6;
/** How far weight shift moves the pilot sideways (m). */
const WEIGHT_SHIFT_M = 0.15;
/** ½ρ (kg/m³): LIFT_K × all-up mass = ½ρ·S. */
const HALF_RHO = (LIFT_K * (PILOT_MASS + CANOPY_MASS)) / AREA;
/** Pilot and harness drag area (m²). */
const PILOT_CDA = 0.5;
const CD_PILOT = PILOT_CDA / AREA;
/** Drag of air flowing along the span across the arched canopy: its fin effect. */
const CD_CROSS = 0.047;
/** Pitch damping (per rad of q·c/2V): the chord's front and back meet the air differently as it rotates. */
const CM_Q = 30;
/**
 * The canopy's own pitch stability: each strip's centre of pressure moves aft as its angle of
 * attack rises above trim (CP_ALPHA chords per radian), and runs further aft past the stall
 * (CP_STALL chords) — so the canopy noses down when its angle grows, and most wings recover by
 * themselves when the brakes go up. Real forces at a moving point: they can't make energy.
 */
const CP_ALPHA = 3.0;
const CP_STALL = 0.72;
const CP_LIMITS = [-1.6, 0.4];

// ---------------------------------------------------------------- aerodynamics
const LIFT_SLOPE = 5;
/**
 * A brake pulls its strip's trailing edge down: the chord turns nose-up by BRAKE_INCIDENCE (rad, at
 * full brake), the profile cambers (CAMBER_CL more lift at the same angle) and drags BRAKE_CD more.
 */
const BRAKE_INCIDENCE = 0.065;
const CAMBER_CL = 0.132;
const BRAKE_CD = 0.005;
/** Past its stall angle a strip's lift falls away over this many radians, to this share, and its drag jumps. */
const STALL_WIDTH = 0.12;
/** Past the stall the profile flies like a flat plate: lift FLAT_CL·sin 2α, drag FLAT_CD·sin²α. */
const FLAT_CL = 1.1;
const FLAT_CD = 1.8;
/** A strip's lift limit, above the polar's: the arc tilts lift away from vertical, so each strip works harder. */
const STRIP_CL_MAX = 1.12;
/** The brake lines pull the outer canopy most: share of a side's brake each strip gets, inner to outer. */
const BRAKE_SHARE = [0.6, 1, 1.4];
/** Both brakes held past 90 %: the trailing edge keeps coming down, adding this incidence over DEEP_HOLD s — the stall. */
const DEEP_STALL_INCIDENCE = 0.2;
const DEEP_HOLD = 1.2;
/** A folded side keeps this share of its lift, and drags this much more. */
const FOLD_LIFT = 0.3;
const FOLD_CD = 0.08;

// ---------------------------------------------------------------- events
const SUBSTEPS = 4;
/** Load below which the lines are slack enough that a side folds. */
const COLLAPSE_LOAD = 0.3;
const COLLAPSE_SECONDS = 2.5;
const SPIRAL_LOAD = 2.2;
const RUN_MAX = 4.2;
const RUN_ACCEL = 2.5;
const HARD_LANDING_SINK = 3.5;
const HARD_LANDING_SPEED = 11;
/** Seconds after lift-off when brushing the slope while still running is a stumble, not a landing. */
const LAUNCH_GRACE = 2.5;

// ---------------------------------------------------------------- vectors

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec): Vec => scale(a, 1 / (len(a) || 1));

/** Rotates a body vector into the world. */
function toWorld(q: Quat, v: Vec): Vec {
  const u: Vec = [q[1], q[2], q[3]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[0])), cross(u, t));
}
/** Rotates a world vector into the body. */
function toBody(q: Quat, v: Vec): Vec {
  return toWorld([q[0], -q[1], -q[2], -q[3]], v);
}
/** Quaternion whose body x, y, z axes are the given orthonormal, right-handed world vectors. */
function fromAxes(x: Vec, y: Vec, z: Vec): Quat {
  const tr = x[0] + y[1] + z[2];
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s];
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    q = [(y[2] - z[1]) / s, s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s];
  } else if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    q = [(z[0] - x[2]) / s, (y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s];
  } else {
    const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
    q = [(x[1] - y[0]) / s, (z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4];
  }
  const n = Math.hypot(...q);
  return q.map((c) => c / n) as Quat;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- the canopy's geometry

interface Strip {
  /** Position relative to the centre of mass, body axes. */
  r: Vec;
  /** Outward normal (the strip's "up") and its spanwise direction, body axes. */
  n: Vec;
  s: Vec;
  /** 1 = left side, −1 = right side. */
  side: 1 | -1;
  /** 0 = by the centre .. STRIPS/2 − 1 = the tip, for the brake share. */
  out: number;
}

interface Geometry { strips: Strip[]; pilot: Vec; canopy: Vec }

/** The angle the canopy's arc spans (rad) on the EN-B, less for a wing more willing to spiral (less dihedral). */
const ARC = 1.879;
const ARC_PER_SPIRAL_TENDENCY = 0.15;
const REFERENCE_SPIRAL_TENDENCY = 0.85;
const REFERENCE_ROLL_AUTHORITY = 0.7;
/** The EN-B's lift coefficient from trim to the stall, which the brake numbers were tuned on. */
const REFERENCE_LIFT_RANGE = 1.152;
/** Tip tilt at full brake (rad): see `tilted`. */
const TIP_TILT = 0.049;

function arcAngle(polar: Polar): number {
  return ARC - ARC_PER_SPIRAL_TENDENCY * (polar.spiralTendency - REFERENCE_SPIRAL_TENDENCY);
}

function geometry(arc: number, shift: number): Geometry {
  const radius = SPAN / arc;
  const canopy: Vec = [0, 0, LINE_LENGTH - CG_HEIGHT];
  const strips: Strip[] = [];
  for (let k = 0; k < STRIPS; k++) {
    const f = (k + 0.5) / STRIPS - 0.5;
    const phi = f * arc; // + = left
    strips.push({
      r: [0, radius * Math.sin(phi), canopy[2] + radius * (Math.cos(phi) - 1)],
      n: [0, Math.sin(phi), Math.cos(phi)],
      s: [0, Math.cos(phi), -Math.sin(phi)],
      side: phi > 0 ? 1 : -1,
      out: Math.floor(Math.abs(f) * STRIPS),
    });
  }
  return { strips, pilot: [0, -shift * WEIGHT_SHIFT_M, -CG_HEIGHT], canopy };
}

/** Inertia about the centre of mass, body axes (diagonal: the body is symmetric). */
function inertia(geo: Geometry): Vec {
  const p = geo.pilot;
  let ixx = PILOT_MASS * (p[1] ** 2 + p[2] ** 2), iyy = PILOT_MASS * p[2] ** 2, izz = PILOT_MASS * p[1] ** 2 + 10;
  const m = CANOPY_INERTIAL / STRIPS;
  for (const st of geo.strips) {
    const [, y, z] = st.r;
    ixx += m * (y * y + z * z);
    iyy += m * (z * z + (CHORD * CHORD) / 12);
    izz += m * (y * y + (CHORD * CHORD) / 12);
  }
  return [ixx, iyy, izz];
}

// ---------------------------------------------------------------- aerodynamics from the polar

/**
 * Lift and drag of one strip, and the canopy's rigging, derived from one wing's polar. A brake
 * pulls its strip's trailing edge down like a flap (more lift at the same angle of attack, a lower
 * stall angle), and the rigging for that brake tilts the chord.
 */
class Rig {
  readonly clMax: number;
  readonly geo: Geometry;
  /** How far a full brake curls its tip down (rad): more on a wing with more roll authority. */
  readonly tipTilt: number;
  /** A brake's incidence and camber, scaled to this wing's lift range from trim to the stall. */
  readonly brakeScale: number;
  /** Scales the polar's drag so a straight glide at trim matches its glide ratio despite the arc. */
  private dragScale = 1;
  private readonly cache = new Map<number, { rig: number; tilt: number; along: number }>();

  constructor(private readonly polar: Polar, readonly arc: number) {
    this.clMax = polar.clMax * STRIP_CL_MAX;
    this.geo = geometry(arc, 0);
    this.tipTilt = (TIP_TILT * polar.rollAuthority) / REFERENCE_ROLL_AUTHORITY;
    this.brakeScale = (polar.clMax - polar.clFor(polar.trim)) / REFERENCE_LIFT_RANGE;
    // Along the path, drag must balance the weight's component: secant on the drag scale.
    let a = 0.6, b = 1.2;
    this.dragScale = a;
    let fa = this.solve(0, 0).along;
    this.dragScale = b;
    let fb = this.solve(0, 0).along;
    for (let i = 0; i < 20 && Math.abs(fb) > 0.01; i++) {
      const c = b - (fb * (b - a)) / (fb - fa);
      a = b; fa = fb; b = c;
      this.dragScale = b; fb = this.solve(0, 0).along;
    }
  }

  alphaStall(brake: number): number {
    return (this.clMax - CAMBER_CL * this.brakeScale * brake) / LIFT_SLOPE;
  }

  cl(alpha: number, brake: number): number {
    const stall = this.alphaStall(brake);
    const attached = Math.max(Math.min(LIFT_SLOPE * alpha + CAMBER_CL * this.brakeScale * brake, this.clMax), -1);
    const k = smoothstep(stall, stall + STALL_WIDTH, alpha);
    return attached * (1 - k) + FLAT_CL * Math.sin(2 * alpha) * k;
  }

  /** The polar's total drag at this lift, less the pilot's share, plus the brake and the stall. */
  cd(alpha: number, brake: number): number {
    const cl = Math.min(Math.max(LIFT_SLOPE * alpha + CAMBER_CL * this.brakeScale * brake, 0.05), this.polar.clMax);
    const clean = Math.max(this.dragScale * this.polar.cdFor(cl) - CD_PILOT, 0.01);
    const stall = this.alphaStall(brake);
    const k = smoothstep(stall, stall + STALL_WIDTH, alpha);
    const attached = clean + BRAKE_CD * brake * brake + (alpha < 0 ? -alpha * 0.3 : 0);
    return attached * (1 - k) + Math.max(FLAT_CD * Math.sin(alpha) ** 2, attached) * k;
  }

  /** A strip's angle of attack flying straight and trimmed, hands up, on this bar. */
  trimAlphaOf(st: Strip, bar: number): number {
    const { rig, tilt } = this.trimmed(bar);
    return Math.atan2(Math.sin(tilt) * st.n[2], Math.cos(tilt)) + rig;
  }

  /**
   * Rigging angle of the chord (set by the line lengths, and shortened at the front by the speed
   * bar), and the body's tilt behind the path normal flying straight hands-up on that bar.
   */
  trimmed(bar: number): { rig: number; tilt: number } {
    const key = Math.round(bar * 100);
    let t = this.cache.get(key);
    if (!t) { t = this.solve(0, bar); this.cache.set(key, t); }
    return { rig: t.rig, tilt: t.tilt };
  }

  /**
   * Straight steady flight at the polar's speed for this brake and bar: find the body's tilt
   * behind the path normal and the strips' rigging so the pitch moment about the centre of mass
   * vanishes and the lift carries the weight.
   */
  private solve(brake: number, bar: number): { rig: number; tilt: number; along: number } {
    const v = this.polar.targetSpeed(brake, bar);
    const g = Math.asin(-this.polar.sink(v) / v);
    const { strips, pilot, canopy } = this.geo;
    let along = 0;
    const residual = (tilt: number, rig: number): [number, number] => {
      // Body axes: flying along the path, pitched up by g + tilt, so the air arrives from below by tilt.
      const air: Vec = [v * Math.cos(tilt), 0, -v * Math.sin(tilt)];
      let F: Vec = [0, 0, 0], M: Vec = [0, 0, 0];
      for (const st of strips) {
        const f = stripForce(this, st, air, rig, stripBrake(brake, st), false);
        F = add(F, f.force);
        M = add(M, cross(st.r, f.force));
      }
      const pd = scale(air, -HALF_RHO * PILOT_CDA * v);
      const th = g + tilt;
      const down: Vec = [-Math.sin(th), 0, -Math.cos(th)];
      const wp = scale(down, PILOT_MASS * G), wc = scale(down, CANOPY_MASS * G);
      F = add(add(add(F, pd), wp), wc);
      M = add(add(add(M, cross(pilot, pd)), cross(pilot, wp)), cross(canopy, wc));
      along = dot(F, [Math.cos(tilt), 0, -Math.sin(tilt)]);
      return [M[1], dot(F, [Math.sin(tilt), 0, Math.cos(tilt)])];
    };
    let tilt = 0.05, rig = 0.05;
    for (let it = 0; it < 50; it++) {
      const [m0, f0] = residual(tilt, rig);
      if (Math.abs(m0) < 1e-3 && Math.abs(f0) < 1e-3) break;
      const d = 1e-6;
      const [m1, f1] = residual(tilt + d, rig);
      const [m2, f2] = residual(tilt, rig + d);
      const a = (m1 - m0) / d, b = (m2 - m0) / d, c = (f1 - f0) / d, e = (f2 - f0) / d;
      const det = a * e - b * c;
      if (Math.abs(det) < 1e-12) break;
      tilt -= (e * m0 - b * f0) / det;
      rig -= (a * f0 - c * m0) / det;
    }
    residual(tilt, rig);
    return { rig, tilt, along };
  }
}

/** The share of a side's brake that reaches one strip: the brake lines pull the outer canopy most. */
function stripBrake(brake: number, st: Strip): number {
  return Math.min(brake * BRAKE_SHARE[st.out], 1);
}

interface StripForce { force: Vec; cl: number; alpha: number }

/** A strip's angle of attack for `air`, its velocity through the air (body axes). */
function stripAlpha(rig: Rig, strip: Strip, air: Vec, rigAngle: number, brake: number): number {
  const st = tilted(strip, brake, rig.tipTilt);
  return Math.atan2(-dot(air, st.n), air[0]) + rigAngle + BRAKE_INCIDENCE * rig.brakeScale * brake;
}

/** Lift and drag on one strip, body axes, for `air`: its velocity through the air. */
/**
 * The brake line pulls its strip's trailing edge — and, towards the tip, the tip itself — down:
 * that side of the arc curls further (Rig.tipTilt radians at the tip at full brake), so its lift
 * leans out sideways. One brake pushes the canopy towards its own side and banks the glider.
 */
function tilted(st: Strip, brake: number, tipTilt: number): Strip {
  if (brake <= 0) return st;
  const phi = Math.atan2(st.n[1], st.n[2]) + st.side * tipTilt * brake * ((st.out + 1) / (STRIPS / 2));
  return { ...st, n: [0, Math.sin(phi), Math.cos(phi)], s: [0, Math.cos(phi), -Math.sin(phi)] };
}

function stripForce(rig: Rig, strip: Strip, air: Vec, rigAngle: number, brake: number, folded: boolean): StripForce {
  const st = tilted(strip, brake, rig.tipTilt);
  const u = air[0], w = dot(air, st.n), sv = dot(air, st.s);
  const vp = Math.hypot(u, w) || 1e-6;
  const alpha = Math.atan2(-w, u) + rigAngle + BRAKE_INCIDENCE * rig.brakeScale * brake;
  let cl = rig.cl(alpha, brake), cd = rig.cd(alpha, brake);
  if (folded) { cl *= FOLD_LIFT; cd += FOLD_CD; }
  const qs = HALF_RHO * (AREA / STRIPS);
  // In the strip's plane (chord and normal): lift across the flow towards the normal, drag against it.
  const along = qs * vp * (cl * -w - cd * u); // × x̂ / vp · vp²
  const normal = qs * vp * (cl * u - cd * w); // × n̂
  const crossflow = -qs * CD_CROSS * sv * Math.abs(sv); // × ŝ: the arc as a fin
  return {
    force: [along, normal * st.n[1] + crossflow * st.s[1], normal * st.n[2] + crossflow * st.s[2]],
    cl,
    alpha,
  };
}


const rigs = new WeakMap<Polar, Rig>();
function rigFor(polar: Polar): Rig {
  let rig = rigs.get(polar);
  if (!rig) { rig = new Rig(polar, arcAngle(polar)); rigs.set(polar, rig); }
  return rig;
}

// ---------------------------------------------------------------- lifecycle

export function createGlider(x: number, y: number, z: number, heading: number, phase: Phase = 'ground', airspeed = 0): GliderState {
  return {
    x, y, z, heading,
    gamma: 0, airspeed,
    bank: 0, bankRate: 0, yaw: heading, pitch: 0, roll: 0,
    cl: 0, clRate: 0, alpha: 0,
    load: 1, vz: 0, groundSpeed: 0, runSpeed: 0,
    phase, stalled: false, stallTimer: 0, deepTimer: 0,
    collapse: 0, collapseTimer: 0, unloadTimer: 0, inSpiral: false,
    time: 0, takeoffAt: -Infinity, event: null,
    cg: [x, y, z + CG_HEIGHT], vel: [0, 0, 0], q: [1, 0, 0, 0], omega: [0, 0, 0],
    trimPending: phase === 'flying',
  };
}

export function stepGlider(s: GliderState, c: Controls, polar: Polar, env: Environment, dt: number): void {
  s.time += dt;
  if (s.phase === 'flying') fly(s, c, polar, env, dt);
  else if (s.phase === 'ground') ground(s, c, polar, env, dt);
}

/** Puts the body in steady straight trimmed flight through the local air, the pilot where he is. */
function trim(s: GliderState, polar: Polar, air: AirSample): void {
  const v = Math.max(s.airspeed, polar.trim);
  const g = Math.asin(-polar.sink(v) / v);
  const tilt = rigFor(polar).trimmed(0).tilt;
  const h: Vec = [Math.sin(s.heading), Math.cos(s.heading), 0];
  const path: Vec = [h[0] * Math.cos(g), h[1] * Math.cos(g), Math.sin(g)];
  const up: Vec = [-h[0] * Math.sin(g), -h[1] * Math.sin(g), Math.cos(g)];
  const xb = unit(add(scale(path, Math.cos(tilt)), scale(up, Math.sin(tilt))));
  const zb = unit(sub(scale(up, Math.cos(tilt)), scale(path, Math.sin(tilt))));
  s.q = fromAxes(xb, cross(zb, xb), zb);
  s.omega = [0, 0, 0];
  s.vel = [path[0] * v + air.u, path[1] * v + air.v, path[2] * v + air.w];
  s.cg = add([s.x, s.y, s.z], toWorld(s.q, [0, 0, CG_HEIGHT]));
  s.airspeed = v;
  s.trimPending = false;
}

// ---------------------------------------------------------------- flight

function fly(s: GliderState, c: Controls, polar: Polar, env: Environment, dt: number): void {
  const rig = rigFor(polar);
  const launching = s.time - s.takeoffAt < LAUNCH_GRACE;
  const airP = env.air(s.x, s.y, s.z, s.time);
  if (s.trimPending) trim(s, polar, airP);
  const top = add(s.cg, toWorld(s.q, [0, 0, LINE_LENGTH - CG_HEIGHT]));
  const airC = env.air(top[0], top[1], top[2], s.time);
  const windC: Vec = [airC.u, airC.v, airC.w], windP: Vec = [airP.u, airP.v, airP.w];

  const geo = geometry(arcAngle(polar), c.weightShift);
  const { strips, pilot, canopy } = geo;
  const I = inertia(geo);
  const sideBrake = (st: Strip) => (st.side > 0 ? c.brakeLeft : c.brakeRight);
  const brakes = strips.map((st) => stripBrake(sideBrake(st), st));
  s.deepTimer = Math.min(c.brakeLeft, c.brakeRight) > 0.9 ? s.deepTimer + dt : 0;
  const deepStall = DEEP_STALL_INCIDENCE * smoothstep(0, DEEP_HOLD, s.deepTimer);
  const rigging = rig.trimmed(c.speedBar).rig + deepStall;
  // Each strip's angle of attack in trimmed straight flight: where its centre of pressure sits.
  const trimAlpha = strips.map((st) => rig.trimAlphaOf(st, c.speedBar));
  const folded = strips.map((st) => (s.collapse === -1 && st.side > 0) || (s.collapse === 1 && st.side < 0));

  const h = dt / SUBSTEPS;
  const prevBank = s.bank, prevCl = s.cl;
  let clSum = 0, alphaSum = 0, stalledShare = 0;

  for (let k = 0; k < SUBSTEPS; k++) {
    const q = s.q, w = s.omega;
    const velB = toBody(q, s.vel);
    const windCB = toBody(q, windC), windPB = toBody(q, windP);
    let F: Vec = [0, 0, 0], M: Vec = [0, 0, 0];

    strips.forEach((st, i) => {
      // Where this strip's lift and drag act along the chord, from its angle of attack now.
      const a0 = stripAlpha(rig, st, sub(add(velB, cross(w, st.r)), windCB), rigging, brakes[i]);
      const stall = rig.alphaStall(brakes[i]);
      const shift = CP_ALPHA * (a0 - trimAlpha[i] - BRAKE_INCIDENCE * rig.brakeScale * brakes[i] - deepStall)
        + CP_STALL * (1 - deepStall / DEEP_STALL_INCIDENCE) * smoothstep(stall, stall + 0.2, a0);
      const at: Vec = [st.r[0] - CHORD * Math.min(Math.max(shift, -CP_LIMITS[1]), -CP_LIMITS[0]), st.r[1], st.r[2]];
      const f = stripForce(rig, st, sub(add(velB, cross(w, at)), windCB), rigging, brakes[i], folded[i]);
      F = add(F, f.force);
      M = add(M, cross(at, f.force));
      clSum += f.cl / STRIPS;
      alphaSum += f.alpha / STRIPS;
      if (f.alpha > stall) stalledShare += 1 / STRIPS;
    });
    // The pilot's drag and weight at his point; the canopy's weight at its own.
    const airPilot = sub(add(velB, cross(w, pilot)), windPB);
    const pd = scale(airPilot, -HALF_RHO * PILOT_CDA * len(airPilot));
    const down = toBody(q, [0, 0, -G]);
    const wp = scale(down, PILOT_MASS), wc = scale(down, CANOPY_MASS);
    F = add(add(add(F, pd), wp), wc);
    M = add(add(add(M, cross(pilot, pd)), cross(pilot, wp)), cross(canopy, wc));

    // Pitch damping: resists the canopy pitching relative to its airflow. In a steady turn or a
    // pull-up the flight path rotates too, and the airflow with it, so only the difference counts.
    const accB = scale(F, 1 / MASS);
    const airB = sub(velB, windCB);
    // (Bounded: a path can't swing faster than a couple of radians a second.)
    const pathTurn = scale(cross(airB, accB), 1 / Math.max(dot(airB, airB), 1)).map((v) => Math.max(-2, Math.min(2, v))) as Vec;
    const vTop = Math.max(len(sub(add(velB, cross(w, canopy)), windCB)), 1);
    M[1] -= HALF_RHO * vTop * vTop * AREA * CHORD * CM_Q * (((w[1] - pathTurn[1]) * CHORD) / (2 * vTop));

    // Rigid body: Newton for the centre of mass, Euler's equations for the rotation.
    const gyro = cross(w, [I[0] * w[0], I[1] * w[1], I[2] * w[2]]);
    const dw: Vec = [(M[0] - gyro[0]) / I[0], (M[1] - gyro[1]) / I[1], (M[2] - gyro[2]) / I[2]];
    const acc = toWorld(q, accB);
    for (let i = 0; i < 3; i++) {
      s.vel[i] += acc[i] * h;
      s.cg[i] += s.vel[i] * h;
      s.omega[i] += dw[i] * h;
    }
    const [qw, qx, qy, qz] = s.q, [ox, oy, oz] = s.omega;
    const nq: Quat = [
      qw + 0.5 * h * (-qx * ox - qy * oy - qz * oz),
      qx + 0.5 * h * (qw * ox + qy * oz - qz * oy),
      qy + 0.5 * h * (qw * oy - qx * oz + qz * ox),
      qz + 0.5 * h * (qw * oz + qx * oy - qy * ox),
    ];
    const nn = Math.hypot(...nq);
    s.q = nq.map((v) => v / nn) as Quat;

    if (k === SUBSTEPS - 1) {
      // The force the lines put on the pilot is what his acceleration needs beyond his weight
      // and drag; along the lines, over his weight, it's the load he feels.
      const aPilot = add(add(accB, cross(dw, pilot)), cross(w, cross(w, pilot)));
      const lineForce = sub(sub(scale(aPilot, PILOT_MASS), wp), pd);
      s.load = dot(lineForce, unit(sub(canopy, pilot))) / (PILOT_MASS * G);
    }
  }

  // What the pilot and the instruments see.
  [s.x, s.y, s.z] = add(s.cg, toWorld(s.q, pilot));
  const vPilot = add(s.vel, toWorld(s.q, cross(s.omega, pilot)));
  const vpa = sub(vPilot, windP);
  s.airspeed = len(vpa);
  const t = scale(vpa, 1 / (s.airspeed || 1));
  s.gamma = Math.asin(Math.max(-1, Math.min(1, t[2])));
  if (Math.hypot(t[0], t[1]) > 1e-3) s.heading = wrapAngle(Math.atan2(t[0], t[1]));
  s.vz = vPilot[2];
  s.groundSpeed = Math.hypot(vPilot[0], vPilot[1]);

  const lineAxis = unit(toWorld(s.q, sub(canopy, pilot)));
  const pathUp = unit(sub([0, 0, 1], scale(t, t[2])));
  s.bank = Math.atan2(dot(lineAxis, cross(t, pathUp)), dot(lineAxis, pathUp));
  s.bankRate = Math.atan2(Math.sin(s.bank - prevBank), Math.cos(s.bank - prevBank)) / dt;
  const fwd = toWorld(s.q, [1, 0, 0]), right = toWorld(s.q, [0, -1, 0]), up = toWorld(s.q, [0, 0, 1]);
  s.yaw = wrapAngle(Math.atan2(fwd[0], fwd[1]));
  s.pitch = Math.asin(Math.max(-1, Math.min(1, fwd[2])));
  s.roll = Math.atan2(-right[2], up[2]);
  s.cl = clSum / SUBSTEPS;
  s.clRate = (s.cl - prevCl) / dt;
  s.alpha = alphaSum / SUBSTEPS;

  // Stall: most of the canopy past its stall angle for a moment.
  const stalled = stalledShare / SUBSTEPS;
  s.stallTimer = stalled > 0.6 ? s.stallTimer + dt : Math.max(s.stallTimer - 2 * dt, 0);
  if (!s.stalled && s.stallTimer > 0.4) { s.stalled = true; s.event = 'stall'; }
  if (s.stalled && stalled < 0.2) { s.stalled = false; s.stallTimer = 0; s.event = 'recovered'; }

  // Slack lines (over the top of a slow wingover, a sharp down-gust) fold the high side.
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
    s.roll = 0;
    s.pitch = 0;
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
  s.yaw = s.heading;
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
    s.gamma = 0;
    s.z = ng + 0.3;
    s.trimPending = true;
    return;
  }
  s.z = ng;
}

export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
