// Draws the charts in docs/physics/ by running the real sim code, so the figures in
// docs/physics.md show what the model does rather than what we think it does.
// Run after changing the flight or air model: npm run physics-figures
//
// The concept diagrams in the same folder (forces, bank, ridge, thermal, wing-model) are
// hand-drawn SVG and are not touched by this script.

import { writeFileSync } from 'node:fs';
import { createGlider, stepGlider, type Controls, type Environment, type GliderState } from '../src/sim/glider';
import { Polar, WINGS, type WingId } from '../src/sim/polar';
import { cliffTerrain, calmWeather, EXTENT } from '../src/sim/fixtures';
import { WindField } from '../src/sim/wind';
import { ThermalField, envelope, type Thermal } from '../src/sim/thermals';

const OUT = new URL('../docs/physics/', import.meta.url);
const STEP = 1 / 120;
const KMH = 3.6;
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------- chart drawing

const C = {
  surface: '#fcfcfb', text: '#0b0b0b', muted: '#52514e', grid: '#e7e6e2', axis: '#9a9993',
  blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', red: '#e34948', ground: '#b8ad9e', neutral: '#f1f0ec',
};
const WING_COLOR: Record<WingId, string> = { 'EN-A': C.aqua, 'EN-B': C.blue, 'EN-C': C.orange };
const FONT = `font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"`;
const W = 760, ML = 70, MR = 30, PW = W - ML - MR;

type Pt = [number, number];
interface Series { name: string; color: string; points: Pt[]; dashed?: boolean }
interface Marker { x: number; y: number; label: string; color: string; above?: boolean }
interface Rule { at: number; label: string }
interface Panel { yLabel: string; series: Series[]; y?: [number, number]; markers?: Marker[]; hRules?: Rule[]; height?: number }
interface Chart { title: string; subtitle: string; xLabel: string; x: [number, number]; panels: Panel[]; vRules?: Rule[] }

function ticks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function autoRange(series: Series[]): [number, number] {
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Number(v.toFixed(2))).replace('-', '−'));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function header(title: string, subtitle: string): string {
  return `<text x="${ML - 50}" y="30" font-size="17" font-weight="600" fill="${C.text}">${esc(title)}</text>` +
    `<text x="${ML - 50}" y="52" font-size="13" fill="${C.muted}">${esc(subtitle)}</text>`;
}

function svg(height: number, body: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" ${FONT} role="img" aria-label="${esc(label)}">` +
    `<rect width="100%" height="100%" rx="10" fill="${C.surface}"/>${body}</svg>\n`;
}

function legend(series: Series[], y: number): string {
  let x = ML;
  return series.map((s) => {
    const item = `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" stroke="${s.color}" stroke-width="2.5"${s.dashed ? ' stroke-dasharray="5 4"' : ''}/>` +
      `<text x="${x + 28}" y="${y + 4}" font-size="12" fill="${C.text}">${esc(s.name)}</text>`;
    x += 40 + s.name.length * 6.6;
    return item;
  }).join('');
}

