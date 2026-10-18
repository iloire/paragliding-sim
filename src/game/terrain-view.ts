// The terrain as a grid of square chunks. Far away every chunk is the coarse site mesh
// (~23 m vertices) draped with the site-wide orthophoto. Near the camera a chunk that has
// a detail tile swaps to a 10 m mesh, then the native 5 m one, each with its own sharper
// photo, built and freed as the camera moves. Chunk edges hang skirts so the seams between
// levels never show sky. The material adds a fine grain close up (the photo is ~1.5 m/px)
// and paints the lift map.

import * as THREE from 'three';
import type { Heightmap } from '../sim/terrain';
import type { DetailTile } from './site';

/** Coarse-mesh segments per chunk side. */
const BASE_SEGS = 128;
/** Detail meshes: full = native DEM grid, half = every other sample. */
const LEVEL_SEGS = [0, 300, 600];
/** Camera distance (m) under which a tile goes to level 1, level 2. */
const LEVEL_DIST = [Infinity, 4500, 1500];
/** A tile only drops a level once the camera is this much further than the threshold. */
const HYSTERESIS = 1.2;
const SKIRT_M = 80;
/** Land within this distance of the bbox edge slopes down to what lies beyond (sea or plain) instead of ending in a wall. */
const EDGE_FADE_M = 700;

export interface TerrainUniforms {
  liftMap: { value: THREE.Texture };
  liftOn: { value: number };
  siteExtent: { value: number };
}

function terrainMaterial(map: THREE.Texture, uniforms: TerrainUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
  material.customProgramCacheKey = () => 'terrain';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSite;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSite = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSite;
uniform sampler2D liftMap;
uniform float liftOn;
uniform float siteExtent;
float tHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float grainFade = 1.0 - smoothstep(60.0, 700.0, distance(vSite, cameraPosition));
float grain = tNoise(vSite.xz / 0.7) * 0.45 + tNoise(vSite.xz / 2.6) * 0.35 + tNoise(vSite.xz / 11.0) * 0.2;
diffuseColor.rgb *= mix(1.0, 0.75 + 0.5 * grain, grainFade);`)
      // The same grain as a bump, so dark ground (picón, lava) shows texture in the light too.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 gp = vSite.xz / 0.45, gq = vSite.xz / 1.7;
  float g0 = tNoise(gp) + 0.6 * tNoise(gq);
  float gx = tNoise(gp + vec2(0.2, 0.0)) + 0.6 * tNoise(gq + vec2(0.2, 0.0));
  float gz = tNoise(gp + vec2(0.0, 0.2)) + 0.6 * tNoise(gq + vec2(0.0, 0.2));
  float bumpFade = 1.0 - smoothstep(25.0, 250.0, distance(vSite, cameraPosition));
  vec3 bump = vec3(g0 - gx, 0.0, g0 - gz) * 0.9 * bumpFade;
  normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);
}`)
      .replace('#include <tonemapping_fragment>', `if (liftOn > 0.5) {
  vec4 lift = texture2D(liftMap, vec2(vSite.x / siteExtent + 0.5, 0.5 - vSite.z / siteExtent));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, lift.rgb, lift.a);
}
#include <tonemapping_fragment>`);
  };
  return material;
}

/**
 * A square patch of terrain mesh from (x0, y0) in the site frame, with skirts.
 * `uvRect` is the patch's place in its photo: [u0, v0, du, dv].
 */
