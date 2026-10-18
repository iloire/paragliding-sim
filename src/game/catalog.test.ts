import { describe, expect, it } from 'vitest';
import { byCountry, clockTime, parseStart, startQuery, type Region } from './catalog';
import type { SiteSpec } from './site';

function region(id: string, name: string, country: string, launches: string[]): Region {
  const spec = { name, country, launches: launches.map((l) => ({ id: l, name: l, lat: 0, lon: 0 })) } as SiteSpec;
  return { id, spec };
}

const REGIONS = [
  region('lanzarote', 'Lanzarote', 'Spain', ['famara', 'mala']),
  region('annecy', 'Annecy', 'France', ['forclaz']),
  region('tenerife', 'Tenerife', 'Spain', ['taucho']),
];

describe('parseStart', () => {
  it('reads region, launch and wind', () => {
    const s = parseStart('?region=lanzarote&launch=mala&wind=345/24', REGIONS);
    expect([s.region.id, s.launchId, s.wind]).toEqual(['lanzarote', 'mala', { fromDeg: 345, kmh: 24 }]);
  });

  it('falls back to the first region and launch for unknown or missing ids', () => {
    expect(parseStart('', REGIONS)).toMatchObject({ region: { id: 'lanzarote' }, launchId: 'famara', wind: undefined });
    expect(parseStart('?region=nowhere&launch=mala', REGIONS).launchId).toBe('mala');
    expect(parseStart('?region=annecy&launch=famara', REGIONS).launchId).toBe('forclaz');
  });

  it('ignores a malformed wind and wraps the direction', () => {
    expect(parseStart('?wind=345', REGIONS).wind).toBeUndefined();
    expect(parseStart('?wind=abc/12', REGIONS).wind).toBeUndefined();
    expect(parseStart('?wind=-10/12', REGIONS).wind).toBeUndefined();
    expect(parseStart('?wind=360/12', REGIONS).wind).toEqual({ fromDeg: 0, kmh: 12 });
  });

  it('reads a solar time of day and ignores a malformed one', () => {
    expect(parseStart('?time=18:45', REGIONS).hour).toBe(18.75);
    expect(parseStart('?time=7:05', REGIONS).hour).toBeCloseTo(7 + 5 / 60);
    expect(parseStart('?time=25:00', REGIONS).hour).toBeUndefined();
    expect(parseStart('?time=18', REGIONS).hour).toBeUndefined();
    expect(parseStart('', REGIONS).hour).toBeUndefined();
  });

  it('round-trips what startQuery writes', () => {
    const s = parseStart(startQuery('tenerife', 'taucho', 271.6, 18.2), REGIONS);
    expect([s.region.id, s.launchId, s.wind]).toEqual(['tenerife', 'taucho', { fromDeg: 272, kmh: 18 }]);
    expect(parseStart(startQuery('tenerife', 'taucho', 0, 10, 17.9), REGIONS).hour).toBeCloseTo(17.9, 1);
    expect(clockTime(9.999)).toBe('10:00');
  });
});

describe('startQuery', () => {
  it('leaves the wind out when none is given, so the region uses its own weather', () => {
    expect(startQuery('loarre', 'tiacuto')).toBe('?region=loarre&launch=tiacuto');
    expect(parseStart(startQuery('tenerife', 'taucho'), REGIONS).wind).toBeUndefined();
  });
});

describe('byCountry', () => {
  it('groups regions by country, both alphabetical', () => {
    expect(byCountry(REGIONS).map(([c, rs]) => [c, rs.map((r) => r.id)])).toEqual([
      ['France', ['annecy']],
      ['Spain', ['lanzarote', 'tenerife']],
    ]);
  });
});
