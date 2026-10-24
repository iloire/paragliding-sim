// Three camera modes: orbit (mouse-driven around the pilot, the default), chase (behind and
// above, smoothed), pilot (the view from the harness, rolling with the swing). Behind the
// welcome screen it circles the pilot wide and slow instead, and blends into the mode on leaving.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GliderState } from '../sim/glider';

export type CameraMode = 'chase' | 'pilot' | 'orbit';
const MODES: CameraMode[] = ['chase', 'pilot', 'orbit'];
/**
 * The menu's circle: metres out, metres above the pilot, radians per second, and how far below
 * the pilot it aims, so the hill under the wing fills the frame rather than the sky.
 */
const SHOWCASE = { radius: 650, height: 220, rate: 0.03, aimBelow: 150 };
/** Seconds to blend between the showcase and a flight camera. */
const BLEND_S = 1.6;

export class CameraRig {
  mode: CameraMode = 'orbit';
  private readonly orbit: OrbitControls;
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly lastTarget = new THREE.Vector3();
  private roll = 0;
  private lastHeading = 0;
  private showing = false;
  private readonly center = new THREE.Vector3();
  private angle = 0;
  /** While blending, the camera shows a mix of `from` and the pose its mode wants (`true*`). */
  private blend = 0;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private readonly truePos = new THREE.Vector3();
  private readonly trueQuat = new THREE.Quaternion();

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enabled = true;
    this.orbit.enableDamping = true;
    this.orbit.maxDistance = 3000;
  }

  /**
   * Circles the pilot for the welcome screen, easing out from wherever the camera is. It starts
   * out ahead of the pilot and a little to the side: facing into the wind is facing off the hill,
   * so the first view is of the slope and the wing in front of it.
   */
  showcase(): void {
    this.showing = true;
    this.orbit.enabled = false;
    this.center.copy(this.lastTarget);
    this.angle = Math.atan2(Math.sin(this.lastHeading), -Math.cos(this.lastHeading)) + 0.5;
    this.startBlend();
  }

  /** Leaves the showcase for the current mode, sweeping in over BLEND_S. */
  fly(): void {
    if (!this.showing) return;
    this.showing = false;
    this.startBlend();
    this.orbit.enabled = this.mode === 'orbit';
    if (this.mode === 'orbit') this.placeOrbit(); // chase and pilot find their own pose on the next update
    this.truePos.copy(this.camera.position);
    this.trueQuat.copy(this.camera.quaternion);
  }

  private startBlend(): void {
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.truePos.copy(this.fromPos);
    this.trueQuat.copy(this.fromQuat);
    this.blend = BLEND_S;
  }

  next(): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.orbit.enabled = this.mode === 'orbit';
    this.camera.up.set(0, 1, 0);
    if (this.mode === 'orbit') this.placeOrbit();
    return this.mode;
  }

  /** Orbit by a screen drag in pixels, as OrbitControls' own drag does; switches to orbit if needed. */
  drag(dx: number, dy: number): void {
    while (this.mode !== 'orbit') this.next();
    const per = (2 * Math.PI) / window.innerHeight;
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dx * per;
    sph.phi = THREE.MathUtils.clamp(sph.phi - dy * per, 0.05, Math.PI - 0.05);
    this.camera.position.copy(this.orbit.target).add(offset.setFromSpherical(sph));
    this.orbit.update();
  }

  /** Jump straight to the camera's position (after a reset) instead of flying there. */
  snap(pilot: THREE.Vector3, s: GliderState): void {
    this.lastTarget.copy(pilot);
    this.lastHeading = s.heading;
    if (this.showing) return; // the circle glides over to the new spot by itself
    if (this.mode === 'orbit') {
      this.placeOrbit();
      return;
    }
    this.chaseTarget(pilot, s);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.look);
  }

  /** Off the pilot's right shoulder, behind and above, rather than inside the helmet. */
  private placeOrbit(): void {
    const fx = Math.sin(this.lastHeading), fz = -Math.cos(this.lastHeading);
    const p = this.lastTarget;
    this.camera.position.set(p.x - fz * 7 - fx * 9, p.y + 3, p.z + fx * 7 - fz * 9);
    this.orbit.target.copy(p);
    this.orbit.update();
  }

  private chaseTarget(pilot: THREE.Vector3, s: GliderState): void {
    const fx = Math.sin(s.heading), fz = -Math.cos(s.heading);
    const back = s.phase === 'flying' ? 26 : 16;
    this.desired.set(pilot.x - fx * back, pilot.y + (s.phase === 'flying' ? 7 : 5), pilot.z - fz * back);
    this.look.set(pilot.x + fx * 12, pilot.y + 4, pilot.z + fz * 12);
  }

  update(dt: number, pilot: THREE.Vector3, s: GliderState, groundY: number): void {
    const cam = this.camera;
    if (this.blend > 0) {
      cam.position.copy(this.truePos);
      cam.quaternion.copy(this.trueQuat);
    }
    if (this.showing) {
      this.center.lerp(pilot, 1 - Math.exp(-dt * 1.2));
      this.angle += SHOWCASE.rate * dt;
      cam.position.set(
        this.center.x + Math.sin(this.angle) * SHOWCASE.radius,
        Math.max(this.center.y + SHOWCASE.height, groundY + 30),
        this.center.z + Math.cos(this.angle) * SHOWCASE.radius,
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(this.center.x, this.center.y - SHOWCASE.aimBelow, this.center.z);
    } else if (this.mode === 'orbit') {
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
    this.lastHeading = s.heading;
    if (this.blend > 0) {
      this.truePos.copy(cam.position);
      this.trueQuat.copy(cam.quaternion);
      this.blend = Math.max(0, this.blend - dt);
      const t = THREE.MathUtils.smootherstep(1 - this.blend / BLEND_S, 0, 1);
      cam.position.lerpVectors(this.fromPos, this.truePos, t);
      cam.quaternion.slerpQuaternions(this.fromQuat, this.trueQuat, t);
    }
  }
}
