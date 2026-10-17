// Three camera modes: chase (behind and above, smoothed), pilot (the view from
// the harness, rolling with the swing), orbit (mouse-driven around the pilot).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GliderState } from '../sim/glider';

export type CameraMode = 'chase' | 'pilot' | 'orbit';
const MODES: CameraMode[] = ['chase', 'pilot', 'orbit'];

export class CameraRig {
  mode: CameraMode = 'chase';
  private readonly orbit: OrbitControls;
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly lastTarget = new THREE.Vector3();
  private roll = 0;

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.maxDistance = 3000;
  }

  next(): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.orbit.enabled = this.mode === 'orbit';
    this.camera.up.set(0, 1, 0);
    return this.mode;
  }

  /** Jump straight to the chase position (after a reset) instead of flying there. */
  snap(pilot: THREE.Vector3, s: GliderState): void {
    this.chaseTarget(pilot, s);
    this.camera.position.copy(this.desired);
    this.lastTarget.copy(pilot);
    this.camera.lookAt(this.look);
  }

  private chaseTarget(pilot: THREE.Vector3, s: GliderState): void {
    const fx = Math.sin(s.heading), fz = -Math.cos(s.heading);
    const back = s.phase === 'flying' ? 26 : 16;
    this.desired.set(pilot.x - fx * back, pilot.y + (s.phase === 'flying' ? 7 : 5), pilot.z - fz * back);
    this.look.set(pilot.x + fx * 12, pilot.y + 4, pilot.z + fz * 12);
  }

  update(dt: number, pilot: THREE.Vector3, s: GliderState, groundY: number): void {
    const cam = this.camera;
    if (this.mode === 'orbit') {
      // Carry the camera along with the pilot, keep the user's angle.
      cam.position.add(new THREE.Vector3().subVectors(pilot, this.lastTarget));
      this.orbit.target.copy(pilot);
      this.orbit.update();
    } else if (this.mode === 'chase') {
      this.chaseTarget(pilot, s);
      cam.position.lerp(this.desired, 1 - Math.exp(-dt * 2.5));
      cam.position.y = Math.max(cam.position.y, groundY + 2);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    } else {
      // Pilot view: from the helmet, yawed with the heading, rolled with a share of the bank.
      this.roll += (s.bank * 0.7 - this.roll) * (1 - Math.exp(-dt * 4));
      cam.position.set(pilot.x, pilot.y + 1.4, pilot.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(-0.12, -s.heading, -this.roll);
    }
    this.lastTarget.copy(pilot);
  }
}