function lineChart(c: Chart): string {
  const parts = [header(c.title, c.subtitle)];
  const xs = (v: number) => ML + ((v - c.x[0]) / (c.x[1] - c.x[0])) * PW;
  const xt = ticks(c.x[0], c.x[1], 8);
  let top = 76;
  const names = (p: Panel) => p.series.map((s) => s.name).join('|');
  c.panels.forEach((p, i) => {
    const h = p.height ?? 180;
    const showLegend = p.series.length > 1 && (i === 0 || names(p) !== names(c.panels[i - 1]));
    const legendH = showLegend ? 24 : 4;
    if (showLegend) parts.push(legend(p.series, top + 6));
    const py = top + legendH;
    const [y0, y1] = p.y ?? autoRange(p.series);
    const ys = (v: number) => py + h - ((v - y0) / (y1 - y0)) * h;
    const last = i === c.panels.length - 1;

    parts.push(`<clipPath id="clip${i}"><rect x="${ML}" y="${py}" width="${PW}" height="${h}"/></clipPath>`);
    for (const t of ticks(y0, y1, 4)) {
      const y = ys(t).toFixed(1);
      parts.push(`<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="${t === 0 ? C.axis : C.grid}" stroke-width="1"/>`);
      parts.push(`<text x="${ML - 8}" y="${Number(y) + 4}" font-size="11" fill="${C.muted}" text-anchor="end">${fmt(t)}</text>`);
    }
    for (const t of xt) {
      const x = xs(t).toFixed(1);
      parts.push(`<line x1="${x}" y1="${py}" x2="${x}" y2="${py + h}" stroke="${C.grid}" stroke-width="1"/>`);
      if (last) parts.push(`<text x="${x}" y="${py + h + 17}" font-size="11" fill="${C.muted}" text-anchor="middle">${fmt(t)}</text>`);
    }
    parts.push(`<rect x="${ML}" y="${py}" width="${PW}" height="${h}" fill="none" stroke="${C.axis}" stroke-width="1"/>`);
    parts.push(`<text transform="translate(${ML - 46} ${py + h / 2}) rotate(-90)" font-size="12" fill="${C.text}" text-anchor="middle">${esc(p.yLabel)}</text>`);

    for (const r of p.hRules ?? []) {
      const y = ys(r.at).toFixed(1);
      parts.push(`<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="${C.muted}" stroke-width="1" stroke-dasharray="3 4"/>`);
      parts.push(`<text x="${ML + PW - 6}" y="${Number(y) - 5}" font-size="11" fill="${C.muted}" text-anchor="end">${esc(r.label)}</text>`);
    }
    for (const r of c.vRules ?? []) {
      const x = xs(r.at).toFixed(1);
      parts.push(`<line x1="${x}" y1="${py}" x2="${x}" y2="${py + h}" stroke="${C.muted}" stroke-width="1" stroke-dasharray="3 4"/>`);
      if (i === 0) parts.push(`<text x="${Number(x) + 5}" y="${py + 14}" font-size="11" fill="${C.muted}">${esc(r.label)}</text>`);
    }
    for (const s of p.series) {
      const pts = s.points.map(([x, y]) => `${xs(x).toFixed(1)},${ys(y).toFixed(1)}`).join(' ');
      parts.push(`<polyline clip-path="url(#clip${i})" points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="5 4"' : ''}/>`);
    }
    for (const m of p.markers ?? []) {
      const x = xs(m.x), y = ys(m.y);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${m.color}" stroke="${C.surface}" stroke-width="2"/>`);
      parts.push(`<text x="${x.toFixed(1)}" y="${(m.above ? y - 10 : y + 18).toFixed(1)}" font-size="11" fill="${C.text}" text-anchor="middle">${esc(m.label)}</text>`);
    }
    top = py + h + (last ? 24 : 14);
  });
  parts.push(`<text x="${ML + PW / 2}" y="${top + 14}" font-size="12" fill="${C.text}" text-anchor="middle">${esc(c.xLabel)}</text>`);
  return svg(top + 30, parts.join(''), c.title);
}

function save(name: string, content: string): void {
  writeFileSync(new URL(name, OUT), content);
  console.log(`docs/physics/${name}`);
}

// ---------------------------------------------------------------- sim helpers

const hands: Controls = { brakeLeft: 0, brakeRight: 0, speedBar: 0, weightShift: 0, run: false };

function flatWorld(w: (t: number) => number = () => 0): Environment {
  return { air: (_x, _y, _z, t) => ({ u: 0, v: 0, w: w(t) }), ground: () => 0, isWater: () => false };
}

interface Sample { t: number; s: GliderState; event: string | null }

/** Flies a glider from trim with controls chosen per time step, sampling every `every` seconds. */
function fly(polar: Polar, seconds: number, controls: (t: number, s: GliderState) => Controls, env = flatWorld(), z = 3000, every = 0.05): Sample[] {
  const s = createGlider(0, 0, z, 0, 'flying', polar.trim);
  const out: Sample[] = [];
  let next = 0, event: string | null = null;
  for (let i = 0; i <= seconds * 120; i++) {
    const t = i * STEP;
    if (s.event) { event = s.event; s.event = null; }
    if (t >= next - 1e-9) { out.push({ t, s: { ...s }, event }); event = null; next += every; }
    stepGlider(s, controls(t, s), polar, env, STEP);
  }
  return out;
}

