// Tandem crew: the passenger sits in front and lower, the pilot behind and higher, both in open
// seat harnesses clipped to two spreader bars that hang from the main carabiners. The pilot flies
// the brakes; the passenger holds their shoulder straps. A tandem has trimmers, not a speed bar,
// so nobody's legs move when the wing speeds up.
//
// Dressed after a Famara tandem crew: the pilot in a charcoal softshell, dark trousers, an orange
// open-face helmet, sunglasses and a beard; the passenger in a black softshell and black shorts,
// a black open-face helmet and sunglasses. Both jackets carry the white chevron logo on the chest,
// and the harness webbing is black with mint-green loops.
//
// Same frame as the solo pilot (src/game/wing.ts): origin at the seat base, +Y up, forward −Z.

import * as THREE from 'three';
import type { Controls, GliderState } from '../sim/glider';
import { Gait, solveArm, span, type Arm } from './body';

type Joint = 'hips' | 'neck' | 'head' | 'kneeL' | 'kneeR' | 'footL' | 'footR' | 'shoulderL' | 'shoulderR';
type Pose = Record<Joint, THREE.Vector3>;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Look {
  jacket: number;
  /** Thighs; the shins are `skin` when `shorts`, trouser-coloured otherwise. */
  legs: number;
  shorts: boolean;
  shoe: number;
  skin: number;
  helmet: number;
  /** Darker grooves over the helmet's crown. */
  vents: number;
  beard?: number;
  hair: number;
  /** Body size relative to the pilot. */
  size: number;
}

const PILOT: Look = { jacket: 0x3a3d43, legs: 0x26282d, shorts: false, shoe: 0x1c1d20, skin: 0xc58e6b, helmet: 0xe8862c, vents: 0xb5601a, beard: 0x3a2a20, hair: 0x2e231c, size: 1 };
const PASSENGER: Look = { jacket: 0x1d1e23, legs: 0x18191c, shorts: true, shoe: 0x2a2b2f, skin: 0xc8916d, helmet: 0x1a1b1e, vents: 0x0e0f11, hair: 0x2b2019, size: 0.93 };

// Standing: the passenger runs in front, the pilot right behind. Seated: the passenger reclines in
// front and lower with the legs hanging, the pilot sits up behind so they see over the passenger's
// helmet, knees either side of the passenger's seat.
const POSES: Record<'pilot' | 'passenger', { standing: Pose; seated: Pose }> = {
  passenger: {
    standing: {
      hips: v(0, 0.92, -0.36), neck: v(0, 1.42, -0.38), head: v(0, 1.61, -0.39),
      kneeL: v(-0.1, 0.48, -0.42), kneeR: v(0.1, 0.48, -0.42), footL: v(-0.11, 0.06, -0.34), footR: v(0.11, 0.06, -0.34),
      shoulderL: v(-0.2, 1.36, -0.37), shoulderR: v(0.2, 1.36, -0.37),
    },
    seated: {
      hips: v(0, 0.56, -0.2), neck: v(0, 1.06, -0.1), head: v(0, 1.22, -0.09),
      kneeL: v(-0.11, 0.6, -0.62), kneeR: v(0.11, 0.6, -0.62), footL: v(-0.12, 0.18, -0.76), footR: v(0.12, 0.18, -0.76),
      shoulderL: v(-0.2, 1.0, -0.12), shoulderR: v(0.2, 1.0, -0.12),
    },
  },
  pilot: {
    standing: {
      hips: v(0, 0.95, 0.38), neck: v(0, 1.48, 0.36), head: v(0, 1.68, 0.35),
      kneeL: v(-0.11, 0.5, 0.32), kneeR: v(0.11, 0.5, 0.32), footL: v(-0.12, 0.06, 0.4), footR: v(0.12, 0.06, 0.4),
      shoulderL: v(-0.22, 1.42, 0.37), shoulderR: v(0.22, 1.42, 0.37),
    },
    seated: {
      hips: v(0, 0.88, 0.42), neck: v(0, 1.4, 0.52), head: v(0, 1.56, 0.54),
      kneeL: v(-0.23, 0.84, 0.04), kneeR: v(0.23, 0.84, 0.04), footL: v(-0.27, 0.46, -0.14), footR: v(0.27, 0.46, -0.14),
      shoulderL: v(-0.22, 1.34, 0.5), shoulderR: v(0.22, 1.34, 0.5),
    },
  },
};

