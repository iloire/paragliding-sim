// Every flyable region (public/sites/index.json lists their ids) and the start the URL asks for:
//   ?region=lanzarote&launch=famara&wind=345/24   (wind = from degrees / km/h)

import { siteBase, type SiteSpec } from './site';

export interface Region {
  id: string;
  spec: SiteSpec;
}

export interface Start {
  region: Region;
  launchId: string;
  wind?: { fromDeg: number; kmh: number };
}

/** Reads the manifest and every region's site.json (≈1 KB each; the terrain loads later). */
export async function loadCatalog(): Promise<Region[]> {
  const index = (await (await fetch(`${siteBase('')}index.json`)).json()) as { regions: string[] };
  return Promise.all(index.regions.map(async (id): Promise<Region> => ({
    id,
    spec: (await (await fetch(`${siteBase(id)}site.json`)).json()) as SiteSpec,
  })));
}

/** Unknown region or launch ids fall back to the first one, so an old link still flies. */
export function parseStart(search: string, regions: Region[]): Start {
  const q = new URLSearchParams(search);
  const region = regions.find((r) => r.id === q.get('region')) ?? regions[0];
  const launch = region.spec.launches.find((l) => l.id === q.get('launch')) ?? region.spec.launches[0];
  const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(q.get('wind') ?? '');
  const wind = m ? { fromDeg: Number(m[1]) % 360, kmh: Number(m[2]) } : undefined;
  return { region, launchId: launch.id, wind };
}

/** Without a wind, the region's own default weather applies. */
export function startQuery(regionId: string, launchId: string, windFromDeg?: number, windKmh?: number): string {
  const wind = windFromDeg !== undefined && windKmh !== undefined ? `&wind=${Math.round(windFromDeg)}/${Math.round(windKmh)}` : '';
  return `?region=${encodeURIComponent(regionId)}&launch=${encodeURIComponent(launchId)}${wind}`;
}

/** Regions grouped by country, both in alphabetical order, for the picker. */
export function byCountry(regions: Region[]): [string, Region[]][] {
  const groups = new Map<string, Region[]>();
  for (const r of [...regions].sort((a, b) => a.spec.name.localeCompare(b.spec.name))) {
    groups.set(r.spec.country, [...(groups.get(r.spec.country) ?? []), r]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