const series = (name: string, color: string, data: Sample[], f: (s: GliderState) => number, dashed = false): Series =>
  ({ name, color, dashed, points: data.map((d) => [d.t, f(d.s)]) });

const polars = Object.fromEntries((Object.keys(WINGS) as WingId[]).map((id) => [id, new Polar(WINGS[id])])) as Record<WingId, Polar>;
const enb = polars['EN-B'];

// ---------------------------------------------------------------- figures

function polarFigure(): void {
  const sinkSeries: Series[] = [], glideSeries: Series[] = [], markers: Marker[] = [];
  for (const id of Object.keys(polars) as WingId[]) {
    const p = polars[id];
    const pts: Pt[] = [], glide: Pt[] = [];
    for (let v = p.stall * 0.9; v <= p.top + 1e-6; v += 0.05) {
      pts.push([v * KMH, -p.sink(v)]);
      glide.push([v * KMH, v / p.sink(v)]);
    }
    sinkSeries.push({ name: WINGS[id].label, color: WING_COLOR[id], points: pts });
    glideSeries.push({ name: WINGS[id].label, color: WING_COLOR[id], points: glide });
    if (id === 'EN-B') {
      for (const [label, v, above] of [['stall', p.stall, false], ['min sink', p.minSinkSpeed, true], ['trim', p.trim, true], ['top (full bar)', p.top, false]] as const) {
        markers.push({ x: v * KMH, y: -p.sink(v), label, color: WING_COLOR[id], above });
      }
    }
  }
  save('polar.svg', lineChart({
    title: 'Speed polar: sink rate and glide ratio by airspeed',
    subtitle: 'From wings.json via Polar.sink(). Markers are the EN-B spec points. The steep end on the left is the mush before the stall.',
    xLabel: 'Airspeed (km/h)', x: [18, 60],
    panels: [
      { yLabel: 'Vertical speed (m/s)', series: sinkSeries, y: [-4, 0], markers, height: 200 },
      { yLabel: 'Glide ratio (L/D)', series: glideSeries, y: [0, 10], height: 140 },
    ],
  }));
}

function controlsFigure(): void {
  const brake: Pt[] = [], bar: Pt[] = [];
  for (let u = 0; u <= 1.0001; u += 0.01) {
    brake.push([u, enb.targetSpeed(u, 0) * KMH]);
    bar.push([u, enb.targetSpeed(0, u) * KMH]);
  }
  save('controls.svg', lineChart({
    title: 'What the controls ask for: target airspeed (EN-B)',
    subtitle: 'Polar.targetSpeed(): brakes pull it down towards just above the stall (curve: brake^1.3), the bar pushes it up to top speed.',
    xLabel: 'Control travel (0 = released, 1 = full)', x: [0, 1],
    panels: [{
      yLabel: 'Target airspeed (km/h)', y: [20, 56], height: 220,
      series: [
        { name: 'Symmetric brakes', color: C.blue, points: brake },
        { name: 'Speed bar', color: C.orange, points: bar },
      ],
      hRules: [{ at: enb.trim * KMH, label: 'trim 38 km/h' }, { at: enb.stall * KMH, label: 'stall 22 km/h' }],
    }],
  }));
}

function pitchFigure(): void {
  // Half brakes at t = 2 s, released at t = 9 s: the wing slows with an overshoot, then surges.
  const data = fly(enb, 16, (t) => (t >= 2 && t < 9 ? { ...hands, brakeLeft: 0.5, brakeRight: 0.5 } : hands));
  save('pitch-response.svg', lineChart({
    title: 'Pitch pendulum: half brakes on, then released (EN-B)',
    subtitle: 'CL chases its target through a damped spring, so speed overshoots and the glider climbs, then dives and surges on release.',
    xLabel: 'Time (s)', x: [0, 16],
    vRules: [{ at: 2, label: 'brakes 50 %' }, { at: 9, label: 'released' }],
    panels: [
      { yLabel: 'Lift coefficient CL', series: [series('CL', C.blue, data, (s) => s.cl)], height: 120 },
      { yLabel: 'Airspeed (km/h)', series: [series('airspeed', C.blue, data, (s) => s.airspeed * KMH)], height: 120 },
      { yLabel: 'Vertical speed (m/s)', series: [series('vz', C.blue, data, (s) => s.vz)], height: 120 },
    ],
  }));
}

