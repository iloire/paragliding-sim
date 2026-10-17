import { describe, expect, it } from 'vitest';
import { varioTone } from './vario';

describe('varioTone', () => {
  it('is silent in zero-ish air', () => {
    expect(varioTone(0).mode).toBe('silent');
    expect(varioTone(-1.5).mode).toBe('silent');
  });

  it('growls in strong sink', () => {
    expect(varioTone(-2.5)).toEqual({ mode: 'sink', freq: 220 });
  });

  it('beeps higher and faster as lift strengthens', () => {
    const weak = varioTone(0.5), strong = varioTone(3);
    if (weak.mode !== 'beep' || strong.mode !== 'beep') throw new Error('expected beeps');
    expect(strong.freq).toBeGreaterThan(weak.freq);
    expect(strong.periodMs).toBeLessThan(weak.periodMs);
    expect(varioTone(9)).toEqual({ mode: 'beep', freq: 1600, periodMs: 120 });
  });
});
