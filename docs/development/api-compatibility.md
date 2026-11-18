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

1. **The app now relies on something older servers don't have.** This covers a new procedure, a new input field on a procedure whose schema rejects unknown keys (`z.strictObject`), and a new input field the app needs the server to act on. Most input schemas are loose objects, so an older server silently drops a field it doesn't know; that only looks compatible. Raise `apiCompatibilityLevel` and set `minServerApiCompatibilityLevel` to the new level.
2. **You removed or narrowed something a supported app relies on.** This covers a procedure, a required input, a tighter validation rule, or an output field the app reads. Prefer not to (see below). If you must, raise `apiCompatibilityLevel` and set `minClientApiCompatibilityLevel` to the new level.
3. **You changed an encrypted format or what a field means.** A new file in `packages/encryption/src/testVectors` is a sign of this. Raise the minimum for whichever side can't cope.

Anything else needs no change. That includes:

- a new procedure the app doesn't call yet;
- a new optional input that an older server can ignore without breaking what the app does;
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

## Error reasons

A rejection the app needs to act on carries a reason: `data.reason` on tRPC errors, or the better-auth error `code` on auth routes. The values are the `ErrorReason` union in `packages/shared/src/errorReason.ts`, and the app reads them with `errorReason(error)`. The app never matches on error messages, which are free to change.

Error reasons are API surface; never repurpose one. A new condition gets a new reason, which is an additive change. Removing a reason follows the level rules above.

## Frozen surfaces

The handshake itself can never change, or apps and servers from either side of the change couldn't talk about compatibility at all. Tests pin each of these:

- `GET /health` returns `apiCompatibilityLevel` and `minClientApiCompatibilityLevel` alongside `status`, `version` and `serverName`, plus an optional `message` and an optional `announcements` list. Self-hosters must expose `/health` as well as `/api/*`.
- Every request to `/api/*` sends `x-openbeacon-api-compatibility-level`. The server treats a missing or unreadable value as 0. The one exception is `GET /api/auth/google-deletion-callback`: a browser opens it, so it can't send the header.
- Every `/api/*` response carries `x-openbeacon-api-compatibility-level` and `x-openbeacon-min-client-api-compatibility-level`.
- An app below the minimum gets a 426 with `{ "code": "CLIENT_TOO_OLD", "minClientApiCompatibilityLevel": number, "message"?: string }`.
- `message` is optional on both. It's plain text of at most 280 characters, taken from the server's `CLIENT_UPDATE_MESSAGE`, and left out when that is unset or too long. The app shows it as plain text on any compatibility screen. There is deliberately no update link, so a self-hosted server can't send people to an APK of its choosing.
- `announcements` is left out when none are showing. Each entry follows `announcementSchema` in `packages/schemas`. The app drops any entry it can't read, such as one with a severity it doesn't know, so a new severity or platform doesn't need a level change, but changing what an existing field means does.
- A tRPC call to a procedure the server doesn't have gets a 404 with `{ "code": "UNKNOWN_PROCEDURE", "apiCompatibilityLevel": number }`. This is how the app notices a missed level change: if the levels match but a procedure is missing, it shows an "out of sync" screen with both versions.

`apps/backend/src/app.test.ts` checks these against literal strings, so renaming a constant can't quietly change them.

A server from before this handshake has no level fields on `/health`. The app treats it as level 0, so it's reported as too old, because `minServerApiCompatibilityLevel` is at least 1.

## What the app does

