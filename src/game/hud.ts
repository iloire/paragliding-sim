// The DOM overlay: instrument panel, centre messages, help, credits.

import type { GliderState } from '../sim/glider';
import { compass, type GlideTo, type TurnTrack } from '../sim/instruments';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e as T;
}

export type Layout = 'full' | 'minimal' | 'phone' | 'hidden';
const LAYOUTS: Layout[] = ['full', 'minimal', 'hidden'];
/** A phone gets only what a glance can take in: climb, height above ground, ground speed. */
const PHONE_LAYOUTS: Layout[] = ['phone', 'hidden'];

/** Climb that flashes the vario when first crossed; re-arms below the lower value. */
const FLASH_CLIMB = 2;
const FLASH_REARM = 1;
const AGL_LOW = 50;
const AGL_DANGER = 20;
/** Thermal assistant: metres from the centre to the edge of the plot. */
const TRACK_RADIUS_M = 80;
const HELP_KEY = 'famara-glide.help-collapsed';

export interface HudFrame {
  climb: number;
  agl: number;
  glide: number | null;
  flightSeconds: number;
  windKmh: number;
  /** Compass direction the wind blows towards (rad). */
  windToRad: number;
  landing: { name: string; glide: GlideTo } | null;
  track: TurnTrack;
}

export class Hud {
  private readonly panel = el('instrument');
  private readonly vario = el('vario');
  private readonly varioFill = el('vario-fill');
  private readonly alt = el('alt');
  private readonly agl = el('agl');
  private readonly aglBox = el('agl-box');
  private readonly airspeed = el('airspeed');
  private readonly groundspeed = el('groundspeed');
  private readonly glide = el('glide');
  private readonly time = el('flighttime');
  private readonly gload = el('gload');
  private readonly bank = el('bank');
  private readonly thermal = el<HTMLCanvasElement>('thermal').getContext('2d')!;
  private readonly windArrow = el('wind-arrow');
  private readonly windFrom = el('wind-from');
  private readonly windSpeed = el('wind-speed');
  private readonly landing = el('landing');
  private readonly landingArrow = el('landing-arrow');
  private readonly landingName = el('landing-name');
  private readonly landingDist = el('landing-dist');
  private readonly landingNeed = el('landing-need');
  private readonly warp = el('warp');
  private readonly message = el('message');
  private readonly help = el('help');
  private readonly helpToggle = el('help-toggle');
  private messageTimer = 0;
  private readonly layouts: Layout[];
  private layout: Layout;
  private flashArmed = true;

  constructor(commitSha: string, touch: boolean) {
    this.layouts = touch ? PHONE_LAYOUTS : LAYOUTS;
    this.layout = this.layouts[0];
    this.applyLayout();
    el('sha').textContent = commitSha ? `· ${commitSha}` : '';
    let collapsed = false; // open on a first visit, so a new pilot sees the keys
    try { collapsed = localStorage.getItem(HELP_KEY) === '1'; } catch { /* storage blocked */ }
    this.setHelp(collapsed);
    this.helpToggle.addEventListener('click', () => {
      this.toggleHelp();
      this.helpToggle.blur(); // or Space (full brakes) would click it again
    });
  }

  ready(): void {
    el('loading').classList.add('done');
  }

  /** The controls card collapses to its heading; H or a click on the heading flips it, and the choice is remembered. */
  toggleHelp(): void {
    this.setHelp(!this.help.classList.contains('collapsed'));
  }