function flareFigure(): void {
  const data = fly(enb, 4, (t) => (t >= 0.5 ? { ...hands, brakeLeft: 1, brakeRight: 1 } : hands), flatWorld(), 100, 0.02);
  save('flare.svg', lineChart({
    title: 'Flare: full brakes from trim (EN-B)',
    subtitle: 'Nothing scripted: CL rises, lift exceeds weight, the path bends upward and airspeed becomes height for about two seconds.',
    xLabel: 'Time (s)', x: [0, 4],
    vRules: [{ at: 0.5, label: 'full brakes' }],
    panels: [
      { yLabel: 'Airspeed (km/h)', series: [series('airspeed', C.blue, data, (s) => s.airspeed * KMH)], height: 130 },
      { yLabel: 'Vertical speed (m/s)', series: [series('vz', C.blue, data, (s) => s.vz)], height: 130 },
    ],
  }));
}

function spiralFigure(): void {
  const runs = (Object.keys(polars) as WingId[]).map((id) => ({
    id, data: fly(polars[id], 32, (t) => (t < 16 ? { ...hands, brakeRight: 0.8 } : hands)),
  }));
  const per = (f: (s: GliderState) => number) => runs.map((r) => series(WINGS[r.id].label, WING_COLOR[r.id], r.data, f));
  save('spiral.svg', lineChart({
    title: 'Spiral dive: one brake held at 80 % for 16 s, then released',
    subtitle: 'EN-B and EN-C wind into a spiral; the EN-A school wing settles in a steep turn. Hands up, all three unwind.',
    xLabel: 'Time (s)', x: [0, 32],
    vRules: [{ at: 16, label: 'brake released' }],
    panels: [
      { yLabel: 'Bank (°)', series: per((s) => s.bank * DEG), y: [-40, 95], height: 150 },
      { yLabel: 'Load factor (G)', series: per((s) => s.load), y: [0, 4.5], height: 120 },
      { yLabel: 'Vertical speed (m/s)', series: per((s) => s.vz), height: 120 },
    ],
  }));
}

function steadyTurnFigure(): void {
  const bank: Series[] = [], sink: Series[] = [];
  for (const id of Object.keys(polars) as WingId[]) {
    const b: Pt[] = [], z: Pt[] = [];
    for (let u = 0; u <= 1.0001; u += 0.025) {
      const data = fly(polars[id], 25, () => ({ ...hands, brakeRight: u }), flatWorld(), 5000, 25);
      const end = data[data.length - 1].s;
      b.push([u, end.bank * DEG]);
      z.push([u, end.vz]);
    }
    bank.push({ name: WINGS[id].label, color: WING_COLOR[id], points: b });
    sink.push({ name: WINGS[id].label, color: WING_COLOR[id], points: z });
  }
  save('steady-turn.svg', lineChart({
    title: 'Where a held brake settles: bank and sink after 25 s',
    subtitle: 'Gentle and linear up to ~70 % brake; past that the deep-brake bite and spiral tendency take over and the turn becomes a spiral.',
    xLabel: 'One brake held (0 = hands up, 1 = full)', x: [0, 1],
    vRules: [{ at: 0.7, label: 'deep-brake bite starts' }],
    panels: [
      { yLabel: 'Bank (°)', series: bank, y: [0, 95], height: 170 },
      { yLabel: 'Vertical speed (m/s)', series: sink, height: 140 },
    ],
  }));
}