- **When it checks.** It checks `/health` at startup and whenever it comes back to the foreground. It also reads the level headers on every response.
- **When it blocks.** It only blocks on a clear answer. Being offline, timeouts, server errors and unexpected replies leave things as they are.
- **What it shows.** A full-screen message: "Update Open Beacon", "Your server needs updating" (or "We're updating Open Beacon" on the hosted server), or "The app and server don't match". Every screen offers "Try again" and "Use a different server". "Update" opens the Play Store listing. The server's `message`, when it sends one, is shown as plain text. The out-of-sync screen also offers "Contact us". Switching server needs a restart, and the screen says so.
- **Sticky results.** A result taken from a missing procedure (the 404 body) or a 426 body stays until the person presses "Try again" or the server's version changes. A routine `/health` check or the level headers on a later response finding the levels fine don't clear it, because a missed level change looks exactly like that. This covers out of sync and also "too old" in either direction. A result taken from the levels alone clears as soon as the levels match.
- **Saved result.** The result is saved per server URL and app level, so the screen shows straight away on the next launch, even offline.
- **Background uploads (Android).** Uploads pause while the app is blocked. Capture keeps going, so points pile up in the queue. The queue's 10 MiB limit still applies (see `offline-tracking-queue.md`), so a very long block loses the oldest points. While blocked, the background task checks `/health` at most every 5 minutes. One notification tells the person what to do. It's only counted as shown if Android actually displayed it, and it's removed once the problem clears.
- **The feedback client** sends its level but never changes the app's state, because it always talks to the hosted server.

## Level history

| Level | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Compatibility levels introduced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2     | The app lists, edits, removes and links devices (`account.listDevices`, `updateDevice`, `removeDevice`, the `device` and `deviceLink` routers). The server makes later devices Pending until they're set up. A session must be linked to a device before it can act as one; until then requests that need a device fail with `DEVICE_UNVERIFIED` and the app links it with `device.sessionChallenge` and `device.linkSession`. `accountRecovery.setup` now takes `{ escrows, recoveryKey }` instead of `{ historyKey, recoveryKey }`. Older apps can't cope with any of these, so the client minimum is 2 too. Every signed-in procedure outside the setup list needs a session linked to an Active device and otherwise fails with `DEVICE_PENDING`; the list is pinned in `packages/api/src/router/authentication.test.ts`. better-auth's `/change-password` needs the same, and `/update-user`, `/account-info`, `/get-access-token`, `/link-social`, `/refresh-token`, `/unlink-account`, `/update-session` and `/verify-password` are off. |

Level 3 adds phone and tablet variants and general identifiers to Device icons. Both minimums are 3 because older servers reject the new values and older apps cannot render them.

Level 4 adds device and account location-sharing pauses (`account.locationSharing` and `account.setLocationSharing`). Tracking point IDs carry sharing revisions, uploads acknowledge discarded points, and live responses include pause state and scan cursors. Both minimums are 4 because older servers cannot enforce pauses and older apps may retain paused pins or upload points with obsolete sharing state. Level 4 is the Beta 1 baseline. Before Beta 1 shipped it also changed without a level bump: `account.setLocationSharing` requires `requestedAt`, and tracking point v1 allows `battery.level: null` and ignores unknown keys. Development builds 1.10.0 and 1.11.0 predate both changes and are unsupported. From Beta 1 on, every change follows the rules above.

Level 5 adds invite previews (`groupInvites.sharedPreview` for join codes and `groupInvites.preview` for email invites), which the app shows before anyone joins. The server minimum is 5 because older servers don't have them. The client minimum stays 4 because older apps never call them.

Level 6 adds Places: the `groupPlaces` router (`list`, `create`, `update`, `reEncrypt` and `delete`), the `placeSharing` router (`get` and `set`), the `placeTransitions` router (`recent`), and the optional `placeTransitions` and `placeAlertsCursor` fields on `groupTracking.uploadBatch`, whose response then carries `placeTransitions`, `places` and `placeAlerts`. The server minimum is 6 because older servers don't have it. The client minimum stays 4 because older apps never call it. Level 6 covers the whole Places feature, which merges as one change with the app.

Level 7 adds group history: the `groupHistory` router (`list`, which merges group events with place arrivals and departures, and `latest`, which the app uses for its unread dot). The server minimum is 7 because older servers don't have it. Join alerts are gone: `groupInvites.joinAlerts` answers with an empty list and `groupInvites.dismissJoinAlert` does nothing. The client minimum is 7 because older apps rely on join alerts. The hosted server must wait until the level-7 app is available to users before enforcing that minimum.

