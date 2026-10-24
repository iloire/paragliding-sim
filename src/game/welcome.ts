// The welcome screen: laid over the live scene, where the pilot picks a launch, the time of day,
// the wing and the crew, then flies. Esc or M in flight brings it back. ← → change launch, Enter flies.

import { compass } from '../sim/instruments';
import type { Weather } from '../sim/wind';
import { byCountry, type Region } from './catalog';
import type { Crew } from './wing';

export type StartMode = 'air' | 'ground';

/** What the menu shows; main.ts owns it and hands a fresh copy to `render`. */
export interface WelcomeView {
  region: Region;
  launchId: string;
  weather: Weather;
  /** Named times of day, and which one (if any) the sun is at. */
  times: string[];
  time: string;
  wings: string[];
  wing: string;
  /** One-line summary of the wing, e.g. "EN-B · 24 m² · trim 37 km/h · glide 8.9". */
  wingLine: string;
  crew: Crew;
  /** A flight is paused under the menu and can carry on. */
  canResume: boolean;
}

export interface WelcomeHandlers {
  launch(id: string): void;
  site(regionId: string, launchId: string): void;
  time(name: string): void;
  wing(name: string): void;
  crew(c: Crew): void;
  fly(mode: StartMode): void;
  resume(): void;
  weather(key: WeatherKey, value: number): void;
}

type Tab = 'help' | 'sites' | 'weather';
type WeatherKey = 'windSpeedKmh' | 'windFromDeg' | 'inversionM' | 'thermalStrength' | 'turbulence';

/**
 * The weather sliders, shared with lil-gui. `live` ones apply while dragging; the others rebuild
 * the wind over the terrain, so they wait for the release.
 */
export const WEATHER_SLIDERS: { key: WeatherKey; label: string; min: number; max: number; step: number; live: boolean; show: (v: number) => string }[] = [
  { key: 'windSpeedKmh', label: 'Wind', min: 0, max: 45, step: 1, live: true, show: (v) => `${v} km/h` },
  { key: 'windFromDeg', label: 'From', min: 0, max: 359, step: 5, live: false, show: (v) => `${compass((v * Math.PI) / 180)} ${v}°` },
  { key: 'thermalStrength', label: 'Thermals', min: 0, max: 4, step: 0.1, live: true, show: (v) => `${v.toFixed(1)} m/s` },
  { key: 'inversionM', label: 'Inversion', min: 300, max: 4000, step: 50, live: false, show: (v) => `${v} m` },
  { key: 'turbulence', label: 'Turbulence', min: 0, max: 1, step: 0.05, live: true, show: (v) => `${Math.round(v * 100)} %` },
];

/** The conditions as a pilot reads them before launch. */
export function briefing(w: Weather): string[] {
  return [
    `Wind ${compass((w.windFromDeg * Math.PI) / 180)} ${Math.round(w.windSpeedKmh)} km/h`,
    `Thermals ${w.thermalStrength.toFixed(1)} m/s`,
    `Inversion ${Math.round(w.inversionM)} m`,
  ];
}