function wingoverFigure(): void {
  // Brake and lean on one side, then the other: in the swing's own ~6 s rhythm, and rushed.
  const pump = (brake: number, period: number) => fly(enb, 25, (t) => {
    const side = Math.floor(t / (period / 2)) % 2 === 0 ? 1 : -1;
    return { ...hands, brakeRight: side > 0 ? brake : 0, brakeLeft: side < 0 ? brake : 0, weightShift: side };
  });
  const rhythm = pump(0.8, 6), rushed = pump(0.8, 3);
  save('wingover.svg', lineChart({
    title: 'Wingovers: pumping the pendulum in its rhythm (EN-B)',
    subtitle: 'In the swing\'s ~6 s rhythm each pull adds to the last, past 90°, and the top goes light. Rushed, the swing never builds.',
    xLabel: 'Time (s)', x: [0, 25],
    panels: [
      { yLabel: 'Bank (°)', series: [series('6 s rhythm', C.blue, rhythm, (s) => s.bank * DEG), series('3 s, rushed', C.red, rushed, (s) => s.bank * DEG)], y: [-120, 120], height: 180, hRules: [{ at: 90, label: 'over the wing' }, { at: -90, label: '' }] },
      { yLabel: 'Line load (G)', series: [series('6 s rhythm', C.blue, rhythm, (s) => s.load), series('3 s, rushed', C.red, rushed, (s) => s.load)], y: [0, 3], height: 110, hRules: [{ at: 0.3, label: 'slack: a side folds' }] },
    ],
  }));
}

function gustFigure(): void {
  const gust = (t: number) => (t > 2 ? -5 : 0);
  const data = fly(enb, 8, () => hands, flatWorld(gust), 1000, 0.02);
  const vr = data.filter((d) => d.event).map((d) => ({ at: d.t, label: d.event ?? '' }));
  save('gust-collapse.svg', lineChart({
    title: 'Sharp down-gust: unload, fold, reopen (EN-B, hands up)',
    subtitle: 'The air drops 5 m/s at t = 2 s. The wing sees it as a sudden loss of angle of attack, the load falls under 0.3 G and a side folds.',
    xLabel: 'Time (s)', x: [0, 8],
    vRules: vr,
    panels: [
      { yLabel: 'Air (m/s)', series: [{ name: 'vertical air', color: C.red, points: data.map((d) => [d.t, gust(d.t)]) }], y: [-6, 1], height: 70 },
      { yLabel: 'Load factor (G)', series: [series('load', C.blue, data, (s) => s.load)], height: 130, hRules: [{ at: 0.3, label: '0.3 G' }] },
      { yLabel: 'Bank (°)', series: [series('bank', C.blue, data, (s) => s.bank * DEG)], height: 110 },
    ],
  }));
}

