// Procedural paraglider. Built from parameters rather than a mesh file so the shape,
// the brake deflection and a collapse can all be computed per frame:
//
// - Canopy: elliptical planform with swept tips on an anhedral arc, a real airfoil,
//   inflated cells between ribs, open intakes at the nose, seams, a two-tone design.
// - Lines: A/B/C rows cascading in three levels to the risers, brake lines from the
//   trailing edge to handles that move with your brake input.
// - Pilot: pod harness, seated and reclined in flight, standing and running on the
//   ground, arms on two-bone IK holding the brake handles, weight shift leaning the body.
//
// Rig-local frame: origin at the pilot's feet / seat base, +Y up, forward −Z.
// The canopy hangs from a pivot at the carabiners and swings relative to the pilot:
// it surges ahead when the wing accelerates and leads the pilot into a turn.

import * as THREE from 'three';
import type { Controls, GliderState } from '../sim/glider';

const CELLS = 48;
const SUB = 3; // spanwise vertices per cell: rib, two inside the cell
const STATIONS = CELLS * SUB + 1;
const CHORD_SAMPLES = 16;
const ARC_DEG = 62;
const ARC_RADIUS = 5.6;
const ROOT_CHORD = 2.75;
const TIP_CHORD = 0.45;
const THICKNESS = 0.15;
const CARABINER_Y = 1.2;
const CANOPY_TOP = CARABINER_Y + 7.4;
const PILLOW = 0.035;

const COLOURS = {
  top: new THREE.Color(0xd21f2b),
  stripe: new THREE.Color(0xf6f3ee),
  trailing: new THREE.Color(0x8e121b),
  seam: 0.86,
  bottomShade: 0.72,
  intake: new THREE.Color(0x15161a),
  lineA: new THREE.Color(0x9c3a30),
  lineBC: new THREE.Color(0xa88a52),
  lineBrake: new THREE.Color(0xb2603a),
  riser: new THREE.Color(0x24262b),
};

export interface GliderModel {
  group: THREE.Group;
  update(s: GliderState, c: Controls, dt: number): void;
}

interface Station {
  t: number;
  angle: number;
  chord: number;
  leZ: number;
  /** 0 at a rib, up to 1 mid-cell. */
  cellFrac: number;
}

function airfoil(u: number): number {
  // NACA 4-digit half-thickness, normalised to 1 at max thickness.
  return (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4) / 0.5;
}

function chordSample(k: number): number {
  return (1 - Math.cos((k / (CHORD_SAMPLES - 1)) * Math.PI)) / 2; // cosine spacing: fine at the nose
}

function buildStations(): Station[] {
  const out: Station[] = [];
  for (let i = 0; i < STATIONS; i++) {
    const t = (i / (STATIONS - 1)) * 2 - 1;
    const sub = i % SUB;
    const chord = TIP_CHORD + (ROOT_CHORD - TIP_CHORD) * Math.sqrt(Math.max(1 - t * t, 0));
    out.push({
      t,
      angle: Math.sign(t) * THREE.MathUtils.degToRad(ARC_DEG) * Math.abs(t) ** 1.3,
      chord,
      // Nearly straight trailing edge, so the leading edge does the sweeping back to the tips.
      // The pilot hangs just behind the 30 % chord point, so the root's leading edge sits well ahead.
      leZ: 1.7 - 0.25 * t * t - chord,
      cellFrac: Math.sin((sub / SUB) * Math.PI),
    });
  }
  return out;
}

/** Places a unit-height mesh (along +Y, centred) between two points. */
function span(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.scale.set(1, Math.max(len, 1e-3), 1);
}

