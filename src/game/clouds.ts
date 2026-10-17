// Cumulus at cloudbase over each mature thermal: a few soft sprites per cloud,
// drawn from a fixed pool so nothing is allocated per frame.

import * as THREE from 'three';
import type { Cloud } from '../sim/thermals';
import { toScene } from './world';

const POOL = 40;
const PUFFS = 7;

function puffTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(250,250,252,0.75)');
  grad.addColorStop(1, 'rgba(240,242,246,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CloudLayer {
  readonly group = new THREE.Group();
  private readonly clouds: { group: THREE.Group; material: THREE.SpriteMaterial }[] = [];

  constructor(private readonly extent: number) {
    const tex = puffTexture();
    for (let c = 0; c < POOL; c++) {
      const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true });
      const group = new THREE.Group();
      for (let p = 0; p < PUFFS; p++) {
        const s = new THREE.Sprite(material);
        const a = (p / PUFFS) * Math.PI * 2;
        const r = p === 0 ? 0 : 0.35 + ((p * 37) % 10) / 30;
        s.position.set(Math.cos(a) * r, (p === 0 ? 0.25 : ((p * 13) % 7) / 25), Math.sin(a) * r);
        const k = p === 0 ? 1.1 : 0.7 + ((p * 29) % 10) / 25;
        s.scale.set(k, k * 0.62, 1);
        group.add(s);
      }
      group.visible = false;
      this.group.add(group);
      this.clouds.push({ group, material });
    }
  }

  update(clouds: Cloud[]): void {
    for (let i = 0; i < POOL; i++) {
      const slot = this.clouds[i];
      const c = clouds[i];
      slot.group.visible = !!c;
      if (!c) continue;
      toScene(this.extent, c.x, c.y, c.z, slot.group.position);
      slot.group.scale.setScalar(c.size);
      slot.material.opacity = 0.92 * c.opacity;
    }
  }
}
