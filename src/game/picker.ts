// The site picker (M): Country › Region › Launch. Arrows move, Enter flies, Esc or M closes.

import { byCountry, type Region } from './catalog';

export class SitePicker {
  private readonly panel = document.createElement('aside');
  private current = { regionId: '', launchId: '' };

  constructor(
    private readonly regions: Region[],
    private readonly onPick: (regionId: string, launchId: string) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.panel.id = 'picker';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Flying sites');
    this.panel.addEventListener('keydown', (e) => this.onKey(e));
    this.panel.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-launch]');
      if (b) this.pick(b.dataset.region ?? '', b.dataset.launch ?? '');
      else if ((e.target as Element).closest('.picker-close')) this.close();
    });
    document.body.append(this.panel);
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(regionId: string, launchId: string): void {
    this.current = { regionId, launchId };
    this.render();
    this.panel.hidden = false;
    this.onToggle(true);
    (this.panel.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? this.buttons()[0])?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.onToggle(false);
  }

  private pick(regionId: string, launchId: string): void {
    this.close();
    this.onPick(regionId, launchId);
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.panel.querySelectorAll<HTMLButtonElement>('button[data-launch]')];
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); this.close(); return; }
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
    e.preventDefault();
    const list = this.buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.code === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  }

  private render(): void {
    const { regionId, launchId } = this.current;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const groups = byCountry(this.regions).map(([country, regions]) => `
      <section>
        <h3>${esc(country)}</h3>
        ${regions.map((r) => `
          <div class="picker-region">
            <h4>${esc(r.spec.name)}<span>${r.spec.launches.length} launches${r.id === regionId ? ' · loaded' : ''}</span></h4>
            <ul>${r.spec.launches.map((l) => `
              <li><button type="button" data-region="${esc(r.id)}" data-launch="${esc(l.id)}"
                aria-current="${r.id === regionId && l.id === launchId}">${esc(l.name)}</button></li>`).join('')}
            </ul>
          </div>`).join('')}
      </section>`).join('');
    this.panel.innerHTML = `
      <header><h2>Sites</h2><button type="button" class="picker-close" aria-label="Close">Esc</button></header>
      ${groups}`;
  }
}
