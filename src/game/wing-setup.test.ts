import { describe, expect, it } from 'vitest';
import { classDefaults, presetChoice } from './wing-setup';

describe('classDefaults', () => {
  it("resets to the class's aspect ratio, sized for the pilot's weight", () => {
    expect(classDefaults('EN-C', 95)).toEqual({ areaM2: 24, aspectRatio: 6.2 });
    expect(classDefaults('EN-A', 75)).toEqual({ areaM2: 19, aspectRatio: 5 });
  });

  it('keeps the size within the sliders', () => {
    expect(classDefaults('EN-B', 55).areaM2).toBe(14);
    expect(classDefaults('EN-B', 140).areaM2).toBe(32);
  });

  it('gives the reference wing for the default preset', () => {
    const p = presetChoice('Intermediate')!;
    expect(classDefaults(p.wing, p.allUpKg)).toEqual({ areaM2: p.areaM2, aspectRatio: p.aspectRatio });
  });
});