Level 8 adds `account.viewers`, which the app's Who can see me screen calls. The server minimum is 8 because older servers don't have it. The client minimum stays 7 because older apps never call it.

Level 9 encrypts profile and group pictures end to end. The app encrypts each picture on the phone and wraps its key under the group's latest epoch, so the server stores only the encrypted file and the wrapped keys. Uploads now take three steps: `account.requestProfileImageUpload` and `groupSettings.requestGroupImageUpload` take no picture details and return the file name, the app encrypts the picture with that name bound in, and the new `account.presignProfileImageUpload` and `groupSettings.presignGroupImageUpload` return the upload URL. Presigning pins the upload to the first content hash and size it is given. `account.confirmProfileImageUpload` requires a key for each group (`wraps`) and takes an optional sealed copy for the person's own phones (`sealed`). `groupSettings.confirmGroupImageUpload` requires the group picture `key` and takes an optional `expectedFileName`, which refuses the change with `IMAGE_CHANGED` if the group's picture is no longer that one. The new `groupImageKeys` router has `store`, which adds a person's key to a group they've joined, and `reEncrypt`, which moves keys onto a newer epoch; both refuse a picture that changed with `IMAGE_CHANGED`. `groupMembership.list` returns `imageKey` for each group and member, the session user carries `imageKeySealed`, and `groupTracking.uploadBatch` can return `imageKeysNeedCatchUp`. Invite previews no longer include pictures. The server minimum is 9 because older servers don't have the new procedures and store pictures the app can't read. The client minimum is 9 because older apps use the old upload steps, which no longer work, and can't decrypt the new pictures. The migration clears every picture stored before level 9.

Level 10 replaces tracking point v1, which was JSON, with tracking point v2: 23 bytes holding the position, time, accuracy, speed, battery, a stay flag and how long the stay lasted (`packages/encryption/src/trackingPoint.ts`, `TrackingPointCodec.kt`). The client minimum is 10 because older apps can't read v2 points. The server minimum is 10 because the app doesn't read v1 points, so it can't show the points an older server holds. Level 10 also covers the point storage changes in OPE-310, which merge with it: uploads carry a `role` (`POINT`, `STAY` or `LIVE`) and an 8-byte point ID instead of `kind` and `algorithm`, and `getLatest` and `poll` read one latest point per device with an `updatedAt` cursor, so neither side can talk to a level 9 build. The migration drops `GroupEncryptedPayload`, so a server updating to level 10 loses all stored history and live-map points, and an app updating to it deletes the points still queued on the phone. A level 10 server only accepts point ciphertexts of exactly 52 base64 characters, and returns history points over each device's daily allowance in `discarded`.

Level 11 adds notification settings, phone notices and push wake-ups (OPE-140):

