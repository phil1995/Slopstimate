import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Harness } from './harness';
const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
describe('authorization and input defenses', () => {
  it('denies every admin action to members, strangers and malformed secrets', async () => {
    const { path, adminToken } = await h.room();
    const member = await h.join(path);
    for (const token of [
      undefined,
      'f'.repeat(64),
      member.memberToken,
      'short',
    ]) {
      for (const action of ['reveal', 'reset', 'settings']) {
        const response = await h.request(
          `${path}/admin/${action}`,
          { round: 1 },
          token,
        );
        expect([401, 403]).toContain(response.status);
      }
      expect([401, 403]).toContain(
        (await h.request(path, {}, token, 'DELETE')).status,
      );
    }
    expect((await h.snapshot(path, adminToken)).round).toBe(1);
    expect((await h.snapshot(path, adminToken)).revealed).toBe(false);
  });
  it('rejects impersonation and invalidates departed member secrets', async () => {
    const { path } = await h.room();
    const member = await h.join(path);
    expect(
      (
        await h.request(`${path}/vote`, {
          memberId: member.memberId,
          vote: '8',
          round: 1,
        })
      ).status,
    ).toBe(401);
    expect(
      (await h.request(`${path}/vote`, { vote: '8', round: 1 }, 'e'.repeat(64)))
        .status,
    ).toBe(401);
    expect(
      (await h.request(`${path}/leave`, {}, member.memberToken)).status,
    ).toBe(200);
    expect(
      (await h.request(`${path}/join`, { name: 'Again' }, member.memberToken))
        .status,
    ).toBe(401);
    expect(
      (
        await h.request(
          `${path}/vote`,
          { vote: '8', round: 1 },
          member.memberToken,
        )
      ).status,
    ).toBe(401);
  });
  it('validates names, deck options, choices, rounds and unexpected fields', async () => {
    const { path, adminToken } = await h.room();
    const member = await h.join(path);
    for (const name of ['', 'a'.repeat(41), '\u0000bad', 22])
      expect((await h.request(`${path}/join`, { name })).status).toBe(400);
    const state = await h.snapshot(path, adminToken);
    for (const deck of [
      [],
      ['1'],
      ['1', '1'],
      ['1', ' 1 '],
      ['1', ''],
      ['1', 'x'.repeat(17)],
      Array.from({ length: 21 }, (_, i) => String(i)),
      [1, 2],
    ]) {
      expect(
        (
          await h.request(
            `${path}/admin/settings`,
            { title: 'Room', deck, version: state.version },
            adminToken,
          )
        ).status,
      ).toBe(400);
    }
    for (const vote of ['100', '<img>', '', 3])
      expect(
        (
          await h.request(
            `${path}/vote`,
            { vote, round: 1 },
            member.memberToken,
          )
        ).status,
      ).toBe(400);
    for (const round of [0, -1, 1.2, '1'])
      expect(
        (
          await h.request(
            `${path}/vote`,
            { vote: '3', round },
            member.memberToken,
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await h.request(
          `${path}/vote`,
          { vote: '3', round: 1, isAdmin: true },
          member.memberToken,
        )
      ).status,
    ).toBe(400);
  });
  it('rejects cross-origin and missing-origin mutations and WebSocket upgrades', async () => {
    const { path, adminToken } = await h.room();
    for (const origin of [
      undefined,
      'https://evil.test',
      'https://poker.test.evil.test',
    ]) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      };
      if (origin) headers.Origin = origin;
      const response = await h.mf.dispatchFetch(
        `https://poker.test${path}/admin/reveal`,
        { method: 'POST', headers, body: '{"round":1}' },
      );
      expect(response.status).toBe(403);
      expect(
        (
          await h.mf.dispatchFetch(`https://poker.test${path}/ws`, {
            headers: { ...headers, Upgrade: 'websocket' },
          })
        ).status,
      ).toBe(403);
    }
    expect((await h.request(`${path}?adminToken=abc`)).status).toBe(400);
    const response = await h.request(path);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  it('limits JSON bytes including chunked bodies and rejects invalid JSON or content types', async () => {
    const { path } = await h.room();
    expect(
      (await h.request(`${path}/join`, { name: 'x'.repeat(5000) })).status,
    ).toBe(413);
    const response = await h.mf.dispatchFetch(
      `https://poker.test${path}/join`,
      {
        method: 'POST',
        headers: {
          Origin: 'https://poker.test',
          'Content-Type': 'application/json',
        },
        body: '{broken',
      },
    );
    expect(response.status).toBe(400);
    expect(
      (
        await h.mf.dispatchFetch(`https://poker.test${path}/join`, {
          method: 'POST',
          headers: { Origin: 'https://poker.test' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect((await h.request(`/api/rooms/${'x'.repeat(2200)}`)).status).toBe(
      414,
    );
  });
  it('enforces durable member mutation and join limits', async () => {
    const { path } = await h.room();
    const { memberToken } = await h.join(path);
    let response;
    for (let i = 0; i < 61; i++)
      response = await h.request(
        `${path}/vote`,
        { vote: i % 2 ? '3' : '5', round: 1 },
        memberToken,
      );
    expect(response!.status).toBe(429);
    await h.restart();
    expect(
      (await h.request(`${path}/vote`, { vote: '8', round: 1 }, memberToken))
        .status,
    ).toBe(429);
    const joinedRoom = await h.room();
    for (let i = 0; i < 31; i++)
      response = await h.request(
        `${joinedRoom.path}/join`,
        { name: `Member ${i}` },
        undefined,
        'POST',
        '198.51.100.2',
      );
    expect(response!.status).toBe(429);
  });
  it('caps saved members and rate limits room creation', async () => {
    const { path } = await h.room();
    for (let i = 0; i < 50; i++) {
      expect(
        (
          await h.request(
            `${path}/join`,
            { name: `Person ${i}` },
            undefined,
            'POST',
            `203.0.113.${i}`,
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await h.request(
          `${path}/join`,
          { name: 'Extra' },
          undefined,
          'POST',
          '203.0.113.100',
        )
      ).status,
    ).toBe(409);
    let response;
    for (let i = 0; i < 11; i++)
      response = await h.request(
        '/api/rooms',
        {},
        undefined,
        'POST',
        '198.51.100.90',
      );
    expect(response!.status).toBe(429);
  });
});
