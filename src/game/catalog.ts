// Every flyable region (public/sites/index.json lists their ids) and the start the URL asks for:
//   ?region=lanzarote&launch=famara&wind=345/24&time=18:30   (wind = from degrees / km/h, time = solar)

import { siteBase, type SiteSpec } from './site';

export interface Region {
  id: string;
  spec: SiteSpec;
}

export interface Start {
  region: Region;
  launchId: string;
  wind?: { fromDeg: number; kmh: number };
  /** Solar time of day, hours. */
  hour?: number;
}

/**
 * Reads the manifest and every region's site.json (≈1 KB each; the terrain loads later).
 * Revalidated on every load: Pages caches for 10 min, and a stale manifest without a new
 * region sends its deep link to the first region instead.
 */
export async function loadCatalog(): Promise<Region[]> {
  const fresh: RequestInit = { cache: 'no-cache' };
  const index = (await (await fetch(`${siteBase('')}index.json`, fresh)).json()) as { regions: string[] };
  return Promise.all(index.regions.map(async (id): Promise<Region> => ({
    id,
    spec: (await (await fetch(`${siteBase(id)}site.json`, fresh)).json()) as SiteSpec,
  })));
}

/** Unknown region or launch ids fall back to the first one, so an old link still flies. */
export function parseStart(search: string, regions: Region[]): Start {
  const q = new URLSearchParams(search);
  const region = regions.find((r) => r.id === q.get('region')) ?? regions[0];
  const launch = region.spec.launches.find((l) => l.id === q.get('launch')) ?? region.spec.launches[0];
  const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(q.get('wind') ?? '');
  const wind = m ? { fromDeg: Number(m[1]) % 360, kmh: Number(m[2]) } : undefined;
  const t = /^(\d{1,2}):(\d{2})$/.exec(q.get('time') ?? '');
  const hour = t && Number(t[1]) < 24 && Number(t[2]) < 60 ? Number(t[1]) + Number(t[2]) / 60 : undefined;
  return { region, launchId: launch.id, wind, hour };
}

/** 18.5 → "18:30". */
export function clockTime(hour: number): string {
  const m = Math.round(hour * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Without a wind, the region's own default weather applies. */
export function startQuery(regionId: string, launchId: string, windFromDeg?: number, windKmh?: number, hour?: number): string {
  const wind = windFromDeg !== undefined && windKmh !== undefined ? `&wind=${Math.round(windFromDeg)}/${Math.round(windKmh)}` : '';
  const time = hour !== undefined ? `&time=${clockTime(hour)}` : '';
  return `?region=${encodeURIComponent(regionId)}&launch=${encodeURIComponent(launchId)}${wind}${time}`;
}

/** Regions grouped by country, both in alphabetical order, for the picker. */
export function byCountry(regions: Region[]): [string, Region[]][] {
  const groups = new Map<string, Region[]>();
  for (const r of [...regions].sort((a, b) => a.spec.name.localeCompare(b.spec.name))) {
    groups.set(r.spec.country, [...(groups.get(r.spec.country) ?? []), r]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
