import { describe, expect, it } from 'vitest';
import { createGlider, stepGlider, type Controls, type Environment } from './glider';
import { Polar, WINGS } from './polar';

const polar = new Polar(WINGS['EN-B']);
const hands: Controls = { brakeLeft: 0, brakeRight: 0, speedBar: 0, weightShift: 0, run: false };

function flatWorld(wind: [number, number] = [0, 0]): Environment {
  return {
    air: () => ({ u: wind[0], v: wind[1], w: 0 }),
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
});
