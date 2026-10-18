import { describe, expect, it } from 'vitest';
import { thumbControls } from './touch';

describe('thumbControls', () => {
  it('does nothing with no thumbs or resting thumbs', () => {
    expect(thumbControls(null, null)).toEqual({ brakeLeft: 0, brakeRight: 0, speedBar: 0, weightShift: 0, run: false });
    const c = thumbControls({ dx: 0.05, dy: 0.05 }, { dx: -0.05, dy: -0.05 });
    expect(c).toEqual({ brakeLeft: 0, brakeRight: 0, speedBar: 0, weightShift: 0, run: false });
  });

  it('pulls each brake with its own thumb, analog and capped at full travel', () => {
    const half = thumbControls({ dx: 0, dy: 0.54 }, null);
    expect(half.brakeLeft).toBeCloseTo(0.5, 2);
    expect(half.brakeRight).toBe(0);
    const deep = thumbControls(null, { dx: 0, dy: 1.6 });
    expect(deep.brakeRight).toBe(1);
    expect(deep.brakeLeft).toBe(0);
  });

  it('flares with both thumbs all the way down', () => {
    const c = thumbControls({ dx: 0, dy: 1 }, { dx: 0, dy: 1 });
    expect([c.brakeLeft, c.brakeRight]).toEqual([1, 1]);
  });

  it('runs and pushes the bar with a thumb pushed up, never braking', () => {
    const c = thumbControls({ dx: 0, dy: -0.6 }, null);
    expect(c.run).toBe(true);
    expect(c.speedBar).toBeGreaterThan(0.5);
    expect(c.brakeLeft).toBe(0);
    expect(thumbControls({ dx: 0, dy: -0.2 }, null).run).toBe(false);
  });

  it('ignores sideways drift while braking but shifts weight on a deliberate slide', () => {
    expect(thumbControls({ dx: 0.15, dy: 0.8 }, null).weightShift).toBe(0);
    expect(thumbControls({ dx: -0.8, dy: 0 }, null).weightShift).toBeLessThan(-0.6);
    expect(thumbControls({ dx: 0.9, dy: 0 }, { dx: 0.9, dy: 0 }).weightShift).toBe(1);
  });
});
