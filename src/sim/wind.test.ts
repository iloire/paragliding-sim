import { describe, expect, it } from 'vitest';
import { calmWeather, cliffTerrain } from './fixtures';
import { WindField } from './wind';

describe('WindField ridge lift', () => {
  const terrain = cliffTerrain();
  const onshore = calmWeather({ windSpeedKmh: 20, windFromDeg: 180 });

  it('lifts in front of and over the windward face', () => {
    const wind = new WindField(terrain, onshore, 128);
    expect(wind.ridgeLift(3000, 2200, 250)).toBeGreaterThan(1.5);
    expect(wind.ridgeLift(3000, 1850, 300)).toBeGreaterThan(0.5);
  });

  it('dies out above the soaring band', () => {
    const wind = new WindField(terrain, onshore, 128);
    expect(wind.ridgeLift(3000, 2200, 800)).toBeCloseTo(0, 5);
  });

  it('sinks in the lee', () => {
    const wind = new WindField(terrain, onshore, 128);
    expect(wind.ridgeLift(3000, 4200, 330)).toBeLessThan(-0.5);
  });

  it('scales with wind speed', () => {
    const a = new WindField(terrain, onshore, 128).ridgeLift(3000, 2200, 250);
    const b = new WindField(terrain, { ...onshore, windSpeedKmh: 40 }, 128).ridgeLift(3000, 2200, 250);
    expect(b / a).toBeCloseTo(2, 1);
  });

  it('loses ~30 % with the wind 45° cross (coastal-soaring-lift-factors)', () => {
    const square = new WindField(terrain, onshore, 128).ridgeLift(3000, 2200, 250);
    const cross = new WindField(terrain, { ...onshore, windFromDeg: 225 }, 128).ridgeLift(3000, 2200, 250);
    expect(cross / square).toBeGreaterThan(0.62);
    expect(cross / square).toBeLessThan(0.78);
  });

  it('is crushed by an inversion below the ridge top', () => {
    const open = new WindField(terrain, onshore, 128).ridgeLift(3000, 2200, 250);
    const capped = new WindField(terrain, { ...onshore, inversionM: 350 }, 128).ridgeLift(3000, 2200, 250);
    expect(capped).toBeLessThan(open * 0.5);
  });

  it('gives no lift with an offshore wind', () => {
    const wind = new WindField(terrain, calmWeather({ windSpeedKmh: 20, windFromDeg: 0 }), 128);
    expect(wind.ridgeLift(3000, 2200, 250)).toBeLessThanOrEqual(0);
  });

  it('blows the way the wind comes from', () => {
    const wind = new WindField(terrain, calmWeather({ windSpeedKmh: 36, windFromDeg: 90 }), 128);
    const air = wind.sample(3000, 1000, 500, 0);
    expect(air.u).toBeCloseTo(-10, 1); // from the east → blowing west
    expect(air.v).toBeCloseTo(0, 5);
  });
});
