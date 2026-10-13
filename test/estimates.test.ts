import { describe, expect, it } from 'vitest';
import { summarizeEstimates } from '../src/client/estimates';
import type { RoomSnapshot } from '../src/shared/protocol';

function snapshot(
  votes: (string | null | undefined)[],
  revealed = true,
): RoomSnapshot {
  return {
    id: 'room',
    title: 'Planning Poker',
    deck: ['0', '0.5', '1', '2', '3', '8', '13', '?'],
    round: 1,
    version: 1,
    revealed,
    members: votes.map((vote, index) => ({
      id: String(index),
      name: `Person ${index}`,
      connected: index % 2 === 0,
      voted: vote !== null && vote !== undefined,
      ...(vote !== undefined ? { vote } : {}),
    })),
  };
}

describe('revealed estimation average', () => {
  it('does not expose an average before reveal or before loading', () => {
    expect(summarizeEstimates(null)).toBeNull();
    expect(summarizeEstimates(snapshot(['8', '13'], false))).toBeNull();
  });
  it('includes zero and fractional estimates, including saved members', () => {
    expect(summarizeEstimates(snapshot(['0', '0.5', '1', '3']))).toEqual({
      mean: 1.125,
      count: 4,
    });
    expect(summarizeEstimates(snapshot(['0']))).toEqual({ mean: 0, count: 1 });
  });
  it('excludes skipped, missing, and nonnumeric choices', () => {
    expect(
      summarizeEstimates(
        snapshot([
          '?',
          'XS',
          null,
          undefined,
          '',
          '0x10',
          'Infinity',
          'NaN',
          '1e3',
          '8',
          '13',
        ]),
      ),
    ).toEqual({ mean: 10.5, count: 2 });
  });
  it('represents an empty or all-skipped estimation without a misleading zero', () => {
    expect(summarizeEstimates(snapshot([]))).toEqual({ mean: null, count: 0 });
    expect(summarizeEstimates(snapshot(['?', null]))).toEqual({
      mean: null,
      count: 0,
    });
  });
  it('recomputes from current members and disappears on reset', () => {
    const room = snapshot(['1', '3']);
    expect(summarizeEstimates(room)).toEqual({ mean: 2, count: 2 });
    room.members.pop();
    expect(summarizeEstimates(room)).toEqual({ mean: 1, count: 1 });
    room.revealed = false;
    room.members[0].vote = undefined;
    expect(summarizeEstimates(room)).toBeNull();
  });
});
