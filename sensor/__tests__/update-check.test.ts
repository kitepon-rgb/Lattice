import { describe, expect, it } from 'vitest';

import * as retiredUpdateCheck from '../src/upgrade/update-check';

describe('Lattice sensor network isolation', () => {
  it('does not expose the absorbed LatticeSensor update-check runtime', () => {
    expect(Object.keys(retiredUpdateCheck)).toEqual([]);
  });
});
