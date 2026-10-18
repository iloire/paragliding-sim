// Shared pieces for the people under the wing: placing primitives between two points,
// two-bone arm IK, and the ground-to-flight gait both the solo pilot and the tandem crew follow.

import * as THREE from 'three';
import type { GliderState } from '../sim/glider';

/** Places a unit-height mesh (along +Y, centred) between two points. */
export function span(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.scale.set(1, Math.max(len, 1e-3), 1);
}

export interface Arm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  elbow: THREE.Object3D;
  hand: THREE.Object3D;
  /** Upper arm and forearm length, m. */
  length: number;
}

const tmp = new THREE.Vector3();
const perp = new THREE.Vector3();

/** Two-bone IK from the shoulder to a hand target; the elbow bends towards `pole`. */
export function solveArm(arm: Arm, shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): void {
  const l = arm.length;
  const d = tmp.subVectors(target, shoulder);
  const dist = Math.min(d.length(), 2 * l - 1e-3);
  d.normalize();
  const along = dist / 2;
  const h = Math.sqrt(Math.max(l * l - along * along, 0));
  perp.copy(pole).normalize().addScaledVector(d, -pole.clone().normalize().dot(d)).normalize();
  const elbow = shoulder.clone().addScaledVector(d, along).addScaledVector(perp, h);
  const hand = shoulder.clone().addScaledVector(d, dist);
  span(arm.upper, shoulder, elbow);
  span(arm.fore, elbow, hand);
  arm.elbow.position.copy(elbow);
  arm.hand.position.copy(hand);
}

/** How far into flight the crew has settled (0 standing … 1 seated), and the run cycle. */
export class Gait {
  flyBlend = 0;
  runPhase = 0;
  /** 0..1: how hard the legs swing in the run. */
  swing = 0;

  update(s: GliderState, dt: number): void {
    const flying = s.phase === 'flying';
    this.flyBlend += ((flying ? 1 : 0) - this.flyBlend) * (1 - Math.exp(-dt * 2.5));
    this.runPhase += s.runSpeed * dt * 2.6;
    this.swing = flying ? 0 : Math.min(s.runSpeed / 4, 1);
  }
}
