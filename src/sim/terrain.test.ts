import { describe, expect, it } from 'vitest';
import { Heightmap } from './terrain';

// A ramp z = x / 10 sampled coarsely over the site, with a bump only the fine tile sees.
const ramp = (x: number) => x / 10;
const bump = (x: number, y: number) => ramp(x) + (Math.hypot(x - 1500, y - 4500) < 100 ? 50 : 0);

function siteWithDetail(): Heightmap {
  const site = Heightmap.fromFunction(16, 6000, ramp);
  site.addDetail(3000, 0, 1, Heightmap.fromFunction(300, 3000, bump, 0, 3000));
  return site;
}

describe('Heightmap detail tiles', () => {
  it('samples a tile in the site frame, using its own origin', () => {
    const tile = Heightmap.fromFunction(300, 3000, ramp, 3000, 0);
    expect(tile.heightAt(4500, 1500)).toBeCloseTo(450, 0);
  });

  it('prefers the detail tile where it exists', () => {
    const site = siteWithDetail();
    expect(site.heightAt(1500, 4500)).toBeGreaterThan(190); // the bump: 150 + 50
    expect(site.detailAt(1500, 4500)).toBeDefined();
  });

  it('falls back to the coarse map outside the tiles', () => {
    const site = siteWithDetail();
    expect(site.detailAt(4500, 1500)).toBeUndefined();
    expect(site.heightAt(4500, 1500)).toBeCloseTo(450, 0);
  });

  it('agrees with the coarse map away from detail-only features', () => {
    const site = siteWithDetail();
    expect(site.heightAt(2500, 3500)).toBeCloseTo(250, 0);
  });
});

describe('Heightmap beyond the site edge', () => {
  it('is open sea for an island', () => {
    const site = Heightmap.fromFunction(16, 6000, ramp);
    expect(site.isWater(-100, 3000)).toBe(true);
    expect(site.groundAt(-100, 3000)).toBe(0);
  });

  it('is a dry plain at its own height inland', () => {
    const site = Heightmap.fromFunction(16, 6000, ramp);
    site.outside = 550;
    expect(site.isWater(-100, 3000)).toBe(false);
    expect(site.groundAt(7000, 3000)).toBe(550);
  });
});

describe('Heightmap from the game file', () => {
  const file = (steps: number[]) => new Int16Array(steps).buffer;

  it('reads decimetres by default', () => {
    expect(Array.from(Heightmap.fromInt16(file([-150, 7590, 32767, 0]), 2, 100).data)).toEqual([-15, 759, 3276.7, 0].map(Math.fround));
  });

  it('reads coarser steps for a region above 3276 m', () => {
    const teide = Heightmap.fromInt16(file([-75, 18575, 18575, 18575]), 2, 100, 0.2);
    expect(teide.data[0]).toBeCloseTo(-15, 3);
    expect(teide.data[1]).toBeCloseTo(3715, 3);
  });
});
