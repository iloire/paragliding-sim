import { describe, expect, it } from 'vitest';
import { briefing, step, WEATHER_SLIDERS } from './welcome';

describe('welcome screen', () => {
  it('reads the weather the way a pilot says it', () => {
    expect(briefing({ windSpeedKmh: 24.4, windFromDeg: 345, inversionM: 900, thermalStrength: 1.5, turbulence: 0.3 }))
      .toEqual(['Wind NNW 24 km/h', 'Thermals 1.5 m/s', 'Inversion 900 m']);
  });

  it('steps through launches and wings, wrapping at both ends', () => {
    const list = ['famara', 'mala', 'mirador'];
    expect(step(list, 'mala', 1)).toBe('mirador');
    expect(step(list, 'mirador', 1)).toBe('famara');
    expect(step(list, 'famara', -1)).toBe('mirador');
  });

  it('labels each slider with its unit and the wind with a compass point', () => {
    const show = Object.fromEntries(WEATHER_SLIDERS.map((d) => [d.key, d.show]));
    expect(show.windFromDeg(90)).toBe('E 90°');
    expect(show.turbulence(0.35)).toBe('35 %');
  });
});