export function createGlider(): GliderModel {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  // Canopy and lines hang from a pivot at the carabiners so they can swing against the pilot.
  const canopyPivot = new THREE.Group();
  canopyPivot.position.set(0, CARABINER_Y, 0);
  canopyPivot.rotation.order = 'ZXY';
  group.add(canopyPivot);

  // ---------- canopy ----------
  const stations = buildStations();
  const perStation = CHORD_SAMPLES * 2; // top row then bottom row
  const vertexCount = STATIONS * perStation;
  const base = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const colour = new THREE.Color();

  stations.forEach((st, si) => {
    const nx = Math.sin(st.angle), ny = Math.cos(st.angle);
    const cx = ARC_RADIUS * nx;
    const cy = CANOPY_TOP - CARABINER_Y - ARC_RADIUS * (1 - ny);
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < CHORD_SAMPLES; k++) {
        const u = chordSample(k);
        const th = airfoil(u) * THICKNESS * st.chord * 0.5;
        // Cells puff out between the ribs; the trailing edge scallops in mid-cell.
        const puff = Math.sin(Math.PI * u) ** 0.6 * st.cellFrac * st.chord;
        const offset = side === 0 ? th + PILLOW * puff : -0.45 * th - 0.25 * PILLOW * puff;
        const z = st.leZ + u * st.chord - 0.05 * st.chord * st.cellFrac * u ** 6;
        const idx = (si * perStation + side * CHORD_SAMPLES + k) * 3;
        base[idx] = cx + nx * offset;
        base[idx + 1] = cy + ny * offset;
        base[idx + 2] = z;

        // Red, with two white chevrons per side swept back from the nose, darker trailing edge.
        const band = (Math.abs(st.t) * 2.2 + u * 0.9) % 1;
        colour.copy(Math.abs(st.t) > 0.15 && band < 0.14 ? COLOURS.stripe : COLOURS.top);
        if (u > 0.92) colour.lerp(COLOURS.trailing, 0.8);
        if (side === 1) colour.multiplyScalar(COLOURS.bottomShade);
        if (si % SUB === 0) colour.multiplyScalar(COLOURS.seam);
        // Open intakes just under the nose, between the ribs.
        if (side === 1 && u > 0.003 && u < 0.07 && st.cellFrac > 0.5) colour.copy(COLOURS.intake);
        colors.set([colour.r, colour.g, colour.b], idx);
      }
    }
  });

  const indices: number[] = [];
  for (let si = 0; si < STATIONS - 1; si++) {
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < CHORD_SAMPLES - 1; k++) {
        const a = si * perStation + side * CHORD_SAMPLES + k;
        const b = a + perStation;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  // Close the wingtips.
  for (const si of [0, STATIONS - 1]) {
    for (let k = 0; k < CHORD_SAMPLES - 1; k++) {
      const top = si * perStation + k, bottom = top + CHORD_SAMPLES;
      indices.push(top, bottom, top + 1, bottom, bottom + 1, top + 1);
    }
  }

  const canopyGeo = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(base.slice(), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  canopyGeo.setAttribute('position', positions);
  canopyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  canopyGeo.setIndex(indices);
  canopyGeo.computeVertexNormals();
  const canopy = new THREE.Mesh(
    canopyGeo,
    new THREE.MeshPhysicalMaterial({
      vertexColors: true, side: THREE.DoubleSide, roughness: 0.5,
      sheen: 0.7, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff),
    }),
  );
  canopyPivot.add(canopy);

  // ---------- risers ----------
  const riserGeo = new THREE.BoxGeometry(0.035, 1, 0.012);
  const riserMat = new THREE.MeshStandardMaterial({ color: COLOURS.riser, roughness: 0.8 });
  const riserTop = (side: number, row: 'A' | 'C') => new THREE.Vector3(side * 0.24, 0.55, row === 'A' ? -0.06 : 0.07);
  const carabiner = (side: number) => new THREE.Vector3(side * 0.2, 0, 0.04);
  for (const side of [-1, 1]) {
    for (const row of ['A', 'C'] as const) {
      const r = new THREE.Mesh(riserGeo, riserMat);
      span(r, carabiner(side), riserTop(side, row));
      canopyPivot.add(r);
    }
  }

  // ---------- lines ----------
  // Rows by chord position on the bottom surface; each row cascades in groups.
  const ROWS: { u: number; riser: 'A' | 'C'; colour: THREE.Color }[] = [
    { u: 0.1, riser: 'A', colour: COLOURS.lineA },
    { u: 0.33, riser: 'A', colour: COLOURS.lineBC },
    { u: 0.6, riser: 'C', colour: COLOURS.lineBC },
  ];
  const kForU = (u: number) => {
    let best = 0;
    for (let k = 0; k < CHORD_SAMPLES; k++) if (Math.abs(chordSample(k) - u) < Math.abs(chordSample(best) - u)) best = k;
    return best;
  };
  interface Cascade { attach: number[]; riser: THREE.Vector3; colour: THREE.Color }
  const cascades: Cascade[] = [];
  for (const side of [-1, 1]) {
    const ribs: number[] = [];
    for (let si = 0; si < STATIONS; si += SUB) {
      const t = stations[si].t;
      if (Math.sign(t) === side && Math.abs(t) > 0.01) ribs.push(si);
    }
    if (side < 0) ribs.reverse(); // centre → tip
    for (const row of ROWS) {
      const k = kForU(row.u);
      cascades.push({ attach: ribs.map((si) => si * perStation + CHORD_SAMPLES + k), riser: riserTop(side, row.riser), colour: row.colour });
    }
    // Brake lines from the trailing edge of the outer 80 % of the span.
    const brakeRibs = ribs.filter((si) => Math.abs(stations[si].t) > 0.2);
    cascades.push({ attach: brakeRibs.map((si) => si * perStation + CHORD_SAMPLES * 2 - 1), riser: new THREE.Vector3(), colour: COLOURS.lineBrake });
  }

  // Segments: attach→upper (groups of 4), upper→middle (groups of 3), middle→riser.
  let segmentCount = 0;
  for (const c of cascades) {
    const uppers = Math.ceil(c.attach.length / 4);
    segmentCount += c.attach.length + uppers + Math.ceil(uppers / 3);
  }
  const linePos = new Float32Array(segmentCount * 6);
  const lineCol = new Float32Array(segmentCount * 6);
  const linesGeo = new THREE.BufferGeometry();
  const linePosAttr = new THREE.BufferAttribute(linePos, 3);
  linePosAttr.setUsage(THREE.DynamicDrawUsage);
  linesGeo.setAttribute('position', linePosAttr);
  linesGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  const lines = new THREE.LineSegments(linesGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42 }));
  lines.frustumCulled = false;
  canopyPivot.add(lines);

  // ---------- pilot ----------
  const pilot = new THREE.Group();
  group.add(pilot);
  const suit = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.85 });
  const harnessMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff5b1e, roughness: 0.5 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a07a, roughness: 0.8 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.15, metalness: 0.6 });

  const limb = (r: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 1, 10), mat);
    pilot.add(m);
    return m;
  };
  const joint = (r: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
    pilot.add(m);
    return m;
  };

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.14, 1, 14), suit);
  pilot.add(torso);
  const pelvis = joint(0.15, suit);
  const shoulders = [joint(0.075, suit), joint(0.075, suit)];
  const toggles = [0, 1].map(() => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.11, 8), accent);
    t.rotation.z = Math.PI / 2;
    pilot.add(t);
    return t;
  });
  // Head: a face with wraparound glasses under an open shell helmet that sits lower at
  // the back, painted red with a white centre stripe and a dark nape, camera mount on top.
  const helmet = new THREE.Group();
  pilot.add(helmet);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), skin);
  face.scale.set(0.85, 1.05, 0.95);
  face.position.set(0, -0.035, -0.015);
  helmet.add(face);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin);
  nose.position.set(0, -0.045, -0.11);
  helmet.add(nose);
  // Sphere segment centred on −Z (phi = 1.5π), a band just above the face's equator.
  const glasses = new THREE.Mesh(new THREE.SphereGeometry(0.104, 20, 4, Math.PI * 1.17, Math.PI * 0.66, Math.PI * 0.4, Math.PI * 0.11), visorMat);
  face.add(glasses);
  const shellGeo = new THREE.SphereGeometry(0.135, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const shellCol: number[] = [];
  const sp = shellGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const hex = Math.abs(x) < 0.022 && y > 0 ? 0xf6f3ee : z > 0.09 ? 0x23262c : 0xd21f2b;
    const c = new THREE.Color(hex);
    shellCol.push(c.r, c.g, c.b);
  }
  shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(shellCol, 3));
  const shell = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide }));
  shell.scale.set(1, 1, 1.12);
  shell.position.set(0, 0.01, 0.01);
  shell.rotation.x = 0.35; // lifts the brow, drops the rim over the nape
  helmet.add(shell);
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.05), glove);
  mount.position.set(0, 0.145, -0.01);
  helmet.add(mount);
  const upperArms = [limb(0.05, suit), limb(0.05, suit)];
  const foreArms = [limb(0.045, suit), limb(0.045, suit)];
  const elbows = [joint(0.05, suit), joint(0.05, suit)];
  const hands = [joint(0.05, glove), joint(0.05, glove)];
  const thighs = [limb(0.075, suit), limb(0.075, suit)];
  const shins = [limb(0.055, suit), limb(0.055, suit)];
  const knees = [joint(0.07, suit), joint(0.07, suit)];
  const boots = [joint(0.07, harnessMat), joint(0.07, harnessMat)];
  boots.forEach((b) => b.scale.set(0.9, 0.7, 1.6));

  // Pod harness: one teardrop shell from the rounded back protector to the pointed
  // foot of the cocoon, slightly flattened, with orange piping along each side.
  const podProfile = [
    [0, 0.5], [0.18, 0.46], [0.29, 0.36], [0.34, 0.2], [0.34, 0], [0.31, -0.35],
    [0.25, -0.7], [0.17, -0.95], [0.08, -1.08], [0, -1.12],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const podGeo = new THREE.LatheGeometry(podProfile, 32);
  podGeo.rotateX(Math.PI / 2); // lathe axis Y → along Z, nose (feet) forward at −Z
  podGeo.scale(1, 0.9, 1);
  const podCol: number[] = [];
  const pp = podGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    const piping = Math.abs(pp.getY(i)) < 0.022 && Math.abs(pp.getX(i)) > 0.12;
    const c = new THREE.Color(piping ? 0xff5b1e : 0x23262c);
    podCol.push(c.r, c.g, c.b);
  }
  podGeo.setAttribute('color', new THREE.Float32BufferAttribute(podCol, 3));
  podGeo.computeVertexNormals();
  const pod = new THREE.Mesh(podGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  pilot.add(pod);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.4, emissive: 0x0d1a12, emissiveIntensity: 0.6 }));
  pilot.add(deck);

  // Two key poses, blended by how far into flight the pilot has settled.
  type Pose = Record<'hips' | 'neck' | 'head' | 'kneeL' | 'kneeR' | 'footL' | 'footR' | 'shoulderL' | 'shoulderR', THREE.Vector3>;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const standing: Pose = {
    hips: v(0, 0.95, 0.05), neck: v(0, 1.48, 0.02), head: v(0, 1.68, 0.0),
    kneeL: v(-0.11, 0.5, -0.04), kneeR: v(0.11, 0.5, -0.04),
    footL: v(-0.12, 0.06, 0.03), footR: v(0.12, 0.06, 0.03),
    shoulderL: v(-0.22, 1.42, 0.03), shoulderR: v(0.22, 1.42, 0.03),
  };
  const seated: Pose = {
    hips: v(0, 0.86, 0.14), neck: v(0, 1.4, 0.3), head: v(0, 1.6, 0.33),
    kneeL: v(-0.11, 0.82, -0.32), kneeR: v(0.11, 0.82, -0.32),
    footL: v(-0.1, 0.74, -0.86), footR: v(0.1, 0.74, -0.86),
    shoulderL: v(-0.22, 1.34, 0.27), shoulderR: v(0.22, 1.34, 0.27),
  };
  const pose = {} as Pose;
  for (const key of Object.keys(standing) as (keyof Pose)[]) pose[key] = new THREE.Vector3();

  // ---------- state for animation ----------
  let flyBlend = 0;
  let runPhase = 0;
  let foldL = 0;
  let foldR = 0;
  const tmp = new THREE.Vector3();
  const handleWorld = new THREE.Vector3();
  const elbowPole = new THREE.Vector3();

  function brakeHandle(side: number, brake: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(side * 0.27, 0.62 - brake * 0.78, 0.13 + brake * 0.06);
  }

  function solveArm(i: number, shoulder: THREE.Vector3, hand: THREE.Vector3, side: number): void {
    const l1 = 0.3, l2 = 0.3;
    const d = tmp.subVectors(hand, shoulder);
    const dist = Math.min(d.length(), l1 + l2 - 1e-3);
    d.normalize();
    // Elbow sits out to the side and back, the way you hold brakes.
    elbowPole.set(side, -0.3, 0.5).normalize();
    const along = (dist * dist + l1 * l1 - l2 * l2) / (2 * dist);
    const h = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
    const perp = elbowPole.sub(d.clone().multiplyScalar(elbowPole.dot(d))).normalize();
    const elbow = shoulder.clone().addScaledVector(d, along).addScaledVector(perp, h);
    const handPos = shoulder.clone().addScaledVector(d, dist);
    span(upperArms[i], shoulder, elbow);
    span(foreArms[i], elbow, handPos);
    elbows[i].position.copy(elbow);
    hands[i].position.copy(handPos);
  }

  function updateCanopy(brakeL: number, brakeR: number): void {
    for (let si = 0; si < STATIONS; si++) {
      const st = stations[si];
      const side = st.t < 0 ? -1 : 1;
      const brake = side < 0 ? brakeL : brakeR;
      const reach = 0.3 + 0.7 * Math.abs(st.t);
      const fold = side < 0 ? foldL : foldR;
      const nx = Math.sin(st.angle), ny = Math.cos(st.angle);
      // Collapse: the outer part folds down and under about a line at 40 % semispan.
      const f0 = 0.4;
      const d = Math.max((Math.abs(st.t) - f0) / (1 - f0), 0);
      const foldAngle = fold * 2.7 * d ** 0.7;
      const pivotAngle = side * THREE.MathUtils.degToRad(ARC_DEG) * f0 ** 1.3;
      const px = ARC_RADIUS * Math.sin(pivotAngle);
      const py = CANOPY_TOP - CARABINER_Y - ARC_RADIUS * (1 - Math.cos(pivotAngle));
      const ca = Math.cos(-side * foldAngle), sa = Math.sin(-side * foldAngle);
      for (let n = 0; n < perStation; n++) {
        const k = n % CHORD_SAMPLES;
        const u = chordSample(k);
        const idx = (si * perStation + n) * 3;
        const drop = u > 0.55 ? ((u - 0.55) / 0.45) ** 2 * brake * reach * 0.55 * st.chord : 0;
        let x = base[idx] - nx * drop;
        let y = base[idx + 1] - ny * drop;
        let z = base[idx + 2] - drop * 0.35;
        if (foldAngle > 0) {
          const rx = x - px, ry = y - py;
          x = px + rx * ca - ry * sa;
          y = py + rx * sa + ry * ca;
          z += 0.4 * fold * d; // the folded part also drags back
        }
        positions.setXYZ(si * perStation + n, x, y, z);
      }
    }
    positions.needsUpdate = true;
    canopyGeo.computeVertexNormals();
  }

  function updateLines(brakeL: number, brakeR: number): void {
    let o = 0;
    const p = positions.array as Float32Array;
    const push = (a: THREE.Vector3, b: THREE.Vector3, col: THREE.Color) => {
      linePos.set([a.x, a.y, a.z, b.x, b.y, b.z], o * 6);
      lineCol.set([col.r, col.g, col.b, col.r, col.g, col.b], o * 6);
      o++;
    };
    cascades.forEach((c, ci) => {
      const isBrake = c.colour === COLOURS.lineBrake;
      const side = ci < cascades.length / 2 ? -1 : 1;
      const riser = isBrake ? brakeHandle(side, side < 0 ? brakeL : brakeR, new THREE.Vector3()) : c.riser;
      const pts = c.attach.map((vi) => new THREE.Vector3(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]));
      const uppers: THREE.Vector3[] = [];
      for (let g = 0; g < pts.length; g += 4) {
        const grp = pts.slice(g, g + 4);
        const avg = grp.reduce((acc, q) => acc.add(q), new THREE.Vector3()).multiplyScalar(1 / grp.length);
        const node = avg.lerp(riser, 0.38);
        grp.forEach((q) => push(q, node, c.colour));
        uppers.push(node);
      }
      for (let g = 0; g < uppers.length; g += 3) {
        const grp = uppers.slice(g, g + 3);
        const avg = grp.reduce((acc, q) => acc.add(q), new THREE.Vector3()).multiplyScalar(1 / grp.length);
        const node = avg.lerp(riser, 0.55);
        grp.forEach((q) => push(q, node, c.colour));
        push(node, riser, c.colour);
      }
    });
    linePosAttr.needsUpdate = true;
    (linesGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  function updatePilot(s: GliderState, c: Controls, dt: number): void {
    const flying = s.phase === 'flying';
    flyBlend += ((flying ? 1 : 0) - flyBlend) * (1 - Math.exp(-dt * 2.5));
    runPhase += s.runSpeed * dt * 2.6;
    const swing = flying ? 0 : Math.min(s.runSpeed / 4, 1);

    for (const key of Object.keys(pose) as (keyof Pose)[]) pose[key].lerpVectors(standing[key], seated[key], flyBlend);
    // Running: legs scissor, body leans into the run.
    if (swing > 0) {
      const a = Math.sin(runPhase) * 0.35 * swing;
      pose.kneeL.z -= a; pose.footL.z -= a * 1.4; pose.footL.y += Math.max(a, 0) * 0.5;
      pose.kneeR.z += a; pose.footR.z += a * 1.4; pose.footR.y += Math.max(-a, 0) * 0.5;
      pose.neck.z -= 0.18 * swing; pose.head.z -= 0.22 * swing;
      pose.shoulderL.z -= 0.15 * swing; pose.shoulderR.z -= 0.15 * swing;
    }

    span(torso, pose.hips, pose.neck);
    pelvis.position.copy(pose.hips);
    shoulders[0].position.copy(pose.shoulderL);
    shoulders[1].position.copy(pose.shoulderR);
    helmet.position.copy(pose.head);
    helmet.rotation.x = -0.35 * flyBlend;
    span(thighs[0], pose.hips.clone().setX(-0.1), pose.kneeL);
    span(thighs[1], pose.hips.clone().setX(0.1), pose.kneeR);
    span(shins[0], pose.kneeL, pose.footL);
    span(shins[1], pose.kneeR, pose.footR);
    knees[0].position.copy(pose.kneeL);
    knees[1].position.copy(pose.kneeR);
    boots[0].position.copy(pose.footL);
    boots[1].position.copy(pose.footR);

    // Standing, the pod hangs folded behind the legs; seated it zips over them.
    pod.position.set(0, 0.62 + 0.18 * flyBlend, 0.3 - 0.1 * flyBlend);
    pod.scale.set(0.85 + 0.15 * flyBlend, 0.85 + 0.15 * flyBlend, 0.35 + 0.65 * flyBlend);
    pod.rotation.x = 0.1 * flyBlend - 0.25 * (1 - flyBlend);
    deck.visible = flyBlend > 0.5;
    deck.position.set(0, 1.03, -0.42);
    deck.rotation.x = 0.5;
    for (const m of [...thighs, ...shins, ...knees, ...boots]) m.visible = flyBlend < 0.85;

    // Hands follow the brake handles (which hang from the swinging canopy).
    group.updateMatrixWorld(true);
    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      brakeHandle(side, side < 0 ? c.brakeLeft : c.brakeRight, handleWorld);
      canopyPivot.localToWorld(handleWorld);
      pilot.worldToLocal(handleWorld);
      solveArm(i, i === 0 ? pose.shoulderL : pose.shoulderR, handleWorld, side);
      toggles[i].position.copy(hands[i].position);
    }

    // Weight shift leans the body into the turn.
    pilot.rotation.z = -c.weightShift * 0.14 * flyBlend;
  }

  function update(s: GliderState, c: Controls, dt: number): void {
    const flying = s.phase === 'flying';
    // The canopy surges ahead when the wing speeds up and leads the pilot into turns.
    const surge = flying ? THREE.MathUtils.clamp(s.clRate * 0.9, -0.4, 0.4) : 0;
    const lead = flying ? THREE.MathUtils.clamp(-s.bankRate * 0.12, -0.25, 0.25) : 0;
    canopyPivot.rotation.x += (surge - canopyPivot.rotation.x) * (1 - Math.exp(-dt * 6));
    canopyPivot.rotation.z += (lead - canopyPivot.rotation.z) * (1 - Math.exp(-dt * 6));

    const targetL = s.collapse === -1 ? 1 : 0, targetR = s.collapse === 1 ? 1 : 0;
    foldL += (targetL - foldL) * (1 - Math.exp(-dt * (targetL > foldL ? 9 : 2)));
    foldR += (targetR - foldR) * (1 - Math.exp(-dt * (targetR > foldR ? 9 : 2)));

    updateCanopy(c.brakeLeft, c.brakeRight);
    updateLines(c.brakeLeft, c.brakeRight);
    updatePilot(s, c, dt);
  }

  return { group, update };
}
