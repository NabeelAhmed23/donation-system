import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7 } from '../../src/common/uuid.js';

describe('uuidv7', () => {
  it('generates version 7 UUIDs that carry their creation time', () => {
    const id = uuidv7(1_700_000_000_000);

    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
    expect(id.slice(0, 13).replace('-', '')).toBe((1_700_000_000_000).toString(16).padStart(12, '0'));
  });

  it('sorts by creation time and does not repeat', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);

    expect(earlier < later).toBe(true);
    expect(uuidv7(1_700_000_000_000)).not.toBe(earlier);
  });
});
