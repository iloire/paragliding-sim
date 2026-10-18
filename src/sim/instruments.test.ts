import { describe, expect, it } from 'vitest';
import { ClimbAverage, compass, glideTo, TurnTrack } from './instruments';

describe('compass', () => {
  it('names the 16 points and wraps negative and >360° headings', () => {
    expect(compass(0)).toBe('N');
    expect(compass(Math.PI / 2)).toBe('E');
    expect(compass((345 * Math.PI) / 180)).toBe('NNW');
    expect(compass(-Math.PI / 2)).toBe('W');
    expect(compass(2 * Math.PI + Math.PI)).toBe('S');
  });
});

describe('ClimbAverage', () => {
  it('averages over the window and forgets older samples', () => {
    const avg = new ClimbAverage(10);
    for (let i = 0; i < 100; i++) avg.add(-1, 0.1); // 10 s of sink
    expect(avg.value).toBeCloseTo(-1);
    for (let i = 0; i < 50; i++) avg.add(3, 0.1); // 5 s of climb: half the window
    expect(avg.value).toBeCloseTo(1, 1);
    for (let i = 0; i < 100; i++) avg.add(3, 0.1); // the sink has aged out
    expect(avg.value).toBeCloseTo(3);
  });

  it('weights by time, not by sample count', () => {
    const avg = new ClimbAverage(20);
    avg.add(4, 1);
    for (let i = 0; i < 10; i++) avg.add(0, 0.1);
    expect(avg.value).toBeCloseTo(2);
  });

  it('reads zero after a reset', () => {
    const avg = new ClimbAverage();
    avg.add(2, 1);
    avg.reset();
    expect(avg.value).toBe(0);
  });
});

describe('glideTo', () => {
  // Target 1 km north, 100 m below: needs 10:1.
  const at = (glide: number | null) => glideTo(0, 0, 100, 0, 1000, 0, glide);

  it('computes distance, bearing and the required glide', () => {
    const g = at(null);
    expect(g.distance).toBeCloseTo(1000);
    expect(g.bearing).toBeCloseTo(0);
    expect(g.required).toBeCloseTo(10);
    expect(g.status).toBe('none');
    expect(glideTo(0, 0, 100, 1000, 0, 0, null).bearing).toBeCloseTo(Math.PI / 2);
  });

  it('grades the current glide against what is needed', () => {
    expect(at(13).status).toBe('ok');
    expect(at(11).status).toBe('marginal');
    expect(at(9).status).toBe('out');
    expect(at(Infinity).status).toBe('ok'); // climbing
  });

  it('is out of reach when already below the target', () => {
    const g = glideTo(0, 0, 50, 0, 1000, 80, Infinity);
    expect(g.required).toBe(Infinity);
    expect(g.status).toBe('out');
  });
});

describe('TurnTrack', () => {
  it('samples at the interval and keeps only the window', () => {
    const track = new TurnTrack(2, 0.5);
    for (let i = 0; i < 100; i++) track.add(i, 0, 0, 0.1); // 10 s
    expect(track.points).toHaveLength(4);
    expect(track.points[3].x).toBe(99);
  });

  it('finds the strongest climb, or none in sink', () => {
    const track = new TurnTrack(10, 0.1);
    expect(track.best()).toBeNull();
    [-1, 0.5, 2.5, 1].forEach((vz, i) => track.add(i, 0, vz, 0.1));
    expect(track.best()?.vz).toBe(2.5);
    track.reset();
    track.add(0, 0, -2, 0.1);
    expect(track.best()).toBeNull();
  });
});
