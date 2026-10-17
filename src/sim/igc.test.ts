import { describe, expect, it } from 'vitest';
import { buildIgc, encodeLatLon, formatB } from './igc';

describe('IGC encoding', () => {
  it('encodes the Famara launch', () => {
    expect(encodeLatLon(29.08, true)).toBe('2904800N');
    expect(encodeLatLon(-13.558, false)).toBe('01333480W');
  });

  it('carries 59.9995 minutes into the next degree', () => {
    expect(encodeLatLon(10 + 59.99996 / 60, true)).toBe('1100000N');
  });

  it('formats a 35-char B record', () => {
    const b = formatB({ time: new Date(Date.UTC(2026, 9, 17, 14, 5, 9)), lat: 29.08, lon: -13.558, alt: 512.4 });
    expect(b).toBe('B1405092904800N01333480WA0051200512');
    expect(b).toHaveLength(35);
  });

  it('writes the date header', () => {
    const igc = buildIgc([{ time: new Date(Date.UTC(2026, 9, 17, 14, 0, 0)), lat: 29, lon: -13, alt: 0 }], 'Famara');
    expect(igc).toContain('HFDTEDATE:171026,01');
  });
});
