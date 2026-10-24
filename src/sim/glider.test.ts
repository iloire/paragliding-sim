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
  });

  it('drops like a stone in a held full stall, and flies again hands up', () => {
    const s = createGlider(0, 0, 1000, 0, 'flying', polar.trim);
    const full = { ...hands, brakeLeft: 1, brakeRight: 1 };
    let minLoad = Infinity;
    for (let i = 0; i < 3 * 120; i++) { stepGlider(s, full, polar, flatWorld(), 1 / 120); minLoad = Math.min(minLoad, s.load); }
    expect(minLoad).toBeLessThan(0.5); // the canopy deflates and the pilot falls into the lines
    run(s, full, flatWorld(), 5);
    expect(s.deflation).toBe(1);
    expect(s.vz).toBeLessThan(-8);
    expect(s.groundSpeed).toBeLessThan(3);
    expect(Math.abs(s.bank)).toBeLessThan(0.3); // canopy overhead, not "upside down" about a vertical path
    run(s, hands, flatWorld(), 7);
    expect(s.stalled).toBe(false);
    expect(s.deflation).toBe(0);
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
    // The canopy pitches back as it brakes, so the zoom is short: it climbs, and the speed is gone.
    expect(maxVz).toBeGreaterThan(0.3);
    expect(s.airspeed).toBeLessThan(polar.trim - 3);
  });

  it('sinks about 1 m/s more on full bar, steadily, and gives it back when released', () => {
    const s = createGlider(0, 0, 3000, 0, 'flying', polar.trim);
    const vzOn: number[] = [], vzOff: number[] = [];
    for (let i = 0; i < 120 * 50; i++) {
      // The bar ramps in and out over 0.4 s, as the keyboard pushes it.
      const speedBar = i < 120 * 25 ? Math.min(i / 48, 1) : Math.max(1 - (i - 120 * 25) / 48, 0);
      stepGlider(s, { ...hands, speedBar }, polar, flatWorld(), 1 / 120);
      (i < 120 * 25 ? vzOn : vzOff).push(s.vz);
    }
    const trimSink = polar.sink(polar.trim), barSink = polar.sink(polar.top);
    expect(barSink - trimSink).toBeCloseTo(1, 0);
    // No dive and no swing back up: from the first second on, it sinks at the bar's rate or near it.
    for (const vz of vzOn.slice(120)) expect(-vz).toBeGreaterThan(trimSink + 0.4);
    expect(Math.min(...vzOn)).toBeGreaterThan(-barSink - 0.2);
    expect(vzOn.at(-1)).toBeCloseTo(-barSink, 1);
    expect(s.airspeed).toBeLessThan(polar.trim + 1);
    // Letting go, the wing pitches back and trades its speed for a little height, but never climbs.
    expect(Math.max(...vzOff)).toBeLessThan(0);
    expect(vzOff.at(-1)).toBeCloseTo(-trimSink, 1);
  });

  it('winds into a spiral dive on a held deep brake, and comes out when released', () => {
    const s = createGlider(0, 0, 3000, 0, 'flying', polar.trim);
    run(s, { ...hands, brakeRight: 0.8 }, flatWorld(), 16);
    expect(s.bank).toBeGreaterThan(1.15); // > 65°
    expect(s.load).toBeGreaterThan(2.5);
    expect(s.vz).toBeLessThan(-8);
    expect(s.inSpiral).toBe(true);
    run(s, hands, flatWorld(), 15);
    expect(Math.abs(s.bank)).toBeLessThan(0.25);
    expect(s.load).toBeLessThan(1.4);
  });

  it('winds a spiral tighter on more brake: faster round, more sink, more G — and it is not a stall', () => {
    const s = createGlider(0, 0, 9000, 0, 'flying', polar.trim);
    let prev = s.heading, turned = 0, stalled = false;
    const hold = (brakeRight: number, seconds: number) => {
      turned = 0;
      for (let i = 0; i < seconds * 120; i++) {
        stepGlider(s, { ...hands, brakeRight }, polar, flatWorld(), 1 / 120);
        turned += Math.atan2(Math.sin(s.heading - prev), Math.cos(s.heading - prev));
        prev = s.heading;
        stalled ||= s.stalled;
      }
      return { rate: turned / seconds, vz: s.vz, load: s.load };
    };
    hold(0.8, 18);
    const locked = hold(0.8, 4);
    hold(1, 8);
    const deeper = hold(1, 4);
    expect(deeper.rate).toBeGreaterThan(locked.rate * 1.3);
    expect(deeper.vz).toBeLessThan(locked.vz - 3);
    expect(deeper.load).toBeGreaterThan(locked.load + 1.5);
    expect(stalled).toBe(false);
  });

  it('unwinds a spiral when the brake is eased back to a turn\'s', () => {
    const s = createGlider(0, 0, 9000, 0, 'flying', polar.trim);
    run(s, { ...hands, brakeRight: 1 }, flatWorld(), 20);
    expect(s.load).toBeGreaterThan(4);
    run(s, { ...hands, brakeRight: 0.6 }, flatWorld(), 20);
    expect(s.bank).toBeLessThan(0.6);
    expect(s.load).toBeLessThan(1.3);
  });

  it('does not lock a 70 % turn into a spiral in bumpy air: without the deep brake it unwinds', () => {
    const s = createGlider(0, 0, 9000, 0, 'flying', polar.trim);
    const bumps = flatWorld([0, 0], (t) => 1.5 * Math.sin(t * 1.3) * Math.sin(t * 0.37 + 1));
    let spiralling = 0;
    const steps = 90 * 120;
    for (let i = 0; i < steps; i++) {
      stepGlider(s, { ...hands, brakeRight: 0.7 }, polar, bumps, 1 / 120);
      if (s.inSpiral) spiralling++;
    }
    // A strong gust can still tip the turn into a spiral for a few seconds; it must come back out.
    expect(spiralling / steps).toBeLessThan(0.5);
  });

  /**
   * Pumps wingovers for 25 s: brake and lean on one side, then the other, every `period / 2` s.
   * Returns the biggest bank, the load at that moment, and how many times a side folded.
   */
  function wingovers(brake: number, period: number): { maxBank: number; topLoad: number; collapses: number } {
    const s = createGlider(0, 0, 4000, 0, 'flying', polar.trim);
    let maxBank = 0, topLoad = 0, collapses = 0;
    for (let i = 0; i < 120 * 25; i++) {
      const side = Math.floor(i / 120 / (period / 2)) % 2 === 0 ? 1 : -1;
      stepGlider(s, { ...hands, brakeRight: side > 0 ? brake : 0, brakeLeft: side < 0 ? brake : 0, weightShift: side }, polar, flatWorld(), 1 / 120);
      if (Math.abs(s.bank) > maxBank) { maxBank = Math.abs(s.bank); topLoad = s.load; }
      if (s.event === 'collapse') collapses++;
      s.event = null;
    }
    return { maxBank, topLoad, collapses };
  }

  it('builds wingovers past 90° when the pilot pumps in the swing\'s rhythm', () => {
    const { maxBank, collapses } = wingovers(0.8, 6);
    expect(maxBank).toBeGreaterThan((90 * Math.PI) / 180);
    expect(collapses).toBe(0);
  });

  it('goes light at the top of a big wingover, the pilot swinging up over the wing', () => {
    const { topLoad } = wingovers(0.8, 6);
    expect(topLoad).toBeLessThan(1);
  });

  it('does not build a swing when the pilot pumps out of rhythm', () => {
    const { maxBank } = wingovers(0.8, 3);
    expect(maxBank).toBeLessThan((50 * Math.PI) / 180);
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

  it.each([
    ['a mini', 15, 5.5, 90],
    ['a heavy wing', 22, 5.5, 115],
    ['a big light wing', 30, 4.8, 70],
  ])('flies %s at its own polar', (_name, areaM2, aspectRatio, allUpKg) => {
    const p = new Polar(WINGS['EN-B'], { areaM2, aspectRatio, allUpKg });
    const s = createGlider(0, 0, 3000, 0, 'flying', p.trim);
    for (let i = 0; i < 60 * 120; i++) stepGlider(s, hands, p, flatWorld(), 1 / 120);
    expect(s.airspeed).toBeCloseTo(p.trim, 0);
    expect(Math.hypot(s.x, s.y) / (3000 - s.z)).toBeCloseTo(p.trim / p.sink(p.trim), 0);
  });
});