const WEBBING = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.8 });
const MINT = new THREE.MeshStandardMaterial({ color: 0x6fcfb0, roughness: 0.7 });
const METAL = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.9 });
const SEAT = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.75 });
const LENS = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.05, metalness: 0.9 });
const WHITE = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.6 });

/** A person in a seat harness: builds the meshes once, `place` poses them. */
function person(parent: THREE.Group, look: Look) {
  const k = look.size;
  const mat = (color: number, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
  const jacket = mat(look.jacket), legs = mat(look.legs), skin = mat(look.skin, 0.7), shoe = mat(look.shoe, 0.6);
  const add = <T extends THREE.Object3D>(o: T): T => { parent.add(o); return o; };
  const limb = (r: number, m: THREE.Material) => add(new THREE.Mesh(new THREE.CylinderGeometry(r * k, r * k * 0.9, 1, 10), m));
  const ball = (r: number, m: THREE.Material) => add(new THREE.Mesh(new THREE.SphereGeometry(r * k, 12, 8), m));

  const torso = add(new THREE.Mesh(new THREE.CylinderGeometry(0.17 * k, 0.15 * k, 1, 14), jacket));
  // The softshell's high collar, zipped up round the neck.
  const collar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.072 * k, 0.088 * k, 1, 12), jacket));
  const pelvis = ball(0.15, legs);
  const shoulders = [ball(0.078, jacket), ball(0.078, jacket)];
  const arms: Arm[] = [0, 1].map(() => ({
    upper: limb(0.054, jacket), fore: limb(0.048, jacket), elbow: ball(0.054, jacket), hand: ball(0.045, skin), length: 0.3 * k,
  }));
  const thighs = [limb(0.075, look.shorts ? skin : legs), limb(0.075, look.shorts ? skin : legs)];
  const shorts = look.shorts ? [limb(0.084, legs), limb(0.084, legs)] : [];
  const shins = [limb(0.056, look.shorts ? skin : legs), limb(0.056, look.shorts ? skin : legs)];
  const knees = [ball(0.07, look.shorts ? skin : legs), ball(0.07, look.shorts ? skin : legs)];
  const shoes = [ball(0.065, shoe), ball(0.065, shoe)];
  shoes.forEach((s) => s.scale.set(0.9, 0.7, 1.7));

  // Chest logo: a white chevron, two thin strokes meeting at the bottom.
  const logo = add(new THREE.Group());
  for (const side of [-1, 1]) {
    const stroke = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.006), WHITE);
    stroke.position.set(side * 0.018, 0.04, 0);
    stroke.rotation.z = side * -0.38;
    logo.add(stroke);
  }

  // Head: face and neck in skin, sunglasses, and an open-face helmet — a cap tilted back so the
  // rim sits above the brow at the front and down over the nape behind.
  const head = add(new THREE.Group());
  head.scale.setScalar(k);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), skin);
  face.scale.set(0.9, 1.1, 1);
  head.add(face);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.1, 10), skin);
  neck.position.y = -0.1;
  head.add(neck);
  // Sphere segments centred on −Z (phi = 1.5π), like the solo pilot's visor.
  const glasses = new THREE.Mesh(new THREE.SphereGeometry(0.104, 20, 4, Math.PI * 1.22, Math.PI * 0.56, Math.PI * 0.4, Math.PI * 0.11), LENS);
  glasses.scale.set(0.9, 1.1, 1);
  head.add(glasses);
  if (look.beard !== undefined) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.103, 20, 6, Math.PI * 1.08, Math.PI * 0.84, Math.PI * 0.6, Math.PI * 0.26), mat(look.beard, 1));
    beard.scale.set(0.9, 1.1, 1);
    head.add(beard);
  }
  {
    // The back half of the head (phi 0..π faces +Z), showing under the helmet's rim.
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.104, 16, 8, 0, Math.PI, Math.PI * 0.3, Math.PI * 0.42), mat(look.hair, 1));
    hair.scale.set(0.93, 1.1, 1.03);
    head.add(hair);
  }
  const shellGeo = new THREE.SphereGeometry(0.128, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const shellCol: number[] = [];
  const sp = shellGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i);
    const groove = y > 0.05 && Math.abs(Math.abs(x) - 0.035) < 0.008;
    const c = new THREE.Color(groove ? look.vents : look.helmet);
    shellCol.push(c.r, c.g, c.b);
  }
  shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(shellCol, 3));
  const shell = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }));
  shell.position.set(0, 0.025, 0.012);
  shell.rotation.x = 0.55;
  shell.scale.set(0.95, 0.95, 1.06);
  head.add(shell);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.006, 4, 20, Math.PI), WEBBING);
  strap.rotation.set(0, Math.PI / 2, Math.PI);
  strap.position.set(0, -0.005, 0.01);
  head.add(strap);

  // Seat harness: a seat plate under the thighs, a padded back, shoulder straps down the chest
  // with mint loops, and a chest strap.
  const seat = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.05 * k, 1, 4, 12), SEAT));
  const back = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.06 * k, 1, 4, 12), SEAT));
  const straps = [0, 1].map(() => limb(0.016, WEBBING));
  const loops = [0, 1].map(() => add(new THREE.Mesh(new THREE.TorusGeometry(0.03 * k, 0.008, 4, 12), MINT)));
  const chestStrap = add(new THREE.Mesh(new THREE.BoxGeometry(0.26 * k, 0.025, 0.012), WEBBING));

  const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  const leg = (i: number, hipX: number, knee: THREE.Vector3, foot: THREE.Vector3, hips: THREE.Vector3) => {
    const hip = hips.clone().setX(hipX);
    span(thighs[i], hip, knee);
    if (look.shorts) span(shorts[i], hip, a.lerpVectors(hip, knee, 0.55));
    span(shins[i], knee, foot);
    knees[i].position.copy(knee);
    shoes[i].position.copy(foot);
  };

  /** Poses the body; `hands` are the targets in the parent's frame, `pole` where the elbows go. */
  function place(p: Pose, hands: [THREE.Vector3, THREE.Vector3], pole: (side: number) => THREE.Vector3, headPitch: number): void {
    up.subVectors(p.neck, p.hips).normalize();
    fwd.set(0, up.z, -up.y); // the way the chest faces: −Z when upright, tipping up as they recline
    span(torso, p.hips, p.neck);
    span(collar, a.copy(p.neck).addScaledVector(up, -0.02), b.copy(p.neck).addScaledVector(up, 0.13 * k));
    pelvis.position.copy(p.hips);
    shoulders[0].position.copy(p.shoulderL);
    shoulders[1].position.copy(p.shoulderR);
    head.position.copy(p.head);
    head.rotation.x = headPitch;
    leg(0, -0.1 * k, p.kneeL, p.footL, p.hips);
    leg(1, 0.1 * k, p.kneeR, p.footR, p.hips);
    solveArm(arms[0], p.shoulderL, hands[0], pole(-1));
    solveArm(arms[1], p.shoulderR, hands[1], pole(1));

    logo.position.lerpVectors(p.hips, p.neck, 0.68).addScaledVector(fwd, 0.163 * k).setX(0.075 * k);
    logo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd);

    // The seat runs under the thighs, the back plate behind the spine.
    const knee = a.lerpVectors(p.kneeL, p.kneeR, 0.5);
    span(seat, b.copy(p.hips).addScaledVector(up, -0.1), b.clone().lerp(knee, 0.7));
    span(back, a.copy(p.hips).addScaledVector(fwd, -0.15 * k), a.clone().addScaledVector(up, 0.4 * k));
    seat.scale.x = 3.6; // wide and flat, not round
    back.scale.x = 3.2;
    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      const sh = side < 0 ? p.shoulderL : p.shoulderR;
      const top = a.copy(sh).addScaledVector(fwd, 0.07 * k).setX(side * 0.1 * k);
      const bottom = b.copy(p.hips).addScaledVector(fwd, 0.14 * k).setX(side * 0.12 * k);
      span(straps[i], top, bottom);
      loops[i].position.lerpVectors(top, bottom, 0.3).addScaledVector(fwd, 0.02);
      loops[i].quaternion.copy(straps[i].quaternion);
    }
    chestStrap.position.lerpVectors(p.hips, p.neck, 0.62).addScaledVector(fwd, 0.17 * k);
    chestStrap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd);
  }

  /** A point on the chest, side × `out` off the centre line, for the hands and the spreader straps. */
  function chest(p: Pose, side: number, out: number, ahead: number, target: THREE.Vector3): THREE.Vector3 {
    up.subVectors(p.neck, p.hips).normalize();
    fwd.set(0, up.z, -up.y);
    return target.lerpVectors(p.hips, p.neck, 0.6).addScaledVector(fwd, ahead * k).setX(side * out * k);
  }

  return { place, chest };
}

