// The weather dialog (X): drag the compass to set where the wind comes from, against the
// launch's flyable sector; sliders for strength, inversion, thermals and turbulence, each saying
// what its value means in the air. Presets live in weather-presets.json and leave the direction
// alone, since what suits a launch is the speed and the sky, not a compass point.

import type { Weather } from '../sim/wind';
import presets from './weather-presets.json';

export const PRESETS = presets as (Omit<Weather, 'windFromDeg'> & { name: string; note: string })[];

/** Slider ranges: [min, max, step]. */
const RANGES = {
  windSpeedKmh: [0, 45, 1],
  inversionM: [300, 4000, 50],
  thermalStrength: [0, 4, 0.1],
  turbulence: [0, 1, 0.05],
} as const;
type Slider = keyof typeof RANGES;
const DECIMALS: Record<Slider, number> = { windSpeedKmh: 0, inversionM: 0, thermalStrength: 1, turbulence: 2 };

/** Direction steps the compass snaps to. */
const DIR_STEP = 5;
/** Off-wind angles the dial shades: straight in, and still soarable. */
const ON_WIND = 20, CROSS_WIND = 45;
/** Wind speeds (km/h) where a ridge starts to work, and where a wing stops penetrating. */
const SOARABLE = 12, STRONG = 30, BLOWN_OUT = 38;

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Wind direction relative to the way a launch faces, −180..180; positive = from the pilot's right. */
export function offWind(windFromDeg: number, launchHeadingDeg: number): number {
  return ((((windFromDeg - launchHeadingDeg) % 360) + 540) % 360) - 180;
}

/** One line on what this wind does at this launch. */
export function windVerdict(kmh: number, off: number): { text: string; tone: 'good' | 'warn' | 'bad' } {
  const a = Math.abs(off);
  const side = off > 0 ? 'right' : 'left';
  if (kmh < 3) return { text: 'Nil wind: forward launch, thermals only', tone: 'warn' };
  if (a > 90) return { text: 'Behind the hill: rotor and lee sink', tone: 'bad' };
  if (kmh > BLOWN_OUT) return { text: 'Blown out: faster than the wing flies', tone: 'bad' };
  if (a > CROSS_WIND) return { text: `Strong cross from the ${side}: weak, broken lift`, tone: 'warn' };
  if (kmh < SOARABLE) return { text: 'Too light to soar the ridge: find a thermal', tone: 'warn' };
  if (kmh > STRONG) return { text: 'Strong: speed bar to stay in front of the hill', tone: 'warn' };
  return { text: a <= ON_WIND ? 'Straight in: the ridge is working' : `Cross from the ${side}, still soarable`, tone: 'good' };
}

function describe(key: Exclude<Slider, 'windSpeedKmh'>, v: number, launchAltM: number): string {
  switch (key) {
    case 'inversionM': {
      const above = Math.round((v - launchAltM) / 10) * 10;
      return above > 0 ? `${above} m above launch` : 'below launch: no room to climb';
    }
    case 'thermalStrength':
      return v < 0.2 ? 'none' : v < 1 ? 'weak' : v < 2 ? 'moderate' : v < 3 ? 'strong' : 'booming';
    case 'turbulence':
      return v < 0.15 ? 'smooth' : v < 0.4 ? 'bumpy' : v < 0.7 ? 'rough' : 'very rough';
  }
}

export interface WeatherContext {
  launchName: string;
  /** Compass heading the launch faces. */
  launchHeadingDeg: number;
  launchAltM: number;
  /** The region's own weather, for "Site default". */
  siteWeather: Weather;
}

const R = 92;
const at = (deg: number, r: number): [string, string] => {
  const a = (deg * Math.PI) / 180;
  return [(Math.sin(a) * r).toFixed(2), (-Math.cos(a) * r).toFixed(2)];
};
const xy = (deg: number, r: number) => at(deg, r).join(' ');
/** An annular sector of the dial between two compass bearings. */
const sector = (a0: number, a1: number, r0: number, r1: number) =>
  `M${xy(a0, r1)} A${r1} ${r1} 0 0 1 ${xy(a1, r1)} L${xy(a1, r0)} A${r0} ${r0} 0 0 0 ${xy(a0, r0)}Z`;

