import { describe, expect, it } from 'vitest';
import { Polar, WINGS } from './polar';

describe('Polar', () => {
  const p = new Polar(WINGS['EN-B']);

  it('passes through the spec points', () => {
    expect(p.sink(p.minSinkSpeed)).toBeCloseTo(1.0, 3);
    expect(p.sink(p.trim)).toBeCloseTo(1.1, 3);
  });

  it('has min sink at the min-sink speed', () => {
    expect(p.sink(p.minSinkSpeed - 0.5)).toBeGreaterThan(p.sink(p.minSinkSpeed));
    expect(p.sink(p.minSinkSpeed + 0.5)).toBeGreaterThan(p.sink(p.minSinkSpeed));
  });

  it('mushes near the stall', () => {
    expect(p.sink(p.stall)).toBeGreaterThan(2.5);
  });

  it('gives an EN-B glide of about 9–10 at trim', () => {
    expect(p.trim / p.sink(p.trim)).toBeGreaterThan(9);
    expect(p.trim / p.sink(p.trim)).toBeLessThan(10);
  });

  it('maps controls to airspeed', () => {
    expect(p.targetSpeed(0, 0)).toBeCloseTo(p.trim);
    expect(p.targetSpeed(1, 0)).toBeCloseTo(p.fullBrake);
    expect(p.targetSpeed(0, 1)).toBeCloseTo(p.top);
    expect(p.targetSpeed(1, 1)).toBeCloseTo(p.fullBrake); // brakes win over the bar
  });
});
