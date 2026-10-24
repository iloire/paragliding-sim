import { describe, expect, it } from 'vitest';
import { Polar, WINGS, referenceSetup } from './polar';

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

describe('Polar for a wing setup', () => {
  const spec = WINGS['EN-B'];
  const ref = new Polar(spec);
  const at = (areaM2: number, aspectRatio: number, allUpKg: number) => new Polar(spec, { areaM2, aspectRatio, allUpKg });

  it('is the class polar on the reference setup', () => {
    const p = new Polar(spec, referenceSetup(spec));
    expect(p.trim).toBe(ref.trim);
    expect(p.sink(9)).toBe(ref.sink(9));
  });

  it('scales every speed and sink with √(wing loading), keeping the glide', () => {
    const heavy = at(24, spec.aspectRatio, 95 * 1.21); // 21 % more load → 10 % faster
    expect(heavy.trim).toBeCloseTo(ref.trim * 1.1, 6);
    expect(heavy.stall).toBeCloseTo(ref.stall * 1.1, 6);
    expect(heavy.sink(heavy.trim)).toBeCloseTo(ref.sink(ref.trim) * 1.1, 6);
    expect(heavy.bestGlide().ratio).toBeCloseTo(ref.bestGlide().ratio, 2);
  });

  it('glides better on a higher aspect ratio', () => {
    expect(at(24, 6.5, 95).bestGlide().ratio).toBeGreaterThan(ref.bestGlide().ratio + 0.5);
    expect(at(24, 4.6, 95).bestGlide().ratio).toBeLessThan(ref.bestGlide().ratio - 0.5);
  });

  it('glides worse on a small wing, where the pilot is more of the drag', () => {
    const mini = at(16, spec.aspectRatio, 95 * (16 / 24)); // same loading
    expect(mini.trim).toBeCloseTo(ref.trim, 6);
    expect(mini.bestGlide().ratio).toBeLessThan(ref.bestGlide().ratio - 1);
  });
});
