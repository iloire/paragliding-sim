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

  it('builds wingovers past 90° when the pilot pumps with the swing', () => {
    const s = createGlider(0, 0, 3000, 0, 'flying', polar.trim);
    let maxBank = 0;
    for (let i = 0; i < 120 * 20; i++) {
      const dir = i < 30 ? 1 : Math.sign(s.bankRate) || 1;
      stepGlider(s, { ...hands, brakeRight: dir > 0 ? 0.85 : 0, brakeLeft: dir < 0 ? 0.85 : 0, weightShift: dir }, polar, flatWorld(), 1 / 120);
      maxBank = Math.max(maxBank, Math.abs(s.bank));
    }
    expect(maxBank).toBeGreaterThan(Math.PI / 2);
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