function dialSvg(): string {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const d = i * 5, major = d % 45 === 0, mid = d % 15 === 0;
    return `<path class="${major ? 'major' : ''}" d="M${xy(d, R)} L${xy(d, R - (major ? 9 : mid ? 6 : 3))}"/>`;
  }).join('');
  const labels = ['N', 'E', 'S', 'W'].map((p, i) => {
    const [x, y] = at(i * 90, R - 19);
    return `<text x="${x}" y="${y}">${p}</text>`;
  }).join('');
  return `
    <svg class="wx-dial" viewBox="-104 -104 208 208" role="slider" tabindex="0" aria-label="Wind from"
      aria-valuemin="0" aria-valuemax="359">
      <circle class="face" r="${R}"/>
      <g class="sectors"></g>
      <g class="ticks">${ticks}</g>
      <g class="labels">${labels}</g>
      <g class="launch"><path d="M0 -52 L5 -40 L-5 -40Z"/><line x1="0" y1="-40" x2="0" y2="0"/></g>
      <g class="wind">
        <line class="shaft" x1="0" y1="-${R + 6}" x2="0" y2="-30"/>
        <line class="flow" x1="0" y1="-${R + 6}" x2="0" y2="-30"/>
        <path class="head" d="M0 -20 L9 -36 L0 -31 L-9 -36Z"/>
        <circle class="grip" cy="-${R}" r="7"/>
      </g>
      <text class="speed" y="8">0</text>
      <text class="unit" y="24">km/h</text>
    </svg>`;
}

function sliderRow(key: Slider, label: string, unit: string): string {
  const [min, max, step] = RANGES[key];
  return `
    <label class="wx-row" data-key="${key}">
      <span class="wx-name">${label}</span>
      <output></output><span class="wx-unit">${unit}</span>
      <input type="range" min="${min}" max="${max}" step="${step}">
      <span class="wx-note"></span>
    </label>`;
}

export class WeatherPanel {
  private readonly panel = document.createElement('aside');
  private ctx: WeatherContext | null = null;
  /** Direction under the finger while dragging: shown at once, applied on release. */
  private dragDeg: number | null = null;