function buildPatch(terrain: Heightmap, x0: number, y0: number, size: number, segs: number,
  uvRect: [number, number, number, number]): THREE.BufferGeometry {
  const e = terrain.extent;
  const step = size / segs;
  const n = segs + 1;
  // Heights with a one-sample ring around the patch for the normals.
  const w = segs + 3;
  const h = new Float32Array(w * w);
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + (i - 1) * step, y = y0 + (j - 1) * step;
      const z = terrain.heightAt(x, y);
      const fade = Math.min(Math.max(Math.min(x, y, e - x, e - y) / EDGE_FADE_M, 0), 1);
      h[j * w + i] = z > 0 ? z * fade + terrain.outside * (1 - fade) : z;
    }
  }

  const count = n * n + 4 * n;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const [u0, v0, du, dv] = uvRect;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const c = (j + 1) * w + i + 1;
      const x = x0 + i * step, y = y0 + j * step;
      pos[k * 3] = x - e / 2;
      pos[k * 3 + 1] = h[c];
      pos[k * 3 + 2] = e / 2 - y;
      // Scene normal from the slopes: (−∂h/∂x, 1, ∂h/∂y), since scene Z points south.
      const hx = (h[c + 1] - h[c - 1]) / (2 * step);
      const hy = (h[c + w] - h[c - w]) / (2 * step);
      const len = Math.hypot(hx, 1, hy);
      nor[k * 3] = -hx / len;
      nor[k * 3 + 1] = 1 / len;
      nor[k * 3 + 2] = hy / len;
      uv[k * 2] = u0 + (i / segs) * du;
      uv[k * 2 + 1] = v0 + (j / segs) * dv;
    }
  }

  const index: number[] = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, d = a + n, c = d + 1;
      index.push(a, b, d, b, c, d);
    }
  }
  // Skirts: each edge vertex copied SKIRT_M lower, drawn from both sides.
  const edges = [
    (t: number) => t, // south
    (t: number) => segs * n + t, // north
    (t: number) => t * n, // west
    (t: number) => t * n + segs, // east
  ];
  let s = n * n;
  for (const edge of edges) {
    for (let t = 0; t < n; t++, s++) {
      const k = edge(t);
      pos.set([pos[k * 3], pos[k * 3 + 1] - SKIRT_M, pos[k * 3 + 2]], s * 3);
      nor.set(nor.subarray(k * 3, k * 3 + 3), s * 3);
      uv.set(uv.subarray(k * 2, k * 2 + 2), s * 2);
      if (t === 0) continue;
      const a = edge(t - 1), b = k, sa = s - 1, sb = s;
      index.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

interface Chunk {
  col: number;
  row: number;
  base: THREE.Mesh;
  detail?: {
    url: string;
    level: number;
    loading: boolean;
    texture?: THREE.Texture;
    mesh?: THREE.Mesh;
  };
}

export class TerrainView {
  readonly group = new THREE.Group();
  readonly uniforms: TerrainUniforms;
  private readonly chunks: Chunk[] = [];
  private readonly chunkM: number;
  private readonly loader = new THREE.TextureLoader();

  constructor(
    private readonly terrain: Heightmap,
    ortho: THREE.Texture,
    tileM: number,
    tiles: DetailTile[],
    liftMap: THREE.Texture,
    private readonly anisotropy: number,
  ) {
    const e = terrain.extent;
    this.uniforms = { liftMap: { value: liftMap }, liftOn: { value: 0 }, siteExtent: { value: e } };
    ortho.colorSpace = THREE.SRGBColorSpace;
    ortho.anisotropy = anisotropy;
    const baseMaterial = terrainMaterial(ortho, this.uniforms);
    this.chunkM = tileM || e / 8;
    const per = Math.round(e / this.chunkM);
    for (let row = 0; row < per; row++) {
      for (let col = 0; col < per; col++) {
        const x0 = col * this.chunkM, y0 = row * this.chunkM, f = this.chunkM / e;
        const base = new THREE.Mesh(buildPatch(terrain, x0, y0, this.chunkM, BASE_SEGS, [x0 / e, y0 / e, f, f]), baseMaterial);
        base.receiveShadow = true;
        this.group.add(base);
        const tile = tiles.find((t) => t.col === col && t.row === row);
        this.chunks.push({ col, row, base, detail: tile && { url: tile.orthoUrl, level: 0, loading: false } });
      }
    }
  }

  setLift(on: boolean): void {
    this.uniforms.liftOn.value = on ? 1 : 0;
  }

  /** Picks each tile's level for a camera at scene position `cam`, `agl` metres above the ground. */
  update(cam: THREE.Vector3, agl: number): void {
    const e = this.terrain.extent;
    const cx = cam.x + e / 2, cy = e / 2 - cam.z;
    let next: { chunk: Chunk; want: number; dist: number } | undefined;
    for (const chunk of this.chunks) {
      const d = chunk.detail;
      if (!d) continue;
      const x0 = chunk.col * this.chunkM, y0 = chunk.row * this.chunkM;
      const dx = Math.max(x0 - cx, 0, cx - x0 - this.chunkM);
      const dy = Math.max(y0 - cy, 0, cy - y0 - this.chunkM);
      const dist = Math.hypot(dx, dy, Math.max(agl, 0));
      let want = 0;
      for (let level = LEVEL_DIST.length - 1; level > 0; level--) {
        if (dist < LEVEL_DIST[level] * (d.level >= level ? HYSTERESIS : 1)) { want = level; break; }
      }
      if (want > 0 && !d.texture && !d.loading) this.loadPhoto(d);
      if (want > 0 && !d.texture) want = 0;
      if (want !== d.level && (!next || dist < next.dist)) next = { chunk, want, dist };
    }
    // One rebuild per frame keeps the hitches small; nearest tile first.
    if (next) this.setLevel(next.chunk, next.want);
  }

  private loadPhoto(d: NonNullable<Chunk['detail']>): void {
    d.loading = true;
    this.loader.load(d.url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.anisotropy;
      d.texture = texture;
      d.loading = false;
    });
  }

  private setLevel(chunk: Chunk, level: number): void {
    const d = chunk.detail!;
    if (d.mesh) {
      this.group.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
      d.mesh = undefined;
    }
    d.level = level;
    chunk.base.visible = level === 0;
    if (level === 0) {
      // Out of range: free the photo too; the browser cache makes reloading cheap.
      d.texture?.dispose();
      d.texture = undefined;
      return;
    }
    const geometry = buildPatch(this.terrain, chunk.col * this.chunkM, chunk.row * this.chunkM, this.chunkM,
      LEVEL_SEGS[level], [0, 0, 1, 1]);
    d.mesh = new THREE.Mesh(geometry, terrainMaterial(d.texture!, this.uniforms));
    d.mesh.receiveShadow = true;
    this.group.add(d.mesh);
  }
}
