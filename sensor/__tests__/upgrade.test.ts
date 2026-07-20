import { describe, expect, it } from 'vitest';

import * as retiredUpgrade from '../src/upgrade';

describe('Lattice sensor release ownership', () => {
  it('does not expose the absorbed LatticeSensor self-upgrade runtime', () => {
    expect('runUpgrade' in retiredUpgrade).toBe(false);
    expect('resolveLatestVersion' in retiredUpgrade).toBe(false);
  });
});