- The `notificationSettings` router: `get` returns every message type with its Email and Phone values and whether the server can send email, and `set` changes one switch. The app's Account › Notifications screen calls it. `emailAlerts.settings` and `emailAlerts.updateSettings` still work for older apps, now reading and writing the new settings. A level 11 server stops returning place alerts to an account that switched them off.
- Group activity on phones: `groupTracking.uploadBatch` takes an optional `noticesCursor`, and its response then carries `notices`: the joins, leaves, removals, deleted accounts and role changes in the caller's groups, filtered by the caller's Phone switches when they are read. Older apps never send it.
- Account notices and push tokens: the `accountNotices.sync` mutation needs a signed-in Active device but no group. It takes `cursor` (null on a phone's first call, which returns no notices and a cursor that starts 15 seconds earlier, so notices older than that are never returned to that phone) and an optional `pushToken` (a string to store this device's Firebase token, or null to clear it), and returns `notices` (the account's security notices from other devices, created since this session signed in), the next `cursor` and `pushAvailable`, which says whether the server sends push wake-ups. Account notices follow the account's Phone switches when they are created, not when they are read, and the alerts-turned-off notice can't be switched off. A server only stores a token when push is on.

The server minimum is 11 because the app calls `notificationSettings` and `accountNotices.sync`, which older servers don't have. The client minimum stays 10 because older apps never call them.

Level 12 adds sign-in codes (OPE-188):

- The `signInCodes` router: `status` returns `on` and `canTurnOn` (a password account on a server with email). `requestTurnOnCode`, `turnOn` (with the emailed code) and `turnOff` need a recent sign-in.
- `/sign-in/email` answers 403 with code `SIGN_IN_CODE_REQUIRED` and `codeSent` when the password is right and the account has codes on, and emails a code when `codeSent` is true. The app then sends the same email and password to `/sign-in/email` again with the code in the `x-openbeacon-sign-in-code` header. A wrong, expired or used-up code answers 400 with code `INVALID_CODE` and sends no new code. There is no separate endpoint for checking a sign-in code, so a code is only checked after the right password. `/email-code/verify-password-reset-code` also returns `signInToken` when codes are on, and sending it in the `x-openbeacon-sign-in-token` header on the next `/sign-in/email` skips the code once. A request from a session linked to an Active device of the same account needs no code. With email off, the account's password sign-in fails with `SIGN_IN_CODES_UNAVAILABLE`.

- `accountNotices.sync` can return two new types, `SIGN_IN_CODES_TURNED_ON` and `SIGN_IN_CODES_TURNED_OFF`.

The server minimum is 12 because the app calls `signInCodes`, which older servers don't have. The client minimum is 12 because older apps can't enter a sign-in code and don't know the new account notice types, so this is a mandatory update.

Level 13 adds location history reads for Timeline (OPE-312), and files each point under the UTC hour it was recorded in. An upload's points may carry `capturedHour`, whole hours since 1970. The server clamps it to between 336 hours before and 1 hour after the hour it arrived, and uses the arrival hour when it's missing, so apps on level 12 and points queued before the update keep uploading. Timeline counts such a point as undecryptable when it was recorded in an earlier hour than it arrived, until those phones update and their queues empty. Older servers ignore the field. `groupTracking.historyDays` returns each device's point count per recorded hour and its first recorded hour, for points that arrived inside the 14-day window. `groupTracking.historyRange` takes recorded-hour bounds `fromHour` and `toHour` (at most 26 hours apart, `toHour` excluded), an optional keyset `cursor` of `(capturedHour, streamId, pointId)` and `limit`, and returns the streams involved and their points with their `capturedHour`; the first page also returns up to 100 points per device from its last recorded hour before `fromHour` inside the window (`lookback`). The app counts a point whose decrypted time isn't in its `capturedHour` as undecryptable. Both read the whole group from the caller's join epoch, keep points from older sharing revisions, and leave out people who aren't members and devices that aren't Active. Level 13 also lets each person choose how much history their groups see (`HistoryShare`: `LAST_LOCATION`, `HOURS_6`, `DAY_1`, `WEEK_1`, `MAXIMUM`). `account.setHistoryShare` sets the account-wide setting and `groupSettings.setHistoryShare` sets or clears (null) the caller's own choice for one group; both delete the caller's stored points recorded before the new window in the groups it applies to. `account.locationSharing` returns `historyShare` with the account setting, when it last changed and each group's override, for account sync. `groupInvites.accept` and `groupInvites.acceptShared` take an optional `historyShare` for the new membership. Both history reads keep each sender's points to recorded hours at or after `nowHour − windowHours + 1` (none for `LAST_LOCATION`), and `historyDays` returns `senders` with each member's effective setting and that first hour (null for `MAXIMUM`). Uploads discard history points and stays recorded before the sender's window, and all of them for `LAST_LOCATION`, as `discarded`; live-only points still update the map. Older apps never send the new fields and keep the default of `MAXIMUM` unless the person changes it on an updated phone. The server minimum is 13 because older servers don't have them. The client minimum stays 12 because older apps never call them.