export interface TandemCrew {
  group: THREE.Group;
  /** `handle` writes a brake handle's world position for a side (−1 left, 1 right). */
  update(s: GliderState, c: Controls, dt: number, handle: (side: number, brake: number, out: THREE.Vector3) => THREE.Vector3): void;
}

export function createTandem(): TandemCrew {
  const group = new THREE.Group();
  const passenger = person(group, PASSENGER);
  const pilot = person(group, PILOT);
  const gait = new Gait();

  // Spreader bars: one per side, hung from the main carabiner by a short link, the passenger
  // clipped to the front end and the pilot to the rear one.
  const bars = [0, 1].map(() => {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 8), METAL);
    const link = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6), METAL);
    const toPassenger = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1, 0.01), WEBBING);
    const toPilot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1, 0.01), WEBBING);
    group.add(bar, link, toPassenger, toPilot);
    return { bar, link, toPassenger, toPilot };
  });

  const pose = (who: 'pilot' | 'passenger', blend: number): Pose => {
    const { standing, seated } = POSES[who];
    const out = {} as Pose;
    for (const key of Object.keys(standing) as Joint[]) out[key] = standing[key].clone().lerp(seated[key], blend);
    return out;
  };
  const run = (p: Pose, phase: number, swing: number) => {
    const a = Math.sin(phase) * 0.35 * swing;
    p.kneeL.z -= a; p.footL.z -= a * 1.4; p.footL.y += Math.max(a, 0) * 0.5;
    p.kneeR.z += a; p.footR.z += a * 1.4; p.footR.y += Math.max(-a, 0) * 0.5;
    for (const j of ['neck', 'shoulderL', 'shoulderR'] as const) p[j].z -= 0.16 * swing;
    p.head.z -= 0.2 * swing;
  };
  const passengerPole = (side: number) => v(side * 0.8, -1, 0.6);
  const pilotPole = (side: number) => v(side * 0.7, -1, 0.15);
  const handL = new THREE.Vector3(), handR = new THREE.Vector3(), tmp = new THREE.Vector3();

  function update(s: GliderState, c: Controls, dt: number, handle: (side: number, brake: number, out: THREE.Vector3) => THREE.Vector3): void {
    gait.update(s, dt);
    const { flyBlend, runPhase, swing } = gait;
    const pp = pose('passenger', flyBlend), pl = pose('pilot', flyBlend);
    if (swing > 0) { run(pp, runPhase + Math.PI, swing); run(pl, runPhase, swing); }

    // Passenger: hands on the shoulder straps at the chest.
    passenger.place(pp, [passenger.chest(pp, -1, 0.11, 0.2, handL), passenger.chest(pp, 1, 0.11, 0.2, handR)], passengerPole, -0.1 * flyBlend);

    // Pilot: hands on the brake handles, which hang from the swinging canopy.
    group.rotation.z = -c.weightShift * 0.14 * flyBlend;
    group.updateMatrixWorld(true);
    group.worldToLocal(handle(-1, c.brakeLeft, handL));
    group.worldToLocal(handle(1, c.brakeRight, handR));
    pilot.place(pl, [handL, handR], pilotPole, -0.2 * flyBlend);

    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      const { bar, link, toPassenger, toPilot } = bars[i];
      const front = v(side * 0.25, 1.12 - 0.04 * flyBlend, -0.2 - 0.06 * (1 - flyBlend));
      const rear = v(side * 0.25, 1.15, 0.26);
      span(bar, front, rear);
      span(link, v(side * 0.2, 1.2, 0.04), tmp.lerpVectors(front, rear, 0.5));
      span(toPassenger, front, passenger.chest(pp, side, 0.2, 0.02, tmp));
      span(toPilot, rear, pilot.chest(pl, side, 0.21, -0.02, tmp));
    }
  }

  return { group, update };
}
