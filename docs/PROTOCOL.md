# Room API and realtime protocol

All API responses use JSON and `Cache-Control: no-store`. API URLs reject query parameters; bearer secrets must never be placed in URLs. HTTP bodies must be `application/json`, at most 4096 bytes. Mutating requests and WebSocket upgrades must include an allowed Origin (the request origin or an exact configured `ALLOWED_ORIGINS` entry). No wildcard origins or cookie authentication are used.

| Endpoint                             | Request                  | Authority                                             | Response                                                   |
| ------------------------------------ | ------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| `POST /api/rooms`                    | `{}`                     | None                                                  | `201 {roomId, adminToken}`; secret returned once           |
| `GET /api/rooms/:id`                 | —                        | None                                                  | Basic metadata only: id/title/deck/round/revealed/version  |
| `GET /api/rooms/:id`                 | —                        | Member or admin Bearer                                | Redacted/revealed full snapshot                            |
| `POST /api/rooms/:id/join`           | `{name}`                 | None for new identity; member Bearer to resume/rename | `{memberId, memberToken?, room}`; new secret returned once |
| `POST /api/rooms/:id/vote`           | `{vote, round}`          | Member Bearer                                         | Current full snapshot; chosen value omitted before reveal  |
| `POST /api/rooms/:id/leave`          | `{}`                     | Member Bearer                                         | `{ok:true}`; revokes membership in every tab               |
| `POST /api/rooms/:id/admin/reveal`   | `{round}`                | Admin Bearer                                          | Current snapshot                                           |
| `POST /api/rooms/:id/admin/reset`    | `{round}`                | Admin Bearer                                          | Current snapshot                                           |
| `POST /api/rooms/:id/admin/settings` | `{title, deck, version}` | Admin Bearer                                          | Current snapshot                                           |
| `DELETE /api/rooms/:id`              | `{}`                     | Admin Bearer                                          | `{ok:true}`; permanent tombstone                           |
| `GET /api/rooms/:id/ws`              | WebSocket upgrade        | Authenticate in first frame                           | Events below                                               |

Secrets and room IDs are lowercase hexadecimal: 64 characters for bearer secrets, 32 for room IDs. Errors are `{error: string}` with 400/401/403/404/409/413/414/415/426/429 as appropriate. Unknown and deleted rooms return 404; visiting them never creates state.

## Snapshots and consistency

The types live in `src/shared/protocol.ts`. A full room snapshot extends metadata with `members: {id, name, voted, connected, vote?}[]`. The `vote` property is **absent** until `revealed === true`; once revealed, it is a deck string or `null` for non-voters. Token hashes, timestamps, and raw credentials are never serialized into a snapshot. Unauthenticated metadata contains no roster or estimates, even after reveal.

All mutations are serialized within the Durable Object. Each committed mutation or presence update increments `version`. Voting requires the exact current `round`; stale/future voting and reveals fail with 409. Revealing an already-revealed round is a no-op. Resetting the current round clears all votes and increments `round`; repeating a reset for an older round returns the current snapshot without another reset. Future-round resets fail. Settings require the current `version`, preventing stale overwrites; deck changes atomically reset the round while title-only changes preserve votes.

Clients ignore snapshots with an older version and clear their local card selection on a round change. Every successful WebSocket reconnect receives an authoritative snapshot, including current settings and presence, so there is no replay or history protocol. The UI knows its own locally selected card; the server never sends anyone's choice until reveal.

## WebSockets

Connect to `/api/rooms/:id/ws` without query parameters. Within ten seconds send:

```json
{
  "type": "auth",
  "memberToken": "<optional member secret>",
  "adminToken": "<optional admin secret>"
}
```

At least one identity must verify. Roles are checked independently; a revoked member does not remove valid admin authority. Attachments hold only the verified role/member ID and handshake deadline. Sockets do not accept mutation messages. Frames are limited to 1024 UTF-8 bytes; binary frames are rejected. The room cap includes unauthenticated sockets.

Server events:

```ts
{ type: 'authenticated', memberId: string | null, isAdmin: boolean }
{ type: 'snapshot', version: number, room: RoomSnapshot }
{ type: 'room_deleted' }
{ type: 'membership_removed' }
{ type: 'error', message: string }
```

The implementation deliberately uses complete bounded snapshots in place of incremental roster/vote events. This gives every state transition the same privacy serializer and simplifies reconnects. There are at most 50 members.

The client sends `ping` every 25 seconds; the hibernation auto-response returns `pong` without waking or mutating the room. Missing heartbeats cause a reconnect with bounded exponential backoff. A storage alarm closes incomplete handshakes only, with no room expiration. Close codes: 4401 invalid/revoked member, 4403 invalid admin, 4404 deleted room, 4408 handshake timeout, 1008 disallowed action, 1009 oversized frame. Timeout/transport errors do not erase saved authority.