function ridgeFigure(): void {
  // Cross-section through the synthetic 400 m cliff (tests' fixture), wind 22 km/h straight onto it.
  const terrain = cliffTerrain();
  const X = 3000, FOOT = 2000, Y0 = 1300, Y1 = 4900, Z1 = 1000, NX = 90, NZ = 50;
  const panelH = 210, top0 = 76;
  const xs = (y: number) => ML + ((y - Y0) / (Y1 - Y0)) * PW;
  const parts = [header('Ridge lift over a 400 m cliff, wind 22 km/h onto the face', 'WindField.ridgeLift() on the test cliff. Blue = rising air, red = sinking. Left: high inversion. Right: a lid at 500 m squashes the band.')];
  const color = (w: number) => {
    const t = Math.round(Math.max(-1, Math.min(1, w / 3)) * 24) / 24;
    const [a, b] = t >= 0 ? [C.neutral, C.blue] : [C.neutral, C.red];
    return mix(a, b, Math.abs(t));
  };
  const cases = [{ inv: 1500, label: 'Inversion 1500 m' }, { inv: 500, label: 'Inversion 500 m' }];
  let top = top0;
  for (const { inv, label } of cases) {
    const wind = new WindField(terrain, calmWeather({ windSpeedKmh: 22, windFromDeg: 180, inversionM: inv }), 256);
    const zs = (z: number) => top + panelH - (z / Z1) * panelH;
    const cw = PW / NX, ch = panelH / NZ;
    for (let i = 0; i < NX; i++) {
      // One rect per vertical run of equal colour keeps the file small.
      let runStart = 0, runColor = '';
      const flush = (j: number) => {
        if (runColor) parts.push(`<rect x="${(ML + i * cw).toFixed(1)}" y="${(top + panelH - j * ch).toFixed(1)}" width="${(cw + 0.4).toFixed(1)}" height="${((j - runStart) * ch + 0.4).toFixed(1)}" fill="${runColor}"/>`);
      };
      for (let j = 0; j <= NZ; j++) {
        const y = Y0 + ((i + 0.5) / NX) * (Y1 - Y0), z = ((j + 0.5) / NZ) * Z1;
        const col = j === NZ || z < terrain.groundAt(X, y) ? '' : color(wind.ridgeLift(X, y, z));
        if (col !== runColor) { flush(j); runStart = j; runColor = col; }
      }
    }
    const ground: string[] = [];
    for (let y = Y0; y <= Y1; y += 20) ground.push(`${xs(y).toFixed(1)},${zs(Math.max(terrain.groundAt(X, y), 0)).toFixed(1)}`);
    parts.push(`<polygon points="${xs(Y0)},${top + panelH} ${ground.join(' ')} ${xs(Y1)},${top + panelH}" fill="${C.ground}"/>`);
    parts.push(`<rect x="${ML}" y="${zs(0)}" width="${xs(FOOT) - ML}" height="${top + panelH - zs(0)}" fill="#9cc3e6"/>`);
    const invY = zs(inv);
    if (inv < Z1) {
      parts.push(`<line x1="${ML}" y1="${invY}" x2="${ML + PW}" y2="${invY}" stroke="${C.text}" stroke-width="1.2" stroke-dasharray="6 4"/>`);
      parts.push(`<text x="${ML + PW - 6}" y="${invY - 6}" font-size="11" fill="${C.text}" text-anchor="end">inversion</text>`);
    }
    for (const t of [0, 250, 500, 750, 1000]) {
      parts.push(`<text x="${ML - 8}" y="${zs(t) + 4}" font-size="11" fill="${C.muted}" text-anchor="end">${t}</text>`);
    }
    parts.push(`<rect x="${ML}" y="${top}" width="${PW}" height="${panelH}" fill="none" stroke="${C.axis}"/>`);
    parts.push(`<text x="${ML + 8}" y="${top + 18}" font-size="12" font-weight="600" fill="${C.text}">${label}</text>`);
    parts.push(`<text x="${ML + 8}" y="${top + panelH - 10}" font-size="11" fill="${C.text}">sea</text>`);
    parts.push(`<text transform="translate(${ML - 46} ${top + panelH / 2}) rotate(-90)" font-size="12" fill="${C.text}" text-anchor="middle">Height (m)</text>`);
    top += panelH + 18;
  }
  // Wind arrow and colour bar.
  parts.push(`<text x="${ML + 70}" y="${top0 + 40}" font-size="12" fill="${C.text}">wind →</text>`);
  for (const t of [-500, 0, 500, 1000, 1500, 2000, 2500]) {
    parts.push(`<text x="${xs(FOOT + t)}" y="${top + 2}" font-size="11" fill="${C.muted}" text-anchor="middle">${fmt(t)}</text>`);
  }
  parts.push(`<text x="${ML + PW / 2}" y="${top + 20}" font-size="12" fill="${C.text}" text-anchor="middle">Distance downwind of the foot of the cliff (m)</text>`);
  const by = top + 40, bx = ML + PW / 2 - 150;
  for (let k = 0; k < 60; k++) parts.push(`<rect x="${bx + k * 5}" y="${by}" width="5.4" height="10" fill="${color(-3 + (k / 59) * 6)}"/>`);
  parts.push(`<text x="${bx - 8}" y="${by + 9}" font-size="11" fill="${C.muted}" text-anchor="end">−3 m/s sink</text>`);
  parts.push(`<text x="${bx + 308}" y="${by + 9}" font-size="11" fill="${C.muted}">+3 m/s lift</text>`);
  save('ridge-section.svg', svg(by + 30, parts.join(''), 'Ridge lift cross-section'));
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('');
}

