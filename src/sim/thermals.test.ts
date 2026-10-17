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
});
