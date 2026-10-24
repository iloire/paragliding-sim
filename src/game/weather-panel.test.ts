import { describe, expect, it } from 'vitest';
import { compassPoint, offWind, windVerdict } from './weather-panel';

describe('weather panel', () => {
  it('names compass points, wrapping past north', () => {
    expect(compassPoint(345)).toBe('NNW');
    expect(compassPoint(355)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });

  it('measures the wind off a launch, positive from the pilot\'s right', () => {
    expect(offWind(345, 330)).toBe(15);
    expect(offWind(10, 340)).toBe(30);
    expect(offWind(300, 340)).toBe(-40);
    expect(offWind(160, 340)).toBe(-180);
  });

  it('judges the wind at a launch by speed and angle', () => {
    expect(windVerdict(22, 5).tone).toBe('good');
    expect(windVerdict(22, 120).text).toMatch(/lee/);
    expect(windVerdict(42, 0).tone).toBe('bad');
    expect(windVerdict(22, -60).text).toMatch(/left/);
    expect(windVerdict(8, 0).text).toMatch(/light/);
  });
});
