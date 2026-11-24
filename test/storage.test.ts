import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/kvs', () => ({ default: {}, Sort: { ASC: 'ASC', DESC: 'DESC' }, WhereConditions: {} }));
const { toEntitySeconds } = await import('../src/storage/repo');

describe('entity time attributes', () => {
  // Forge entity `integer` attributes are 32-bit: deploying with epoch ms failed on a live site with
  // 'Data type for property "startedAt" is defined as "integer"'.
  it('stores epoch seconds that fit a signed 32-bit integer', () => {
    const ms = Date.UTC(2037, 11, 31);
    expect(toEntitySeconds(ms)).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(Number.isInteger(toEntitySeconds(1_795_536_000_123))).toBe(true);
    expect(toEntitySeconds(1_795_536_000_999)).toBe(1_795_536_000);
    expect(Date.now()).toBeGreaterThan(2 ** 31 - 1); // ms would overflow
  });
});
