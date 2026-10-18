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

/** A cross-section of a lofted hull: at `z`, half-width `w`, from `bottom` to `top`. */
export interface Section { z: number; w: number; bottom: number; top: number }
export const sec = (z: number, w: number, bottom: number, top: number): Section => ({ z, w, bottom, top });

/**
 * A hull lofted through rounded-box (superellipse) sections along Z, capped at both ends.
 * `paint` colours each vertex from its section, z, height share fy (0 bottom … 1 top) and
 * `up` (sine of the angle round the ring: 1 on top, −1 underneath).
 */
export function loft(sections: Section[], paint: (s: Section, z: number, fy: number, up: number) => THREE.Color): THREE.BufferGeometry {
  const RING = 36, EXP = 2.6;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (const s of sections) {
    for (let k = 0; k <= RING; k++) {
      const a = (k / RING) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const mid = (s.top + s.bottom) / 2, h = (s.top - s.bottom) / 2;
      const y = mid + h * Math.sign(sa) * Math.abs(sa) ** (2 / EXP);
      pos.push(s.w * Math.sign(ca) * Math.abs(ca) ** (2 / EXP), y, s.z);
      const c = paint(s, s.z, (y - s.bottom) / Math.max(s.top - s.bottom, 1e-3), sa);
      col.push(c.r, c.g, c.b);
    }
  }
  const R = RING + 1;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < RING; k++) {
      const a = i * R + k, b = a + R;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // Fan caps at both ends.
  for (const [i, flip] of [[0, true], [sections.length - 1, false]] as const) {
    const s = sections[i];
    const centre = pos.length / 3;
    pos.push(0, (s.top + s.bottom) / 2, s.z);
    col.push(col[i * R * 3], col[i * R * 3 + 1], col[i * R * 3 + 2]);
    for (let k = 0; k < RING; k++) {
      const a = i * R + k;
      if (flip) idx.push(centre, a + 1, a); else idx.push(centre, a, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
