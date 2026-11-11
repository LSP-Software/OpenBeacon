# API compatibility

The app and the server can be on different versions. Self-hosters update their server when they choose, and people update the app when they choose. The API compatibility level lets each side tell when the other is too old, so the app can show a clear screen instead of failing in confusing ways.

## The three numbers

They live in `packages/shared/src/apiCompatibilityLevel.ts`. The app and the server each build their own copy, so a phone and a server built from different commits each know their own numbers.

- `apiCompatibilityLevel` goes up by 1 when a change breaks compatibility in either direction.
- `minClientApiCompatibilityLevel` is the oldest app this server serves.
- `minServerApiCompatibilityLevel` is the oldest server this app works with.

The app is too old when its `apiCompatibilityLevel` is below the server's `minClientApiCompatibilityLevel`. The server is too old when its `apiCompatibilityLevel` is below the app's `minServerApiCompatibilityLevel`. Both minimums are always at most `apiCompatibilityLevel`, so both can't be true at once.

Every app talks to other apps through the server, so the client minimum also covers changes between apps. If a new encrypted format can't be read by older apps, raising `minClientApiCompatibilityLevel` makes everyone in the family update.

## When to change a level

Change a level only if one of these is true:

1. **The app now calls something on the server that older servers don't have.** This covers a new procedure, or a new input field on a procedure whose schema rejects unknown keys (`z.strictObject`). Raise `apiCompatibilityLevel` and set `minServerApiCompatibilityLevel` to the new level.
2. **You removed or narrowed something a supported app relies on.** This covers a procedure, a required input, a tighter validation rule, or an output field the app reads. Prefer not to (see below). If you must, raise `apiCompatibilityLevel` and set `minClientApiCompatibilityLevel` to the new level.
3. **You changed an encrypted format or what a field means.** A new file in `packages/encryption/src/testVectors` is a sign of this. Raise the minimum for whichever side can't cope.

Anything else needs no change. That includes:

- a new procedure the app doesn't call yet;
- a new optional input;
- a new output field;
- looser validation;
- refactors and performance work;
- database migrations that keep the API the same.

`scripts/check-version-bump.ts` checks that:

- levels never go down;
- `apiCompatibilityLevel` goes up by at most 1;
- neither minimum is above `apiCompatibilityLevel`;
- any level change comes with at least a minor bump of both the app and the server.

It can't tell whether a change needed a new level. That's up to whoever makes the branch, and reviewers check it.

Every PR body has a line saying either `API compatibility: unchanged` or `API compatibility: raised because …`.

## Prefer additive changes

Most changes shouldn't need a new level:

- Keep old procedures and fields working, and add new ones alongside them.
- Retire old API in its own PR, once we decide to stop supporting the apps that use it. Check git history for the newest app that still called it. Only remove it once `minClientApiCompatibilityLevel` is above that app's level.
- For the hosted server, deploy the server before releasing an app that raises `minServerApiCompatibilityLevel`.
- Raising `minClientApiCompatibilityLevel` on the hosted server locks out everyone on an older app until they update. Leave time for store updates to reach people first.

## Frozen surfaces

The handshake itself can never change, or apps and servers from either side of the change couldn't talk about compatibility at all. Tests pin each of these:

- `GET /health` returns `apiCompatibilityLevel` and `minClientApiCompatibilityLevel` alongside `status`, `version` and `serverName`. Self-hosters must expose `/health` as well as `/api/*`.
- Every request to `/api/*` sends `x-openbeacon-api-compatibility-level`. The server treats a missing or unreadable value as 0. The one exception is `GET /api/auth/google-deletion-callback`: a browser opens it, so it can't send the header.
- Every `/api/*` response carries `x-openbeacon-api-compatibility-level` and `x-openbeacon-min-client-api-compatibility-level`.
- An app below the minimum gets a 426 with `{ "code": "CLIENT_TOO_OLD", "minClientApiCompatibilityLevel": number }`.
- A tRPC call to a procedure the server doesn't have gets a 404 with `{ "code": "UNKNOWN_PROCEDURE", "apiCompatibilityLevel": number }`. This is how the app notices a missed level change: if the levels match but a procedure is missing, it shows an "out of sync" screen with both versions.

`apps/backend/src/app.test.ts` checks these against literal strings, so renaming a constant can't quietly change them.

A server from before this handshake has no level fields on `/health`. The app treats it as level 0, so it's reported as too old, because `minServerApiCompatibilityLevel` is at least 1.

## What the app does

- **When it checks.** It checks `/health` at startup and whenever it comes back to the foreground. It also reads the level headers on every response.
- **When it blocks.** It only blocks on a clear answer. Being offline, timeouts, server errors and unexpected replies leave things as they are.
- **What it shows.** A full-screen message: "Update Open Beacon", "Your server needs updating" (or "We're updating Open Beacon" on the hosted server), or "The app and server don't match". Every screen offers "Try again" and "Use a different server". The out-of-sync screen also offers "Contact us". Switching server needs a restart, and the screen says so.
- **Out of sync.** This state stays until the person presses "Try again" or the server's version changes. A routine check finding matching levels doesn't clear it, because the levels matching is exactly what out of sync means.
- **Saved result.** The result is saved per server URL and app level, so the screen shows straight away on the next launch, even offline.
- **Background uploads (Android).** Uploads pause while the app is blocked. Capture keeps going, so points pile up in the queue. The queue's 10 MiB limit still applies (see `offline-tracking-queue.md`), so a very long block loses the oldest points. While blocked, the background task checks `/health` at most every 5 minutes. One notification tells the person what to do. It's only counted as shown if Android actually displayed it, and it's removed once the problem clears.
- **The feedback client** sends its level but never changes the app's state, because it always talks to the hosted server.

## Level history

| Level | Change                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Compatibility levels introduced.                                                                                                                                      |
| 2     | The app lists and edits devices (`account.listDevices`, `updateDevice`). The server makes later devices Pending until they're set up, so the client minimum is 2 too. |
