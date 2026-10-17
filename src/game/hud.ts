// The DOM overlay: instrument panel, centre messages, help, credits.

import type { GliderState } from '../sim/glider';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e as T;
}

export class Hud {
  private readonly vario = el('vario');
  private readonly varioFill = el('vario-fill');
  private readonly alt = el('alt');
  private readonly agl = el('agl');
  private readonly airspeed = el('airspeed');
  private readonly groundspeed = el('groundspeed');
  private readonly glide = el('glide');
  private readonly time = el('flighttime');
  private readonly gload = el('gload');
  private readonly bank = el('bank');
  private readonly windArrow = el('wind-arrow');
  private readonly windSpeed = el('wind-speed');
  private readonly message = el('message');
  private readonly help = el('help');
  private messageTimer = 0;

  constructor(commitSha: string) {
    el('sha').textContent = commitSha ? `· ${commitSha}` : '';
  }

  ready(): void {
    el('loading').classList.add('done');
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  say(text: string, seconds = 4, warn = false): void {
    this.message.textContent = text;
    this.message.classList.add('show');
    this.message.classList.toggle('warn', warn);
    this.messageTimer = seconds;
  }

  update(dt: number, s: GliderState, climb: number, agl: number, glide: number | null, flightSeconds: number, windKmh: number, windToRad: number): void {
    const flying = s.phase === 'flying';
    this.vario.textContent = `${climb >= 0 ? '+' : '−'}${Math.abs(climb).toFixed(1)}`;
    this.vario.classList.toggle('up', climb >= 0.2);
    this.vario.classList.toggle('down', climb <= -2);
    const frac = Math.max(-1, Math.min(1, climb / 5));
    this.varioFill.style.left = frac >= 0 ? '50%' : `${50 + frac * 50}%`;
    this.varioFill.style.width = `${Math.abs(frac) * 50}%`;
    this.varioFill.style.background = frac >= 0 ? 'var(--lift)' : 'var(--sink)';

    this.alt.textContent = Math.round(s.z).toString();
    this.agl.textContent = Math.round(Math.max(agl, 0)).toString();
    this.airspeed.textContent = flying ? Math.round(s.airspeed * 3.6).toString() : '–';
    this.groundspeed.textContent = Math.round(s.groundSpeed * 3.6).toString();
    this.glide.textContent = glide === null ? '–' : !Number.isFinite(glide) || glide > 30 ? '∞' : glide.toFixed(1);
    this.gload.textContent = flying ? s.load.toFixed(1) : '–';
    this.gload.parentElement?.classList.toggle('alert', flying && (s.load > 2.5 || s.load < 0.4));
    this.bank.textContent = flying ? `${Math.round(Math.abs((s.bank * 180) / Math.PI))}°` : '–';
    const m = Math.floor(flightSeconds / 60), sec = Math.floor(flightSeconds % 60);
    this.time.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
    // Arrow shows where the wind blows relative to where you're facing (up = tailwind).
    this.windArrow.style.transform = `rotate(${((windToRad - s.heading) * 180) / Math.PI}deg)`;
    this.windSpeed.textContent = Math.round(windKmh).toString();

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.classList.remove('show');
    }
  }
}