function offAngleFigure(): void {
  const terrain = cliffTerrain();
  const pts: Pt[] = [], cos: Pt[] = [];
  let head = 0;
  for (let a = 0; a <= 90; a += 7.5) {
    const wind = new WindField(terrain, calmWeather({ windSpeedKmh: 22, windFromDeg: 180 + a, inversionM: 2000 }), 256);
    const w = wind.ridgeLift(EXTENT / 2, 2300, 450);
    if (a === 0) head = w;
    pts.push([a, w]);
  }
  for (let a = 0; a <= 90; a += 1) cos.push([a, head * Math.cos(a / DEG)]);
  save('off-angle.svg', lineChart({
    title: 'Wind angle against the face: lift ≈ U · slope · cos(off-angle)',
    subtitle: 'Ridge lift 50 m above the cliff top at 22 km/h as the wind swings off the face, with the cosine law dashed for comparison.',
    xLabel: 'Wind off the face normal (°)', x: [0, 90],
    panels: [{
      yLabel: 'Ridge lift (m/s)', height: 200, y: [0, Math.ceil(head + 0.5)],
      series: [{ name: 'model', color: C.blue, points: pts }, { name: 'head-on × cos(angle)', color: C.muted, points: cos, dashed: true }],
    }],
  }));
}

function gradientFigure(): void {
  const terrain = cliffTerrain();
  const wind = new WindField(terrain, calmWeather({ windSpeedKmh: 22, windFromDeg: 180, inversionM: 300 }), 128);
  const pts: Pt[] = [];
  for (let z = -15; z <= 450; z += 1) pts.push([z + 15, wind.windSpeedAt(EXTENT / 2, 1000, z) * KMH]);
  save('wind-gradient.svg', lineChart({
    title: 'Wind speed with height (22 km/h day, inversion at 300 m)',
    subtitle: 'WindField.windSpeedAt(): 60 % at the surface rising to full speed by 40 m, and half speed above the inversion.',
    xLabel: 'Height above the ground (m)', x: [0, 450],
    panels: [{ yLabel: 'Wind speed (km/h)', series: [{ name: 'wind', color: C.blue, points: pts }], y: [0, 25], height: 160 }],
  }));
}

function thermalFigure(): void {
  const field = new ThermalField(cliffTerrain());
  const th: Thermal = { x: 3000, y: 3000, base: 400, radius: 75, strength: 3, born: -120, life: 600 };
  field.thermals = [th];
  const profile: Pt[] = [];
  for (let r = -450; r <= 450; r += 3) profile.push([r, field.sample(3000 + r, 3000, 900, 0, 0, 0, 1500)]);
  const life: Pt[] = [];
  for (let t = -20; t <= 620; t += 2) life.push([t / 60, th.strength * envelope({ ...th, born: 0 }, t)]);
  const height: Pt[] = [];
  for (let z = 400; z <= 1520; z += 5) height.push([z - 400, field.sample(3000, 3000, z, 0, 0, 0, 1500)]);
  save('thermal-profile.svg', lineChart({
    title: 'A thermal across its core (radius 75 m, 3 m/s, 500 m above its trigger)',
    subtitle: 'ThermalField.sample(): a Gaussian core with a ring of sink at about 2.2 radii, a quarter of the core strength.',
    xLabel: 'Distance from the core (m)', x: [-450, 450],
    panels: [{ yLabel: 'Vertical air (m/s)', series: [{ name: 'w', color: C.blue, points: profile }], y: [-1.5, 3.5], height: 180 }],
  }));
  save('thermal-life.svg', lineChart({
    title: 'A thermal\'s life: core climb over a 10-minute cycle',
    subtitle: 'envelope(): a 60 s ramp up, a long mature phase, a 90 s decay. Then it is replaced by a new one somewhere else.',
    xLabel: 'Minutes since the thermal triggered', x: [0, 11],
    panels: [{ yLabel: 'Core climb (m/s)', series: [{ name: 'core', color: C.blue, points: life }], y: [0, 3.5], height: 130 }],
  }));
  save('thermal-height.svg', lineChart({
    title: 'Core climb with height (trigger at 400 m, cloudbase at 1500 m)',
    subtitle: 'Weak in the first 60 m while the bubble organises, full strength up the column, fading over the last 150 m below cloudbase.',
    xLabel: 'Height above the trigger point (m)', x: [0, 1120],
    panels: [{ yLabel: 'Core climb (m/s)', series: [{ name: 'core', color: C.blue, points: height }], y: [0, 3.5], height: 130 }],
  }));
}

polarFigure();
controlsFigure();
pitchFigure();
flareFigure();
steadyTurnFigure();
spiralFigure();
wingoverFigure();
gustFigure();
ridgeFigure();
offAngleFigure();
gradientFigure();
thermalFigure();
