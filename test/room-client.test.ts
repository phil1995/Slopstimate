import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomController } from '../src/client/room.svelte';
import { readIdentity, saveIdentity } from '../src/client/storage';
import type { ServerEvent } from '../src/shared/protocol';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    Socket.instances.push(this);
  }
  receive(event: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  end(code: number) {
    this.onclose?.({ code });
  }
}

const id = 'a'.repeat(32);
const adminToken = 'b'.repeat(64);
const memberToken = 'c'.repeat(64);
let controller: RoomController;
let network: { onLine: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('window', new EventTarget());
  network = { onLine: true };
  vi.stubGlobal('navigator', network);
  vi.stubGlobal('location', new URL('https://poker.test/'));
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id,
            title: 'Planning Poker',
            deck: ['0', '3', '?'],
            round: 1,
            version: 1,
            revealed: false,
          }),
        ),
    ),
  );
  controller = new RoomController(id);
});

afterEach(() => {
  controller.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('initial room identity resolution', () => {
  it('keeps the initial screen pending until saved admin access is verified', async () => {
    saveIdentity(id, { adminToken });
    await controller.start();
    expect(controller.loading).toBe(false);
    expect(controller.room?.title).toBe('Planning Poker');
    expect(controller.resolvingIdentity).toBe(true);
    expect(controller.isAdmin).toBe(false);
    const socket = Socket.instances[0];
    socket.onopen?.();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      type: 'auth',
      adminToken,
    });
    socket.receive({ type: 'authenticated', memberId: null, isAdmin: true });
    expect(controller.resolvingIdentity).toBe(false);
    expect(controller.isAdmin).toBe(true);
    expect(controller.connection).toBe('connected');
  });

  it('also waits for a returning participant, but lets a new visitor join immediately', async () => {
    await controller.start();
    expect(controller.resolvingIdentity).toBe(false);
    expect(controller.connection).toBe('join');
    expect(Socket.instances).toHaveLength(0);
    saveIdentity(id, { memberToken });
    controller.connect();
    expect(controller.resolvingIdentity).toBe(true);
    Socket.instances[0].receive({
      type: 'authenticated',
      memberId: 'member',
      isAdmin: false,
    });
    expect(controller.resolvingIdentity).toBe(false);
    expect(controller.hasMembership).toBe(true);
  });

  it('keeps resolution pending across transient connection failures', async () => {
    saveIdentity(id, { adminToken });
    await controller.start();
    Socket.instances[0].end(1006);
    expect(controller.connection).toBe('reconnecting');
    expect(controller.resolvingIdentity).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(Socket.instances).toHaveLength(2);
    Socket.instances[1].receive({
      type: 'authenticated',
      memberId: null,
      isAdmin: true,
    });
    expect(controller.resolvingIdentity).toBe(false);
  });

  it('shows the normal join state only after admin credentials are rejected', async () => {
    saveIdentity(id, { adminToken });
    await controller.start();
    Socket.instances[0].end(4403);
    expect(controller.resolvingIdentity).toBe(false);
    expect(controller.connection).toBe('join');
    expect(controller.isAdmin).toBe(false);
    expect(readIdentity(id).adminToken).toBeUndefined();
  });

  it('preserves admin resolution while retrying a revoked participant identity', async () => {
    saveIdentity(id, { adminToken, memberToken });
    await controller.start();
    Socket.instances[0].end(4401);
    expect(controller.resolvingIdentity).toBe(true);
    expect(controller.connection).toBe('reconnecting');
    expect(readIdentity(id)).toMatchObject({ adminToken });
    expect(readIdentity(id).memberToken).toBeUndefined();
    vi.advanceTimersByTime(500);
    Socket.instances[1].receive({
      type: 'authenticated',
      memberId: null,
      isAdmin: true,
    });
    expect(controller.resolvingIdentity).toBe(false);
    expect(controller.isAdmin).toBe(true);
  });

  it('can recover when initially offline without dropping saved admin access', async () => {
    saveIdentity(id, { adminToken });
    network.onLine = false;
    await controller.start();
    expect(controller.resolvingIdentity).toBe(true);
    expect(controller.connection).toBe('offline');
    expect(Socket.instances).toHaveLength(0);
    network.onLine = true;
    window.dispatchEvent(new Event('online'));
    Socket.instances[0].receive({
      type: 'authenticated',
      memberId: null,
      isAdmin: true,
    });
    expect(controller.resolvingIdentity).toBe(false);
    expect(controller.isAdmin).toBe(true);
  });

  it('ends resolution if the room disappears during authentication', async () => {
    saveIdentity(id, { adminToken });
    await controller.start();
    Socket.instances[0].end(4404);
    expect(controller.resolvingIdentity).toBe(false);
    expect(controller.notFound).toBe(true);
  });
});
