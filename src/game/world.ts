// Scene dressing: the sea (or an inland plain), the sky, the sun, and the lift map the terrain paints
// (the terrain itself is in terrain-view.ts). Sim frame (x east, y north, z up) maps to
// three.js as X = x − e/2, Y = z, Z = e/2 − y, so the site is centred on the origin.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { WindField } from '../sim/wind';

const SUN_ELEVATION = 48;
const SUN_AZIMUTH = 215;
/** Lift map hides anything weaker than this (m/s) — gentle slopes would paint the whole island. */
const LIFT_MAP_MIN = 0.5;

export function toScene(extent: number, x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x - extent / 2, z, extent / 2 - y);
}

/** What surrounds the site out to the horizon: sea at 0 m, or dry farmland at `plainM`. */
export function createSurround(plainM?: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(400000, 400000);
  geometry.rotateX(-Math.PI / 2);
  const material = plainM === undefined
    ? new THREE.MeshStandardMaterial({ color: 0x0a2a3d, roughness: 0.32, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: 0x8c7a5c, roughness: 1, metalness: 0 });
  const surround = new THREE.Mesh(geometry, material);
  // A plain sits a metre low so the terrain's faded edge meets it without z-fighting.
  surround.position.y = plainM === undefined ? 0 : plainM - 1;
  return surround;
}

export function createSkyAndLight(scene: THREE.Scene, renderer: THREE.WebGLRenderer): THREE.DirectionalLight {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  const sun = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION),
    THREE.MathUtils.degToRad(180 - SUN_AZIMUTH),
  );
  u.sunPosition.value.copy(sun);
  scene.add(sky);

  // Reflections and ambient light come from the same sky.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 0.3;

  const light = new THREE.DirectionalLight(0xfff1dc, 3.2);
  light.position.copy(sun).multiplyScalar(20000);
  scene.add(light);
  scene.fog = new THREE.FogExp2(0xbfd3e0, 0.000032);
  return light;
}

/** Ridge lift at ridge-top height as an RGBA map over the site: green up, red down. */
export function createLiftMap(wind: WindField): { texture: THREE.DataTexture; refresh(): void } {
  const g = wind.grid;
  const data = new Uint8Array(g * g * 4);
  const texture = new THREE.DataTexture(data, g, g);
  texture.magFilter = THREE.LinearFilter;
  function refresh(): void {
    const U = wind.speed;
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const k = j * g + i;
        const x = (i + 0.5) * wind.cell, y = (j + 0.5) * wind.cell;
        const w = wind.ridgeLift(x, y, wind.ridgeTop[k]);
        const a = Math.min((Math.abs(w) - LIFT_MAP_MIN) / 2.5, 1);
        data[k * 4] = w < 0 ? 240 : 60;
        data[k * 4 + 1] = w > 0 ? 235 : 70;
        data[k * 4 + 2] = w > 0 ? 90 : 60;
        data[k * 4 + 3] = U > 0 && Math.abs(w) > LIFT_MAP_MIN ? Math.round(45 + a * 120) : 0;
      }
    }
    texture.needsUpdate = true;
  }
  return { texture, refresh };
}
