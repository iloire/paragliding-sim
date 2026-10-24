// The wing the pilot flies: an EN class (src/sim/wings.json) at a size, aspect ratio and all-up
// weight off a manufacturer's sheet. Presets live in wing-presets.json; the card shows what a
// setup does to the polar before you fly it.

import { canopyProportions } from '../sim/glider';
import { Polar, REFERENCE_ALL_UP, REFERENCE_AREA, WINGS, type WingId, type WingSetup } from '../sim/polar';
import type { CanopyShape } from './wing';
import presets from './wing-presets.json';

export interface WingChoice extends WingSetup {
  wing: WingId;
}

export const PRESETS = presets as (WingChoice & { name: string })[];
/** The reference EN-B: what the game flew before wings could be set up. */
export const DEFAULT_PRESET = 'Intermediate';

/** Slider ranges: [min, max, step]. */
export const RANGES = {
  areaM2: [14, 32, 0.5],
  aspectRatio: [4.2, 7.5, 0.1],
  allUpKg: [55, 140, 1],
} as const;

export function presetChoice(name: string): WingChoice | undefined {
  const p = PRESETS.find((q) => q.name === name);
  return p && { wing: p.wing, areaM2: p.areaM2, aspectRatio: p.aspectRatio, allUpKg: p.allUpKg };
}

export function polarFor(c: WingChoice): Polar {
  return new Polar(WINGS[c.wing], { areaM2: c.areaM2, aspectRatio: c.aspectRatio, allUpKg: c.allUpKg });
}

/** How to draw the wing: the flight model's proportions, and the class's cells for its aspect ratio. */
export function shapeFor(c: WingChoice, p: Polar): CanopyShape {
  return { ...canopyProportions(p), cells: Math.round(WINGS[c.wing].cells * p.aspect) };
}

/** What the wing loading means in the air, against the reference's 95 kg on 24 m². */
export function loadingNote(loading: number): string {
  if (loading < 0.88) return 'light: slow and soft, folds sooner, needs weight shift to spiral';
  if (loading <= 1.12) return 'mid-range';
  if (loading <= 1.3) return 'heavy: faster, more dynamic, spirals readily';
  return 'mini-wing loading: fast, short brake travel, quick to spiral';
}

const KMH = 3.6;
const W = 230, H = 104, PAD = 4;
const V_MIN = 15, V_MAX = 80, SINK_MAX = 4;
const x = (kmh: number) => PAD + ((kmh - V_MIN) / (V_MAX - V_MIN)) * (W - 2 * PAD);
const y = (sink: number) => PAD + (Math.min(sink, SINK_MAX) / SINK_MAX) * (H - 2 * PAD);

function curve(p: Polar): string {
  const pts: string[] = [];
  for (let v = p.stall; v <= p.top + 1e-6; v += 0.25) pts.push(`${x(v * KMH).toFixed(1)},${y(p.sink(v)).toFixed(1)}`);
  return `M${pts.join('L')}`;
}

/** The setup's numbers and its sink polar over the class reference's, for a lil-gui folder. */
export class WingCard {
  readonly element = document.createElement('div');

  constructor() {
    this.element.className = 'wing-card';
  }

  update(c: WingChoice, p: Polar): void {
    const ref = new Polar(WINGS[c.wing]);
    const best = p.bestGlide();
    let minSink = Infinity;
    for (let v = p.stall; v <= p.top; v += 0.05) minSink = Math.min(minSink, p.sink(v));
    const grid = [20, 40, 60].map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="${PAD}" y2="${H - PAD}"/><text x="${x(v) + 2}" y="${H - PAD - 2}">${v}</text>`).join('')
      + [1, 2, 3].map((s) => `<line x1="${PAD}" x2="${W - PAD}" y1="${y(s)}" y2="${y(s)}"/><text x="${W - PAD - 2}" y="${y(s) - 2}" text-anchor="end">${s}</text>`).join('');
    this.element.innerHTML = `
      <div class="wing-card-loading"><b>${(c.allUpKg / c.areaM2).toFixed(2)} kg/m²</b> ${loadingNote(p.loading)}</div>
      <dl>
        <dt>trim</dt><dd>${(p.trim * KMH).toFixed(0)}</dd>
        <dt>top</dt><dd>${(p.top * KMH).toFixed(0)}</dd>
        <dt>stall</dt><dd>${(p.stall * KMH).toFixed(0)} km/h</dd>
        <dt>min sink</dt><dd>${minSink.toFixed(2)} m/s</dd>
        <dt>best glide</dt><dd>${best.ratio.toFixed(1)} at ${(best.speed * KMH).toFixed(0)} km/h</dd>
      </dl>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sink rate against airspeed, this setup over the ${c.wing} reference">
        <g class="grid">${grid}</g>
        <path class="ref" d="${curve(ref)}"/>
        <path class="now" d="${curve(p)}"/>
        <circle cx="${x(best.speed * KMH)}" cy="${y(p.sink(best.speed))}" r="2.5"/>
      </svg>
      <div class="wing-card-legend">sink m/s against km/h · dashed: ${c.wing} at ${REFERENCE_AREA} m², ${REFERENCE_ALL_UP} kg</div>`;
  }
}
