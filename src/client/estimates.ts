import type { RoomSnapshot } from '../shared/protocol';

export function summarizeEstimates(
  room: RoomSnapshot | null,
): { mean: number | null; count: number } | null {
  if (!room?.revealed) return null;
  const estimates = room.members.flatMap((member) => {
    if (
      typeof member.vote !== 'string' ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(member.vote)
    )
      return [];
    const value = Number(member.vote);
    return Number.isFinite(value) ? [value] : [];
  });
  return {
    mean: estimates.length
      ? estimates.reduce((sum, value) => sum + value, 0) / estimates.length
      : null,
    count: estimates.length,
  };
}