  /** `onChange` runs after each change to `weather`, which the panel edits in place. */
  constructor(
    private readonly weather: Weather,
    private readonly onChange: () => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.panel.id = 'weather';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Weather');
    const closeLabel = matchMedia('(pointer: coarse)').matches ? 'Close' : 'Esc'; // no Esc key on a phone
    this.panel.innerHTML = `
      <header><h2>Weather</h2><span class="wx-where"></span>
        <button type="button" class="wx-close" aria-label="Close">${closeLabel}</button></header>
      <div class="wx-presets">${PRESETS.map((p, i) => `
        <button type="button" data-preset="${i}"><b>${p.name}</b><span>${p.note}</span></button>`).join('')}
      </div>
      <div class="wx-body">
        <div class="wx-wind">
          ${dialSvg()}
          <div class="wx-from"></div>
          <div class="wx-verdict"></div>
          <div class="wx-actions">
            <button type="button" data-act="into">Into launch</button>
            <button type="button" data-act="site">Site default</button>
          </div>
        </div>
        <div class="wx-sliders">
          ${sliderRow('windSpeedKmh', 'Wind', 'km/h')}
          ${sliderRow('inversionM', 'Inversion', 'm')}
          ${sliderRow('thermalStrength', 'Thermals', 'm/s')}
          ${sliderRow('turbulence', 'Turbulence', '')}
        </div>
      </div>`;
    document.body.append(this.panel);

    this.panel.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyX') { e.preventDefault(); this.close(); }
    });
    this.panel.addEventListener('click', (e) => {
      const t = e.target as Element;
      const preset = t.closest<HTMLButtonElement>('[data-preset]');
      if (preset) {
        const p = PRESETS[Number(preset.dataset.preset)];
        this.apply({ windSpeedKmh: p.windSpeedKmh, inversionM: p.inversionM, thermalStrength: p.thermalStrength, turbulence: p.turbulence });
      } else if (t.closest('[data-act="into"]')) {
        if (this.ctx) this.apply({ windFromDeg: this.snap(this.ctx.launchHeadingDeg) });
      } else if (t.closest('[data-act="site"]')) {
        if (this.ctx) this.apply({ ...this.ctx.siteWeather });
      } else if (t.closest('.wx-close')) this.close();
    });
    for (const row of this.panel.querySelectorAll<HTMLElement>('.wx-row')) {
      const key = row.dataset.key as Slider;
      const input = row.querySelector('input')!;
      // The inversion re-lays the lift band, so it waits for the release; the rest are cheap.
      input.addEventListener(key === 'inversionM' ? 'change' : 'input', () => this.apply({ [key]: Number(input.value) }));
      if (key === 'inversionM') input.addEventListener('input', () => this.render(Number(input.value)));
    }
    this.wireDial();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(ctx: WeatherContext): void {
    this.ctx = ctx;
    this.render();
    this.panel.hidden = false;
    this.onToggle(true);
    this.panel.querySelector<SVGElement>('.wx-dial')?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.onToggle(false);
  }

  private snap(deg: number): number {
    return ((Math.round(deg / DIR_STEP) * DIR_STEP) % 360 + 360) % 360;
  }

  private apply(change: Partial<Weather>): void {
    Object.assign(this.weather, change);
    this.render();
    this.onChange();
  }

  private wireDial(): void {
    const dial = this.panel.querySelector<SVGSVGElement>('.wx-dial')!;
    const at = (e: PointerEvent) => {
      const r = dial.getBoundingClientRect();
      const deg = (Math.atan2(e.clientX - r.left - r.width / 2, r.top + r.height / 2 - e.clientY) * 180) / Math.PI;
      return this.snap(deg);
    };
    dial.addEventListener('pointerdown', (e) => {
      dial.setPointerCapture(e.pointerId);
      this.dragDeg = at(e);
      this.render();
    });
    dial.addEventListener('pointermove', (e) => {
      if (this.dragDeg === null) return;
      this.dragDeg = at(e);
      this.render();
    });
    const release = () => {
      if (this.dragDeg === null) return;
      const deg = this.dragDeg;
      this.dragDeg = null;
      // Re-laying the ridge lift for a new direction is the costly part: once, on release.
      if (deg !== this.weather.windFromDeg) this.apply({ windFromDeg: deg });
      else this.render();
    };
    dial.addEventListener('pointerup', release);
    dial.addEventListener('pointercancel', release);
    dial.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.code];
      if (!d) return;
      e.preventDefault();
      this.apply({ windFromDeg: this.snap(this.weather.windFromDeg + d * DIR_STEP * (e.shiftKey ? 3 : 1)) });
    });
  }

  /** `inversion`: the slider's value mid-drag, before it is applied. */
  private render(inversion = this.weather.inversionM): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.weather;
    const from = this.dragDeg ?? w.windFromDeg;
    const q = <T extends Element>(s: string) => this.panel.querySelector<T>(s)!;

    q('.wx-where').textContent = `${ctx.launchName} · faces ${compassPoint(ctx.launchHeadingDeg)}`;
    const h = ctx.launchHeadingDeg;
    q('.sectors').innerHTML = `
      <path class="cross" d="${sector(h - CROSS_WIND, h + CROSS_WIND, 56, R)}"/>
      <path class="on" d="${sector(h - ON_WIND, h + ON_WIND, 56, R)}"/>`;
    q('.launch').setAttribute('transform', `rotate(${h})`);
    q('.wind').setAttribute('transform', `rotate(${from})`);
    // The streaks run faster in a stronger wind, and stop in a calm.
    const flow = q<SVGLineElement>('.flow');
    flow.style.animationDuration = `${(60 / Math.max(w.windSpeedKmh, 1)).toFixed(2)}s`;
    flow.style.opacity = w.windSpeedKmh < 1 ? '0' : '';
    q('.speed').textContent = String(Math.round(w.windSpeedKmh));
    const dial = q('.wx-dial');
    dial.setAttribute('aria-valuenow', String(from));
    dial.setAttribute('aria-valuetext', `${compassPoint(from)} ${from}°`);
    q('.wx-from').innerHTML = `from <b>${compassPoint(from)}</b> ${from}°`;

    const verdict = windVerdict(w.windSpeedKmh, offWind(from, h));
    const v = q<HTMLElement>('.wx-verdict');
    v.textContent = verdict.text;
    v.dataset.tone = verdict.tone;

    for (const row of this.panel.querySelectorAll<HTMLElement>('.wx-row')) {
      const key = row.dataset.key as Slider;
      const value = key === 'inversionM' ? inversion : w[key];
      const input = row.querySelector('input')!;
      input.value = String(value);
      const [min, max] = RANGES[key];
      input.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
      row.querySelector('output')!.textContent = value.toFixed(DECIMALS[key]);
      row.querySelector('.wx-note')!.textContent = key === 'windSpeedKmh' ? speedNote(value) : describe(key, value, ctx.launchAltM);
    }

    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
      const p = PRESETS[Number(b.dataset.preset)];
      const on = p.windSpeedKmh === w.windSpeedKmh && p.inversionM === w.inversionM
        && p.thermalStrength === w.thermalStrength && p.turbulence === w.turbulence;
      b.setAttribute('aria-pressed', String(on));
    }
  }
}

function speedNote(kmh: number): string {
  return kmh < 3 ? 'calm' : kmh < SOARABLE ? 'light' : kmh <= STRONG ? 'soarable' : kmh <= BLOWN_OUT ? 'strong' : 'too strong';
}
