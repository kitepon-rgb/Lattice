import { describe, expect, it } from 'vitest';

import { selectExactTraversalCandidate } from '../src/bin/exact-traversal';

const candidate = (name: string, filePath: string, qualifiedName?: string) => ({
  node: { name, filePath, ...(qualifiedName === undefined ? {} : { qualifiedName }) },
});

describe('exact traversal candidate', () => {
  it('symbolとpathが同時に一致する一意nodeだけを返す', () => {
    const exact = candidate('compileRoomEvent', 'src/room-event.mjs');
    const selected = selectExactTraversalCandidate([
      candidate('Room.compileRoomEvent', 'src/fuzzy.mjs'),
      candidate('compileRoomEvent', 'src/other.mjs'),
      exact,
    ], 'compileRoomEvent', 'src/room-event.mjs');
    expect(selected).toEqual({ outcome: 'ready', candidate: exact });
  });

  it('qualifiedName exactを受理し、suffix・path違いは受理しない', () => {
    const qualified = candidate('method', 'src/room-event.mjs', 'Room.compileRoomEvent');
    expect(selectExactTraversalCandidate([
      candidate('Room.compileRoomEvent', 'src/fuzzy.mjs'), qualified,
    ], 'Room.compileRoomEvent', 'src/room-event.mjs')).toEqual({
      outcome: 'ready', candidate: qualified,
    });
    expect(selectExactTraversalCandidate([
      candidate('Room.compileRoomEvent', 'src/fuzzy.mjs'),
    ], 'compileRoomEvent', 'src/room-event.mjs')).toEqual({
      outcome: 'absent', candidate: null,
    });
  });

  it('同じsymbolとpathに複数nodeがあれば曖昧として止める', () => {
    expect(selectExactTraversalCandidate([
      candidate('compileRoomEvent', 'src/room-event.mjs'),
      candidate('compileRoomEvent', 'src/room-event.mjs'),
    ], 'compileRoomEvent', 'src/room-event.mjs')).toEqual({
      outcome: 'ambiguous', candidate: null,
    });
  });
});