  private setHelp(collapsed: boolean): void {
    this.help.classList.toggle('collapsed', collapsed);
    this.helpToggle.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(HELP_KEY, collapsed ? '1' : '0'); } catch { /* private mode: just not remembered */ }
  }

  /** Cycles full → minimal → hidden (phone → hidden on touch) and returns the new layout. */
  cycleLayout(): Layout {
    this.layout = this.layouts[(this.layouts.indexOf(this.layout) + 1) % this.layouts.length];
    this.applyLayout();
    return this.layout;
  }

  private applyLayout(): void {
    for (const l of ['minimal', 'phone', 'hidden'] as const) this.panel.classList.toggle(l, this.layout === l);
  }

  /** The corner tag reads 2× or 4×, and is empty at real time. */
  setWarp(warp: number): void {
    this.warp.textContent = warp > 1 ? `${warp}×` : '';
  }

  say(text: string, seconds = 4, warn = false): void {
    this.message.textContent = text;
    this.message.classList.add('show');
    this.message.classList.toggle('warn', warn);
    this.messageTimer = seconds;
  }

  update(dt: number, s: GliderState, f: HudFrame): void {
    const flying = s.phase === 'flying';
    const { climb } = f;
    this.vario.textContent = signed(climb);
    this.vario.classList.toggle('up', climb >= 0.2);
    this.vario.classList.toggle('down', climb <= -2);
    if (flying && this.flashArmed && climb >= FLASH_CLIMB) {
      this.flashArmed = false;
      this.vario.classList.remove('flash');
      void this.vario.offsetWidth; // restart the animation
      this.vario.classList.add('flash');
    } else if (climb < FLASH_REARM) {
      this.flashArmed = true;
    }
    const frac = Math.max(-1, Math.min(1, climb / 5));
    this.varioFill.style.top = frac >= 0 ? `${50 - frac * 50}%` : '50%';
    this.varioFill.style.height = `${Math.abs(frac) * 50}%`;
    this.varioFill.style.background = frac >= 0 ? 'var(--lift)' : 'var(--sink)';

    const agl = Math.max(f.agl, 0);
    this.agl.textContent = Math.round(agl).toString();
    this.aglBox.classList.toggle('danger', flying && agl < AGL_DANGER);
    this.aglBox.classList.toggle('low', flying && agl >= AGL_DANGER && agl < AGL_LOW);

    this.alt.textContent = Math.round(s.z).toString();
    this.airspeed.textContent = flying ? Math.round(s.airspeed * 3.6).toString() : '–';
    this.groundspeed.textContent = Math.round(s.groundSpeed * 3.6).toString();
    this.glide.textContent = f.glide === null ? '–' : !Number.isFinite(f.glide) || f.glide > 30 ? '∞' : f.glide.toFixed(1);
    const bankDeg = Math.abs((s.bank * 180) / Math.PI);
    this.gload.textContent = flying ? s.load.toFixed(1) : '–';
    this.bank.textContent = flying ? `${Math.round(bankDeg)}°` : '–';
    // G and bank only matter in a manoeuvre: dimmed in straight flight, red when extreme.
    const loadAlert = flying && (s.load > 2.5 || s.load < 0.4);
    this.gload.parentElement?.classList.toggle('alert', loadAlert);
    this.gload.parentElement?.classList.toggle('quiet', !flying || (s.load >= 0.6 && s.load <= 1.8));
    this.bank.parentElement?.classList.toggle('alert', flying && bankDeg > 60);
    this.bank.parentElement?.classList.toggle('quiet', !flying || bankDeg < 25);
    const m = Math.floor(f.flightSeconds / 60), sec = Math.floor(f.flightSeconds % 60);
    this.time.textContent = `${m}:${sec.toString().padStart(2, '0')}`;

    // Glider fixed pointing up; the arrow turns with the wind relative to it (pointing up = tailwind).
    this.windArrow.style.transform = `rotate(${deg(f.windToRad - s.heading)}deg)`;
    this.windFrom.textContent = compass(f.windToRad + Math.PI);
    this.windSpeed.textContent = Math.round(f.windKmh).toString();

    this.landing.classList.toggle('none', f.landing === null);
    if (f.landing) {
      const g = f.landing.glide;
      this.landing.classList.remove('ok', 'marginal', 'out');
      if (g.status !== 'none') this.landing.classList.add(g.status);
      this.landingArrow.style.transform = `rotate(${deg(g.bearing - s.heading)}deg)`;
      this.landingName.textContent = f.landing.name;
      this.landingDist.textContent = `${(g.distance / 1000).toFixed(1)} km`;
      this.landingNeed.textContent = Number.isFinite(g.required) ? `L/D ${g.required.toFixed(1)}` : 'below';
    }

    if (this.layout === 'full') this.drawTrack(s, f.track, flying);

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.classList.remove('show');
    }
  }

  /** Thermal assistant: the last half-minute of track, heading up, dots coloured by climb. */
  private drawTrack(s: GliderState, track: TurnTrack, flying: boolean): void {
    const ctx = this.thermal;
    const size = ctx.canvas.width, c = size / 2, k = (c - 4) / TRACK_RADIUS_M;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(244, 239, 228, 0.14)';
    ctx.lineWidth = 2;
    for (const r of [c - 4, (c - 4) / 2]) {
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!flying) return;

    const sin = Math.sin(s.heading), cos = Math.cos(s.heading);
    const toScreen = (x: number, y: number): [number, number] => {
      const dx = x - s.x, dy = y - s.y;
      return [c + (dx * cos - dy * sin) * k, c - (dx * sin + dy * cos) * k];
    };
    for (const p of track.points) {
      const [px, py] = toScreen(p.x, p.y);
      const strength = Math.min(Math.abs(p.vz) / 3, 1);
      ctx.fillStyle = p.vz >= 0 ? `rgba(127, 224, 138, ${0.25 + strength * 0.75})` : `rgba(255, 122, 89, ${0.15 + strength * 0.5})`;
      ctx.beginPath();
      ctx.arc(px, py, 2 + strength * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const best = track.best();
    if (best) {
      const [bx, by] = toScreen(best.x, best.y);
      ctx.strokeStyle = '#7fe08a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx, by, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#f4efe4';
    ctx.beginPath();
    ctx.moveTo(c, c - 9);
    ctx.lineTo(c + 7, c + 6);
    ctx.lineTo(c - 7, c + 6);
    ctx.closePath();
    ctx.fill();
  }
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}