/** The neighbour of `current` in `list`, wrapping round. */
export function step<T>(list: T[], current: T, by: number): T {
  return list[(list.indexOf(current) + by + list.length) % list.length];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class Welcome {
  private readonly root = document.createElement('div');
  private view: WelcomeView | null = null;
  private tab: Tab = 'help';

  constructor(
    private readonly regions: Region[],
    private readonly on: WelcomeHandlers,
    /** The flight controls table, shared with the in-flight help card. */
    private readonly helpHtml: string,
  ) {
    this.root.id = 'welcome';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onSlide(e, true));
    this.root.addEventListener('change', (e) => this.onSlide(e, false));
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(tab?: Tab): void {
    if (tab) this.tab = tab;
    this.root.hidden = false;
    document.body.classList.add('in-menu');
    this.paint();
    this.root.querySelector<HTMLButtonElement>(this.view?.canResume ? '[data-resume]' : '[data-fly="air"]')?.focus();
  }

  close(): void {
    this.root.hidden = true;
    document.body.classList.remove('in-menu');
  }

  render(view: WelcomeView): void {
    this.view = view;
    if (!this.isOpen) return;
    // Mid-drag a repaint would pull the slider out from under the pointer: patch the text instead.
    if (document.activeElement instanceof HTMLInputElement && this.root.contains(document.activeElement)) {
      const brief = this.root.querySelector('.wl-brief');
      if (brief) brief.innerHTML = this.brief(view);
    } else this.paint();
  }

  private onSlide(e: Event, live: boolean): void {
    const input = e.target as HTMLInputElement;
    const def = WEATHER_SLIDERS.find((d) => d.key === input.dataset.weather);
    if (!def) return;
    const value = Number(input.value);
    const out = input.parentElement?.querySelector('output');
    if (out) out.textContent = def.show(value);
    if (def.live === live) this.on.weather(def.key, value);
  }

  private onClick(e: Event): void {
    const t = (e.target as Element).closest<HTMLButtonElement>('button');
    const v = this.view;
    if (!t || !v) return;
    const d = t.dataset;
    if (d.launchStep) this.on.launch(step(v.region.spec.launches.map((l) => l.id), v.launchId, Number(d.launchStep)));
    else if (d.wingStep) this.on.wing(step(v.wings, v.wing, Number(d.wingStep)));
    else if (d.time) this.on.time(d.time);
    else if (d.crew) this.on.crew(d.crew as Crew);
    else if (d.fly) this.on.fly(d.fly as StartMode);
    else if (d.resume !== undefined) this.on.resume();
    else if (d.tab) {
      this.tab = d.tab as Tab;
      this.paint();
      this.root.querySelector<HTMLElement>(`[data-tab="${this.tab}"]`)?.focus();
    }
    else if (d.launch) this.on.site(d.region ?? '', d.launch);
  }

  private onKey(e: KeyboardEvent): void {
    const v = this.view;
    if (!this.isOpen || !v || e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if (e.target instanceof HTMLInputElement || (e.target as Element).closest?.('.wl-sites')) return; // sliders and the list keep their arrows
      e.preventDefault();
      this.on.launch(step(v.region.spec.launches.map((l) => l.id), v.launchId, e.code === 'ArrowLeft' ? -1 : 1));
    } else if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (v.canResume) this.on.resume();
      else this.on.fly('air');
    }
  }

  private paint(): void {
    const v = this.view;
    if (!v) return;
    // Repainting replaces the buttons, so put focus back on the one that was pressed.
    const focused = document.activeElement instanceof HTMLButtonElement && this.root.contains(document.activeElement)
      ? keyOf(document.activeElement) : null;
    const spec = v.region.spec;
    const launches = spec.launches;
    const at = launches.findIndex((l) => l.id === v.launchId);
    const chip = (attr: string, value: string, label: string, on: boolean) =>
      `<button type="button" class="wl-chip" ${attr}="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
    this.root.innerHTML = `
      <div class="wl-main">
        <p class="wl-place">${esc(spec.name)} · ${esc(spec.country)}</p>
        <h1 class="wl-title">Famara <span>Glide</span></h1>
        <div class="wl-launch">
          <button type="button" class="wl-arrow" data-launch-step="-1" aria-label="Previous launch">‹</button>
          <h2>${esc(launches[at]?.name ?? '')}</h2>
          <button type="button" class="wl-arrow" data-launch-step="1" aria-label="Next launch">›</button>
          <span class="wl-count">${at + 1} / ${launches.length}</span>
          <button type="button" class="wl-wx" data-tab="sites">All sites ›</button>
        </div>
        <ul class="wl-brief" aria-label="Conditions">${this.brief(v)}</ul>
        <div class="wl-row" role="group" aria-label="Time of day">
          ${v.times.map((t) => chip('data-time', t, t, t === v.time)).join('')}
        </div>
        <div class="wl-row wl-wing">
          <span class="wl-label">Wing</span>
          <button type="button" class="wl-arrow small" data-wing-step="-1" aria-label="Previous wing">‹</button>
          <b>${esc(v.wing)}</b>
          <button type="button" class="wl-arrow small" data-wing-step="1" aria-label="Next wing">›</button>
          <span class="wl-wing-line">${esc(v.wingLine)}</span>
        </div>
        <div class="wl-row" role="group" aria-label="Pilot">
          <span class="wl-label">Pilot</span>
          ${chip('data-crew', 'solo', 'Solo', v.crew === 'solo')}${chip('data-crew', 'tandem', 'Tandem', v.crew === 'tandem')}
        </div>
        <div class="wl-go">
          ${v.canResume ? '<button type="button" class="wl-btn primary" data-resume>Resume<small>carry on flying</small></button>' : ''}
          <button type="button" class="wl-btn ${v.canResume ? '' : 'primary'}" data-fly="air">Fly →<small>start in the air over launch</small></button>
          <button type="button" class="wl-btn" data-fly="ground">Take off<small>on the hill, run to launch</small></button>
        </div>
      </div>
      <aside class="wl-side">
        <nav role="tablist">
          <button type="button" role="tab" data-tab="help" aria-selected="${this.tab === 'help'}">How to fly</button>
          <button type="button" role="tab" data-tab="weather" aria-selected="${this.tab === 'weather'}">Weather</button>
          <button type="button" role="tab" data-tab="sites" aria-selected="${this.tab === 'sites'}">Sites</button>
        </nav>
        <div class="wl-tab">${this.tab === 'help' ? `<div class="wl-help">${this.helpHtml}</div>` : this.tab === 'weather' ? this.weather(v) : this.sites(v)}</div>
      </aside>`;
    if (focused) this.root.querySelector<HTMLButtonElement>(focused)?.focus();
  }

  private brief(v: WelcomeView): string {
    return briefing(v.weather).map((b) => `<li>${esc(b)}</li>`).join('')
      + `<li><button type="button" class="wl-wx" data-tab="weather" aria-label="Change the weather">Change weather ›</button></li>`;
  }

  private weather(v: WelcomeView): string {
    return `<div class="wl-weather">${WEATHER_SLIDERS.map((d) => `
      <label><span>${d.label}</span>
        <input type="range" data-weather="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v.weather[d.key]}">
        <output>${esc(d.show(v.weather[d.key]))}</output></label>`).join('')}
      <p>Each site starts with its own typical day. Changes apply at once, and the link in the address bar keeps the wind.</p></div>`;
  }

  /** Country › Region › Launch. Another region is a new terrain download, so it reloads. */
  private sites(v: WelcomeView): string {
    return `<div class="wl-sites">${byCountry(this.regions).map(([country, regions]) => `
      <section>
        <h3>${esc(country)}</h3>
        ${regions.map((r) => `
          <div class="wl-region">
            <h4>${esc(r.spec.name)}<span>${r.spec.launches.length} launches${r.id === v.region.id ? ' · loaded' : ''}</span></h4>
            <ul>${r.spec.launches.map((l) => `
              <li><button type="button" data-region="${esc(r.id)}" data-launch="${esc(l.id)}"
                aria-current="${r.id === v.region.id && l.id === v.launchId}">${esc(l.name)}</button></li>`).join('')}
            </ul>
          </div>`).join('')}
      </section>`).join('')}</div>`;
  }
}

/** A selector that finds the same button again after a repaint. */
function keyOf(b: HTMLButtonElement): string | null {
  for (const [k, val] of Object.entries(b.dataset)) {
    const attr = `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (k === 'region') continue;
    return val ? `[${attr}="${CSS.escape(val)}"]${b.dataset.region ? `[data-region="${CSS.escape(b.dataset.region)}"]` : ''}` : `[${attr}]`;
  }
  return null;
}
