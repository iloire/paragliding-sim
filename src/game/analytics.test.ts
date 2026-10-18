import { describe, expect, it } from 'vitest';
import { durationBucket } from './analytics';

describe('durationBucket', () => {
  it('groups flight lengths at the bucket edges', () => {
    expect(durationBucket(0)).toBe('under-30s');
    expect(durationBucket(29.9)).toBe('under-30s');
    expect(durationBucket(30)).toBe('30s-2min');
    expect(durationBucket(119)).toBe('30s-2min');
    expect(durationBucket(120)).toBe('2-10min');
    expect(durationBucket(600)).toBe('10-30min');
    expect(durationBucket(1800)).toBe('30min-plus');
  });
});
