// Scene dressing: the sea (or an inland plain), the sky, the sun, and the lift map the terrain paints
// (the terrain itself is in terrain-view.ts). Sim frame (x east, y north, z up) maps to
// three.js as X = x − e/2, Y = z, Z = e/2 − y, so the site is centred on the origin.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { WindField } from '../sim/wind';

/** Lift map hides anything weaker than this (m/s) — gentle slopes would paint the whole island. */
const LIFT_MAP_MIN = 0.5;

export function toScene(extent: number, x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x - extent / 2, z, extent / 2 - y);
}

/**
 * What surrounds the site out to the horizon: sea at 0 m under everything (an island has
 * water inside its bbox too), or dry farmland at `plainM` with a hole for the site, so a
 * valley floor below the plain's height is never covered.
 */
export function createSurround(extent: number, plainM?: number): THREE.Mesh {
  const R = 200000;
  let geometry: THREE.BufferGeometry;
  if (plainM === undefined) {
    geometry = new THREE.PlaneGeometry(2 * R, 2 * R);
  } else {
    const shape = new THREE.Shape([new THREE.Vector2(-R, -R), new THREE.Vector2(R, -R), new THREE.Vector2(R, R), new THREE.Vector2(-R, R)]);
    const e = extent / 2;
    shape.holes.push(new THREE.Path([new THREE.Vector2(-e, -e), new THREE.Vector2(-e, e), new THREE.Vector2(e, e), new THREE.Vector2(e, -e)]));
    geometry = new THREE.ShapeGeometry(shape);
  }
  geometry.rotateX(-Math.PI / 2);
  const material = plainM === undefined
    ? new THREE.MeshStandardMaterial({ color: 0x0a2a3d, roughness: 0.32, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: 0x8c7a5c, roughness: 1, metalness: 0 });
  const surround = new THREE.Mesh(geometry, material);
  // A plain sits a metre low so the terrain's faded edge meets it without z-fighting.
  surround.position.y = plainM === undefined ? 0 : plainM - 1;
  return surround;
}

const DAY_LIGHT = new THREE.Color(0xfff1dc);
const LOW_SUN_LIGHT = new THREE.Color(0xffb27a);
const HORIZON_LIGHT = new THREE.Color(0xff8a50);
const DAY_FOG = new THREE.Color(0xbfd3e0);
const LOW_SUN_FOG = new THREE.Color(0xd8a184);
const NIGHT_FOG = new THREE.Color(0x1b2130);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The sky, the sun's light, the fog and the ambient light, all set from where the sun is.
 * Near the horizon the sky shader's own scattering turns it orange; the light, fog, exposure
 * and cloud tint follow so the scene reads as one sunset.
 */
export class Sunlight {
  /** Multiply cumulus by this: white at midday, warm at sunset, grey at dusk. */
  readonly cloudTint = new THREE.Color(1, 1, 1);
  private readonly sky = new Sky();
  private readonly envSky = new Sky();
  private readonly envScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly light = new THREE.DirectionalLight(0xffffff, 3.2);
  private readonly fog = new THREE.FogExp2(0xbfd3e0, 0.000032);
  private env: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(450000);
    this.envSky.scale.setScalar(450000);
    // The environment shares the sky's uniforms, so reflections and ambient light match it.
    this.envSky.material = this.sky.material;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.add(this.sky, this.light);
    scene.fog = this.fog;
  }

  /** Sun as a sim-frame unit vector (east, north, up) and its elevation in degrees. */
  set(dir: [number, number, number], elevationDeg: number): void {
    const low = 1 - smoothstep(0, 22, elevationDeg); // 0 high sun … 1 on the horizon
    const day = smoothstep(-5, 1, elevationDeg); // 0 dusk … 1 sun up
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5 + 7 * low;
    u.rayleigh.value = 1.4 + 3 * low;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8 + 0.1 * low;
    u.sunPosition.value.set(dir[0], dir[2], -dir[1]);

    // The light keeps a grazing angle even once the disc is down, so the terrain isn't lit from below.
    const lift = Math.max(elevationDeg, 2) * Math.PI / 180;
    const flat = Math.hypot(dir[0], dir[1]) || 1;
    this.light.position.set((dir[0] / flat) * Math.cos(lift), Math.sin(lift), (-dir[1] / flat) * Math.cos(lift)).multiplyScalar(20000);
    this.light.color.copy(DAY_LIGHT).lerp(LOW_SUN_LIGHT, low ** 1.5).lerp(HORIZON_LIGHT, 1 - smoothstep(0, 4, elevationDeg));
    this.light.intensity = 3.2 * (0.55 + 0.45 * smoothstep(2, 25, elevationDeg)) * day;

    this.fog.color.copy(DAY_FOG).lerp(LOW_SUN_FOG, low ** 2).lerp(NIGHT_FOG, 1 - day);
    this.renderer.toneMappingExposure = 0.5 + 0.15 * low;
    this.cloudTint.setRGB(1, 1, 1).lerp(LOW_SUN_LIGHT, 0.55 * low ** 2).lerp(NIGHT_FOG, 0.8 * (1 - day));

    this.env?.dispose();
    this.env = this.pmrem.fromScene(this.envScene);
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.3 + 0.3 * low;
  }
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
