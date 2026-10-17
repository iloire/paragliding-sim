import { describe, expect, it } from 'vitest';
import { createGlider, stepGlider, type Controls, type Environment } from './glider';
import { Polar, WINGS } from './polar';

const polar = new Polar(WINGS['EN-B']);
const hands: Controls = { brakeLeft: 0, brakeRight: 0, speedBar: 0, weightShift: 0, run: false };

function flatWorld(wind: [number, number] = [0, 0], w: (t: number) => number = () => 0): Environment {
  return {
    air: (_x, _y, _z, t) => ({ u: wind[0], v: wind[1], w: w(t) }),
    ground: () => 0,
    isWater: () => false,
  };
}

function run(s: ReturnType<typeof createGlider>, c: Controls, env: Environment, seconds: number): void {
  for (let i = 0; i < seconds * 120; i++) stepGlider(s, c, polar, env, 1 / 120);
}

describe('glider', () => {
  it('glides at the polar ratio in still air', () => {
    const s = createGlider(0, 0, 1000, 0, 'flying', polar.trim);
    run(s, hands, flatWorld(), 60);
    const glide = Math.hypot(s.x, s.y) / (1000 - s.z);
    expect(glide).toBeCloseTo(polar.trim / polar.sink(polar.trim), 0);
  });

  it('turns towards the pulled brake', () => {
    const s = createGlider(0, 0, 1000, 0, 'flying', polar.trim);
    run(s, { ...hands, brakeRight: 0.6 }, flatWorld(), 3);
    expect(s.bank).toBeGreaterThan(0.2);
    expect(s.heading).toBeGreaterThan(0.3);
    expect(s.heading).toBeLessThan(Math.PI);
  });

  it('stalls when both brakes are held deep', () => {
    const s = createGlider(0, 0, 1000, 0, 'flying', polar.trim);
    run(s, { ...hands, brakeLeft: 1, brakeRight: 1 }, flatWorld(), 3);
    expect(s.stalled).toBe(true);
    expect(s.vz).toBeLessThan(-4);
    run(s, hands, flatWorld(), 2);
    expect(s.stalled).toBe(false);
  });

  it('lands softly from a normal glide', () => {
    const s = createGlider(0, 0, 3, 0, 'flying', polar.trim);
    run(s, hands, flatWorld(), 5);
    expect(s.phase).toBe('ground');
    expect(s.event).toBe('landed');
  });

  it('crashes landing downwind on full bar', () => {
    const s = createGlider(0, 0, 3, 0, 'flying', polar.top);
    run(s, { ...hands, speedBar: 1 }, flatWorld([0, 6]), 5);
    expect(s.phase).toBe('crashed');
  });

  it('takes off running down a slope into a 15 km/h wind and stays up', () => {
    const slope: Environment = { ...flatWorld([0, -15 / 3.6]), ground: (_x, y) => 100 - 0.4 * y };
    const s = createGlider(0, 0, 100, 0, 'ground');
    run(s, { ...hands, run: true }, slope, 8);
    expect(s.phase).toBe('flying');
    expect(s.z - slope.ground(s.x, s.y)).toBeGreaterThan(6);
  });

  it('keeps running through a stumble just after lift-off', () => {
    const s = createGlider(0, 0, 0, 0, 'ground');
    run(s, { ...hands, run: true }, flatWorld([0, -25 / 3.6]), 3);
    expect(s.event).not.toBe('landed');
  });

  it('cannot take off on the flat with no wind', () => {
    const s = createGlider(0, 0, 0, 0, 'ground');
    run(s, { ...hands, run: true }, flatWorld(), 5);
    expect(s.phase).toBe('ground');
  });

  it('flares: full brakes from trim trade speed for a climb', () => {
    const s = createGlider(0, 0, 100, 0, 'flying', polar.trim);
    let maxVz = -Infinity;
    for (let i = 0; i < 150; i++) {
      stepGlider(s, { ...hands, brakeLeft: 1, brakeRight: 1 }, polar, flatWorld(), 1 / 120);
      maxVz = Math.max(maxVz, s.vz);
    }
    expect(maxVz).toBeGreaterThan(1);
  });

  it('winds into a spiral dive on a held deep brake, and comes out when released', () => {
    const s = createGlider(0, 0, 3000, 0, 'flying', polar.trim);
    run(s, { ...hands, brakeRight: 1 }, flatWorld(), 12);
    expect(s.bank).toBeGreaterThan(1.15); // > 65°
    expect(s.load).toBeGreaterThan(2.5);
    expect(s.vz).toBeLessThan(-8);
    expect(s.inSpiral).toBe(true);
    run(s, hands, flatWorld(), 15);
    expect(Math.abs(s.bank)).toBeLessThan(0.25);
    expect(s.load).toBeLessThan(1.4);
  });

  /**
   * Pumps wingovers for 25 s and returns the bank at each end of the swing, plus collapses.
   * `phase` +1 pulls the brake on the side the wing is swinging towards (from level until it is
   * 45° up, then hands up); −1 pulls against the swing.
   */
  function wingovers(brake: number, phase: 1 | -1): { peaks: number[]; collapses: number } {
    const s = createGlider(0, 0, 3000, 0, 'flying', polar.trim);
    const peaks: number[] = [];
    let collapses = 0;
    for (let i = 0; i < 120 * 25; i++) {
      const toward = i < 60 ? 1 : Math.sign(s.bankRate) || 1;
      const pulling = i < 60 || Math.abs(s.bank) < 0.8 || Math.sign(s.bank) !== toward;
      const dir = toward * phase;
      const b = pulling ? brake : 0;
      const rate = s.bankRate;
      stepGlider(s, { ...hands, brakeRight: dir > 0 ? b : 0, brakeLeft: dir < 0 ? b : 0, weightShift: pulling ? dir : 0 }, polar, flatWorld(), 1 / 120);
      if (i > 60 && Math.sign(rate) !== Math.sign(s.bankRate)) peaks.push(Math.abs(s.bank));
      if (s.event === 'collapse') collapses++;
      s.event = null;
    }
    return { peaks, collapses };
  }

  it('builds wingovers past 90° over several swings when the pilot pumps in rhythm', () => {
    const { peaks, collapses } = wingovers(0.6, 1);
    expect(Math.max(...peaks)).toBeGreaterThan((95 * Math.PI) / 180);
    expect(peaks[4]).toBeGreaterThan(peaks[0] + 0.5); // momentum carries over: each swing adds to the last
    expect(collapses).toBe(0);
  });

  it('does not build a swing when the pilot pumps against it', () => {
    const { peaks } = wingovers(0.6, -1);
    expect(Math.max(...peaks)).toBeLessThan((20 * Math.PI) / 180);
  });

  it('folds a side when an overcooked wingover swings too far over the wing', () => {
    const { peaks, collapses } = wingovers(1, 1);
    expect(Math.max(...peaks)).toBeGreaterThan(2.2);
    expect(collapses).toBeGreaterThan(0);
  });

  it('folds a side in a sharp down-gust, then reopens', () => {
    const s = createGlider(0, 0, 1000, 0, 'flying', polar.trim);
    const gust = flatWorld([0, 0], (t) => (t > 2 ? -5 : 0));
    const events: string[] = [];
    for (let i = 0; i < 120 * 8; i++) {
      stepGlider(s, hands, polar, gust, 1 / 120);
      if (s.event) { events.push(s.event); s.event = null; }
    }
    expect(events).toContain('collapse');
    expect(events).toContain('reinflated');
  });

  it('shrugs off ordinary small gusts', () => {
    const s = createGlider(0, 0, 1000, 0, 'flying', polar.trim);
    const bumpy = flatWorld([0, 0], (t) => 0.6 * Math.sin(t * 2));
    run(s, hands, bumpy, 30);
    expect(s.collapse).toBe(0);
    expect(s.event).not.toBe('collapse');
  });
});
