import { describe, expect, it } from 'vitest';
import { cliffTerrain } from './fixtures';
import { ThermalField, type Thermal } from './thermals';

describe('ThermalField', () => {
  const terrain = cliffTerrain();
  const mature: Thermal = { x: 3000, y: 3000, base: 400, radius: 80, strength: 2.5, born: -200, life: 600 };

  it('climbs at full strength in the core of a mature thermal', () => {
    const f = new ThermalField(terrain);
    f.thermals = [mature];
    expect(f.sample(3000, 3000, 700, 0, 0, 0, 1500)).toBeCloseTo(2.5, 1);
  });

  it('has sink around the core and nothing above cloudbase', () => {
    const f = new ThermalField(terrain);
    f.thermals = [mature];
    expect(f.sample(3000 + 2.2 * 80, 3000, 700, 0, 0, 0, 1500)).toBeLessThan(0);
    expect(f.sample(3000, 3000, 1500, 0, 0, 0, 1500)).toBe(0);
  });

  it('leans the column downwind', () => {
    const f = new ThermalField(terrain);
    f.thermals = [mature];
    const [x] = f.centreAt(mature, 900, 5, 0);
    expect(x).toBeCloseTo(3000 + 5 * (500 / 2.5));
  });

  it('only triggers over land', () => {
    const f = new ThermalField(terrain, 7);
    f.update(0, 2);
    expect(f.thermals.length).toBe(24);
    for (const th of f.thermals) expect(th.base).toBeGreaterThanOrEqual(30);
  });

  it('marks mature thermals with a cloud at cloudbase', () => {
    const f = new ThermalField(terrain);
    f.thermals = [mature];
    const clouds = f.clouds(0, 0, 0, 1200);
    expect(clouds).toHaveLength(1);
    expect(clouds[0].z).toBeGreaterThan(1200);
  });

  it('follows the sun: weaker and fewer on a low heating', () => {
    const f = new ThermalField(terrain, 7);
    f.thermals = [mature];
    f.activity = 0.4;
    expect(f.sample(3000, 3000, 700, 0, 0, 0, 1500)).toBeCloseTo(2.5 * 0.4, 1);
    f.update(0, 2);
    expect(f.thermals.length).toBe(Math.round(24 * 0.6));
    f.activity = 0;
    f.update(1, 2);
    expect(f.thermals).toHaveLength(0);
  });

  it('triggers on slopes facing a low sun, not on the ones in their own shade', () => {
    const low = 10 * Math.PI / 180;
    const count = (sunFromNorth: boolean): [number, number] => {
      const f = new ThermalField(terrain, 3);
      f.sun = [0, (sunFromNorth ? 1 : -1) * Math.cos(low), Math.sin(low)];
      let south = 0, north = 0;
      for (let t = 0; t < 40; t++) {
        f.thermals = [];
        f.update(t * 1000, 2);
        for (const th of f.thermals) {
          if (th.y > 2050 && th.y < 2350) south++; // the cliff faces south
          if (th.y > 4050 && th.y < 4350) north++; // the far slope faces north
        }
      }
      return [south, north];
    };
    const [southFace, northFace] = count(false);
    expect(southFace).toBeGreaterThan(3 * Math.max(northFace, 1));
    const [southFace2, northFace2] = count(true);
    expect(northFace2).toBeGreaterThan(3 * Math.max(southFace2, 1));
  });
});
