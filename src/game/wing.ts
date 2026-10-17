// Procedural paraglider: an arched, tapered canopy with cell colours, a line set
// to the risers, and a pilot in a pod harness. Brakes pull the trailing edge down.

import * as THREE from 'three';
import type { GliderState } from '../sim/glider';

const CELLS = 40;
const CHORD_SAMPLES = 10;
const ARC_RADIUS = 8;
const ARC_HALF = THREE.MathUtils.degToRad(48);
const ROOT_CHORD = 2.7;
const LINE_LENGTH = 7.2;
const COLOURS = [0xff5a1f, 0xff5a1f, 0xf5f1e6, 0x183a6b, 0x183a6b, 0xf5f1e6];

interface Station {
  angle: number;
  chord: number;
}

export interface GliderModel {
  group: THREE.Group;
  update(s: GliderState, brakeLeft: number, brakeRight: number): void;
}

function airfoilThickness(u: number): number {
  // NACA-ish half-thickness shape, max near 25 % chord.
  return 0.6 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
}

export function createGlider(): GliderModel {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  const stations: Station[] = [];
  for (let i = 0; i <= CELLS; i++) {
    const t = i / CELLS * 2 - 1;
    stations.push({ angle: t * ARC_HALF, chord: ROOT_CHORD * Math.sqrt(1 - 0.82 * t * t) });
  }

  // Each station has CHORD_SAMPLES top + CHORD_SAMPLES bottom vertices.
  const perStation = CHORD_SAMPLES * 2;
  const base = new Float32Array(stations.length * perStation * 3);
  const colors = new Float32Array(base.length);
  const colour = new THREE.Color();
  stations.forEach((st, si) => {
    const radial = new THREE.Vector3(Math.sin(st.angle), Math.cos(st.angle), 0);
    const centre = new THREE.Vector3(ARC_RADIUS * Math.sin(st.angle), LINE_LENGTH + ARC_RADIUS * (Math.cos(st.angle) - 1), 0);
    colour.setHex(COLOURS[Math.min(si, CELLS - 1) % COLOURS.length]);
    for (let k = 0; k < CHORD_SAMPLES; k++) {
      const u = (k / (CHORD_SAMPLES - 1)) ** 1.6;
      const z = -st.chord * 0.25 + u * st.chord; // forward is −Z; leading edge ahead of the lines
      const th = airfoilThickness(u) * st.chord * 0.75;
      for (const [side, sign] of [[0, 1], [1, -0.35]] as const) {
        const p = centre.clone().addScaledVector(radial, th * sign);
        p.z = z;
        const idx = (si * perStation + side * CHORD_SAMPLES + k) * 3;
        base.set([p.x, p.y, p.z], idx);
        const shade = side === 0 ? 1 : 0.55;
        colors.set([colour.r * shade, colour.g * shade, colour.b * shade], idx);
      }
    }
  });

  const indices: number[] = [];
  for (let si = 0; si < CELLS; si++) {
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < CHORD_SAMPLES - 1; k++) {
        const a = si * perStation + side * CHORD_SAMPLES + k;
        const b = a + perStation;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    // Close the leading edge between top and bottom.
    const t0 = si * perStation, b0 = t0 + CHORD_SAMPLES;
    indices.push(t0, b0, t0 + perStation, b0, b0 + perStation, t0 + perStation);
  }
  const canopyGeo = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(base.slice(), 3);
  canopyGeo.setAttribute('position', positions);
  canopyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  canopyGeo.setIndex(indices);
  canopyGeo.computeVertexNormals();
  const canopy = new THREE.Mesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }),
  );
  canopy.castShadow = true;
  group.add(canopy);

  // Lines: every other station, three rows, to the left/right riser.
  const lineVerts: number[] = [];
  const riserL = new THREE.Vector3(-0.22, 1.25, 0.05), riserR = new THREE.Vector3(0.22, 1.25, 0.05);
  for (let si = 1; si < CELLS; si += 2) {
    for (const k of [1, 4, 7]) {
      const idx = (si * perStation + CHORD_SAMPLES + k) * 3;
      const r = base[idx] < 0 ? riserL : riserR;
      lineVerts.push(base[idx], base[idx + 1], base[idx + 2], r.x, r.y, r.z);
    }
  }
  const linesGeo = new THREE.BufferGeometry();
  linesGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
  group.add(new THREE.LineSegments(linesGeo, new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.55 })));

  // Pilot: pod harness + helmet. Seated on the flying pose, upright on the ground.
  const pilot = new THREE.Group();
  const suitMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
  const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 6, 12), suitMat);
  pilot.add(pod);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.4 }));
  pilot.add(helmet);
  group.add(pilot);

  const tmp = new THREE.Vector3();
  function update(s: GliderState, brakeLeft: number, brakeRight: number): void {
    const flying = s.phase === 'flying';
    // Seated: pod lies back, head above the risers. Standing: upright, feet on the ground.
    pod.rotation.x = flying ? Math.PI / 2 - 0.35 : 0;
    pod.position.set(0, flying ? 0.75 : 0.85, flying ? 0.35 : 0);
    helmet.position.set(0, flying ? 1.25 : 1.75, flying ? -0.1 : 0);

    // Brakes deflect the rear 35 % of the chord, more towards the tips.
    for (let si = 0; si < stations.length; si++) {
      const t = si / CELLS * 2 - 1;
      const brake = t < 0 ? brakeLeft : brakeRight;
      const reach = 0.35 + 0.65 * Math.abs(t);
      for (let n = 0; n < perStation; n++) {
        const k = n % CHORD_SAMPLES;
        const u = (k / (CHORD_SAMPLES - 1)) ** 1.6;
        const idx = (si * perStation + n) * 3;
        const drop = u > 0.65 ? ((u - 0.65) / 0.35) ** 2 * brake * reach * 0.9 : 0;
        tmp.set(base[idx], base[idx + 1], base[idx + 2]);
        positions.setXYZ(si * perStation + n, tmp.x, tmp.y - drop, tmp.z - drop * 0.3);
      }
    }
    positions.needsUpdate = true;
    canopyGeo.computeVertexNormals();
  }

  return { group, update };
}
