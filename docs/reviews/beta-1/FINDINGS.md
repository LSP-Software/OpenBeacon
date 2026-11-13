# Beta 1 code review: findings

Commit `94a73b27` (main), reviewed 13 Nov 2026. No source code was changed.

## Decisions

Settled with the owner on 13 Nov 2026, against `94a73b27` (main had not moved).

**Context: nothing has shipped.** No app or server build has gone outside development, and there is no live hosted database yet. Pre-beta builds (app ≤ 1.11.x) are treated as unsupported. No migration or compatibility path is needed for them.

### Q1 (M8) Tracking point v1: tolerant reader plus a nullable battery level

- **Decision:**
  - The v1 reader ignores unknown keys at the top level and inside `battery`. It returns a new object holding only the known keys.
  - `battery.level` becomes `number | null`. Kotlin sends `null` when `BatteryReader` reports `levelKnown = false`.
  - `accuracy` is not added now.
  - The encoders (TS and Kotlin) stay strict. Add the Kotlin non-finite guard from S10-08: write `null` for a non-finite speed, and drop a fix whose coordinates are non-finite.
- **Reason:** Changing an existing field's type is the only payload change that can't be made after beta builds ship. With a tolerant reader, `accuracy` and other new fields can be added later as optional keys, and older apps simply ignore them. Measured today: 149–177 bytes of plaintext JSON, so 220–260 base64 characters of ciphertext.
- **Compatibility:**
  - The encrypted format is widened. The only apps that can't read a `null` level are unshipped pre-beta builds, so no level change is needed.
  - App minor bump. No server change.
  - New test vectors: an extra unknown key, and a `null` level. Kotlin JVM tests read both.
- **Follow-up:**
  - Update the "locked plaintext schema" test in `trackingPoint.test.ts` so it asserts that extra keys are dropped.
  - The battery UI must render an unknown level, for example by hiding the percentage.

### Q2 (M6) Upload limits: a budget per group membership, with a 16-group cap

- **Decision:**
  - **Ciphertext:** `groupTrackingPointSchema.ciphertext` max lowered from 4096 to 1024.
  - **Per-minute limit:** a cost-based limit of 2,000 points per minute per user (`cost = points.length`), checked inside `uploadBatch` the way `groupInvites.send` checks its limit. The existing 240 requests/min per user stays.
  - **Daily budget:** accepted (non-duplicate) points per account per 24 h, at most `9,504 + 8,640 × G`, where G is the number of groups the user belongs to. 8,640 is one phone moving all day at the 10 s capture interval, and 9,504 is 110 % of that.
    - 16 groups: 147,744 points a day.
    - 3 groups: 35,424 points a day.
  - **Group cap:** a user can belong to at most 16 groups, owned or joined. Creating a group, accepting an invite or redeeming a join code past the cap fails with a clear message.
  - **Over the limit:** the server returns `TOO_MANY_REQUESTS`. The phone keeps the points and retries with its existing backoff. Users don't see the budget being hit. The server logs it with the user ID, and the scheduled jobs report the accounts with the most daily row growth, for the operator.
- **Reason:** These are the only per-account limits that stop one account filling the hosted disk, and they don't penalise real use. The cap stops someone raising their budget by creating solo groups.
- **Measured:**
  - Worst-case ciphertext today is 260 characters.
  - Phones queue 6 points a minute per group while moving, 3 a minute moving in battery saver, and about 0.2–2 a minute while still.
  - A full 10 MiB offline queue holds about 16,800 group-points and drains in about 9 minutes at 2,000 a minute.
  - A real stored row takes about 1.4 KB including its six indexes, or about 2.4 KB padded to 1024 characters.
  - Ceiling per account over 60 days of retention: 16 groups, about 12.4 GB real-size or about 21 GB padded; 3 groups, about 3.0 GB real-size or about 5.1 GB padded.
  - A typical member uploads about 670 points per group per day.
- **Compatibility:**
  - The tighter validation and the new 429 and cap rejections affect only unshipped builds, so no level change.
  - Server minor bump (a new limit). App patch for the cap message.
- **Follow-up:**
  - **Future tiers:** free accounts will later be capped at 3 groups and paid accounts at 16. Keep the cap as a single per-account value, not a constant spread across the code.
  - **Cap rejection reason:** give the cap rejection a machine-readable reason. Use X-02 `ErrorReason` if it lands first, otherwise a `cause` like the device causes.
  - **Budget counter:** keep the daily budget counter in Redis (`rateLimits.consume` with a 24 h window). It follows Q5's failure rule for general limits.

### Q3 (M3) Server identity: scope credentials by server, wipe on change, and build the full `endSession(reason)`

- **Decision:**
  - Scope the better-auth credentials by server origin: `storagePrefix: openbeacon_<serverKey>`, where `serverKey` is a short hash of the normalised server base URL (origin plus any path prefix; see E2). Store the revoke token as `[origin, token]`, and drop it on a mismatch.
  - A server change runs `endSession({ reason: "serverChanged" })` before saving the new URL. It makes a best-effort sign-out against the old server, then wipes that server's state: queued points, pending sharing changes and the compatibility state.
  - Build the full `endSession(reason)` from X-01 before beta, with the reasons `signedOut | phoneRemoved | accountDeleted | serverChanged | sessionLost`.
    - One table says what each reason clears, and a table-driven test pins it.
    - Sign-out, `wipeThisPhone`, the delete-account screen, session loss and the server change all call it.
    - `sessionLost` keeps the keys but records `{ userId, lostAt }`. The previous user's key material is wiped after 30 days with no sign-in, or when a different account signs in. This covers I5.
- **Reason:** Scoping makes it structurally impossible for a cookie to reach another server, even if a cleanup path forgets a row. One owner for ending a session closes M3, S8-06, S6-10 and I5 together, instead of adding a sixth partial path. Nothing has shipped, so changing the key names needs no migration.
- **Compatibility:**
  - App only. No level change, no encrypted-format change and no migration.
  - App patch bump. It can share a bump with M9, which touches the same `currentServer` code.
- **Follow-up:**
  - M9's URL normaliser feeds `serverKey`. Build them together as refactor shortlist item 1.
  - Replace the "Your current session will remain active" copy.
  - Give the credentials `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, through the one shared `getSecureStoreOptions` (S1-10).

### Q4 (M7) Accounts with both password and Google: nothing to clean up

- **Decision:** No data clean-up. There is no live hosted database, so no account can hold both a password and Google. Fix the cause only: set `accountLinking: { enabled: false }`, map the `OAUTH_LINK_ERROR` in the app, and add the integration test.
- **Reason:** Beta 1 launches on a fresh hosted database, so the bug just needs to be closed before launch.
- **Compatibility:** As in M7: server patch, plus an app patch for the message. No level change.
- **Follow-up:** None. The pre-beta hosted-DB query in M7 is dropped.

### Q5 (M5) Redis failure mode, per caller

- **Decision:** Once the self-healing client and its per-command timeout are in place, each caller handles a Redis error like this:

  | Caller                                                | On a Redis error                                                    |
  | ----------------------------------------------------- | ------------------------------------------------------------------- |
  | General per-procedure limit (`rateLimitMiddleware`)   | Open, with a log line                                               |
  | `uploadBatch` points per minute and daily budget (Q2) | Open, with a log line                                               |
  | `groupInvites.send` recipient cost limit              | Open, with a log line                                               |
  | Email-code request limit per address                  | Closed: "try again in a minute"                                     |
  | Email-code wrong-guess limit                          | Closed (already returns `invalid`)                                  |
  | Password-failure limit per account (Q7)               | Closed: "try again shortly"                                         |
  | Email sender cap (20 an hour per user)                | Optional alerts are skipped. Required mail, such as codes, is sent. |
  | `alertsTurnedOff` batching                            | The alert is sent straight away, unbatched                          |
  | pmtiles signed-URL cache                              | Bypassed; a fresh URL is signed                                     |
  | `/health`                                             | Unaffected. A Redis ping goes into a separate readiness check.      |

- **Reason:** Limits that guard secrets or send mail stay safe during an outage. Everything else keeps working, so an outage blocks only email codes and password sign-in. Google sign-in, existing sessions, uploads and the map carry on.
- **Compatibility:** Server only. No level change. Server patch.
- **Follow-up:**
  - Give each caller a test for its outage behaviour, alongside the integration test that restarts Redis (M5).
  - Share one client per process (D6), so the policy is set in one place.

### Q6 (M10) Deletion race: no "deleting" mark

- **Decision:** Don't add a "deleting" state.
  - The batched delete of the account's `GroupEncryptedPayload` rows runs only after re-checking, under the User row lock, that the account is due.
  - The final locking transaction then runs with an explicit `timeout` and a `deleteMany` for stragglers.
  - Add a test proving that a sign-in during the batches is refused.
- **Reason:** A sign-in cancels a deletion only before `deletionDate`. After that date, `session.create.after` deletes the new session and refuses it, under the same User row lock. The job only touches accounts that are past their date, and "delete now" sets the date to now. So once batching starts, nothing can cancel it. The race described in M10 and V3 can't happen.
- **Compatibility:** Server only. No migration and no level change. Server patch.
- **Follow-up:** If the expiry rule in `session.create.after` ever changes, revisit this decision. The new test pins the current rule.

### Q7 (D25, S2-04) Remove every IP-based limit before beta, after adding a per-account password limit

- **Decision:**
  1. Add a per-account password-failure limit on `/sign-in/email` and `/change-password`, keyed on the normalised email, in the shared Redis `rateLimits`. Allow 10 failures in 15 minutes, then refuse with "Too many attempts. Try again in 15 minutes."
  2. Then remove every IP-based limit:
     - set better-auth's `rateLimit: { enabled: false }`;
     - remove `EMAIL_CODE_IP_LIMIT` and `emailCodeRequestLimits.perIp`;
     - remove the `ipLimit` on invite redeem and feedback, and the `ipLimit` option itself;
     - remove the middleware's anonymous fallback to IP.
  3. Give `feedback.submit` one server-wide limit, for example 30 every 10 minutes. `auth.providers` gets no limit.
- **Reason:** The owner's rule is no IP-based limits, because shared IPs (carrier NAT, offices, families) block real people. The per-account limit has to exist first, or password guessing has no throttle at all. A hard lockout of an account is accepted, as it was in OPE-259.
- **Compatibility:**
  - Server only, apart from app copy for the lockout message. No level change.
  - Server patch. App patch only if the lockout message needs mapping.
- **Follow-up:**
  - Remove `EMAIL_CODE_IP_LIMIT` from the env schema, `.env.example` and the docs.
  - Rule 14 is unaffected.

### Q8 (M11) Update screen: Play Store link plus an optional server message, with no `updateUrl`

- **Decision:**
  - The Update button opens `market://details?id=net.openbeacon.app`, and falls back to `https://play.google.com/store/apps/details?id=net.openbeacon.app`.
  - The server adds an optional `message` to `/health` and to the 426 `CLIENT_TOO_OLD` body. It is plain text, at most 280 characters, and comes from a new optional env var, `CLIENT_UPDATE_MESSAGE`. When it is unset, the field is omitted.
  - The app shows the message as plain text, with no links rendered, on any compatibility screen when it is present.
  - On the hosted server the owner sets the message at deploy. Self-hosters set their own.
  - There is no server-supplied `updateUrl`.
- **Reason:** Android through Play is the only Beta 1 channel. The app must be able to read the message from the first beta build, or it can never show one. A server-chosen `updateUrl` would let a hostile self-hosted server send people to an APK of its choosing. The gate appears only on a level mismatch, so the message is for update instructions, not outage notices.
- **Compatibility:**
  - Additive optional fields on frozen surfaces, so no level change.
  - App patch and server patch.
  - Update the frozen-shape tests in `apps/backend/src/app.test.ts` and the "Frozen surfaces" section of `docs/development/api-compatibility.md`, saying that `message` is optional.
- **Follow-up:**
  - Add `CLIENT_UPDATE_MESSAGE` to the backend env schema, `.env.example` and the self-hosting docs.
  - Treat a message that is too long or not a string as absent, and don't block on it.

### Q9 (S6-02) iOS: block iOS builds

- **Decision:**
  - Remove `"ios"` from `platforms` in `apps/mobile/app.json`.
  - Drop the iOS background-location config (`UIBackgroundModes` location, `isIosBackgroundLocationEnabled`) until there is an iOS capture implementation.
  - Say that Beta 1 is Android only in the beta docs, as part of C8.
- **Reason:** Beta 1 is Android only. An iOS build would show "Sharing enabled" while never capturing, which is the worst failure for a family-safety app. Blocking the builds is cheaper than building a "not yet" state nobody will see.
- **Compatibility:** App only. No level change. App patch.
- **Follow-up:** S6-02 becomes a must-fix for the first iOS release: the gated UI, or real capture.

### Q10 Pre-beta refactors: shortlist items 1–4, plus a minimal error vocabulary

- **Decision:**
  - Do refactor shortlist items 1–4 before beta, as the way to fix the items they carry:
    1. `endSession` and `currentServer`: Q3, M3, M9.
    2. Outbound client timeouts: C1.
    3. One self-healing Redis client per process: M5, Q5.
    4. Phased account deletion with a shared batched-delete helper: M10, also used by group leave and history cleanup.
  - Add a minimal X-02:
    - a shared `ErrorReason` string union in `packages/shared`;
    - on the server, a typed `cause` that the error formatter sends as `data.reason`;
    - in the app, one `errorReason(error)` helper.
  - Use it for the new rejections: `GROUP_LIMIT_REACHED` (Q2) and the upload limits. Also use it for the uploader's permanent-versus-re-key split (`DEVICE_NOT_REGISTERED`, `NOT_GROUP_MEMBER`, `GROUP_GONE`), which replaces the English match at `tracking.ts:625`.
  - The password lockout (Q7) is a better-auth route, so it uses the same reason string as the better-auth error `code` (`TOO_MANY_PASSWORD_ATTEMPTS`).
  - Moving the other five app classifiers, and the ErrorState/EmptyState components (D11), wait until after beta.
- **Reason:** Items 1–4 are the cheapest safe way to do must-fix work that is already decided. The reasons have to exist in beta builds for the new rejections to be told apart, and for S6-03/S6-06 to be fixed later without matching more English text.
- **Compatibility:**
  - `data.reason` is an additive output field, so no level change.
  - Add "error reasons are API surface; never repurpose one" to `docs/development/api-compatibility.md`.
  - The app and server bumps come from the items it ships with.
- **Follow-up:**
  - After beta, move the remaining classifiers onto `errorReason`.
  - Then fix S6-03 and S6-06 (D22, I1) using the reasons.

### Q11 (S10-01) `requestedAt` narrowing: record it in the doc, and don't raise the level

- **Decision:** Leave the levels at 4/4/4. Add to the level-history row for level 4 that it is the Beta 1 baseline:
  - `setLocationSharing` requires `requestedAt`;
  - tracking point v1 allows `battery.level: null` (Q1);
  - the dev builds 1.10.0 and 1.11.0 predate both changes and are unsupported.
- **Reason:** Nothing has shipped, so no supported app relies on the old shape. A bump would only change what stray development APKs show. Beta 1 starts from a clean baseline.
- **Compatibility:** No level change. Doc only, so no version bump is needed for this item on its own.
- **Follow-up:** S10-05 (a procedure and test-vector snapshot in CI) closes the process gap that let the narrowing slip through. From beta onwards, rule 14 applies in full.

### E1 (M2, raised in this session) The last member to leave deletes the group

- **Status:** fixed on `fix/beta-1-review` by "Delete the group when its last member leaves" (SHA added at wrap-up). Integration test in `groupDeparture.integration.test.ts`: the last member's leave deletes the group and its epochs. The delete body moved into a shared `deleteGroup` helper.

- **Decision:** If a self-leave empties the group, the server deletes the group in the same transaction, the way `delete` does (images queued for cleanup). It does not leave behind an empty group flagged for rotation.
- **Reason:** The app already calls `delete` with `onlyIfLastMember` in this case. The server should still handle older or unusual clients, because nobody would be left to rotate the epoch.
- **Compatibility:** Server only. No level change. It is part of the M2 server patch.
- **Follow-up:** Add a test to `groupDeparture.integration.test.ts`.

### E2 (M9, raised in this session) Support server URLs with a path prefix

- **Decision:**
  - The normaliser accepts `http(s)://host[:port][/path]`. It strips trailing slashes, and rejects a query, a fragment or credentials.
  - Every URL is built from the normalised base: better-auth gets an explicit `${base}/api/auth`, tRPC uses `${base}/api/trpc`, and `/health` is `${base}/health`.
  - The values already saved are normalised when read.
- **Reason:** Self-hosters often serve apps under a path on a shared domain behind a reverse proxy. Q3's `currentServer` module builds every URL anyway, so supporting a path costs little.
- **Compatibility:** App only. No level change. App patch.
- **Follow-up:**
  - Test against a reverse proxy that serves the backend under a path, covering sign-in, tRPC, `/health` and the compatibility gate.
  - Document in the self-hosting guide that `BETTER_AUTH_URL` must include the path.
  - Make sure the server's own absolute URLs (the Google deletion callback, email links) honour it.

### E3 (C6, raised in this session) Android 7: pass epoch milliseconds, and raise minSdk to 26

- **Decision:**
  - Pass `location.time` (epoch ms) into `onFix`, which removes the `java.time.Instant` round trip.
  - Raise `minSdk` to 26.
  - The beta docs say Android 8 or later.
- **Reason:** It fixes the crash at its source and matches the research note's test targets. Android 7 phones date from 2016 and get no security updates.
- **Compatibility:** App only. No level change. App patch.
- **Follow-up:** Set `minSdkVersion` through `expo-build-properties` (or the equivalent config), and check the built APK's manifest.

## Summary

- **140 findings**: 0 critical, 6 high, 46 medium, 88 low.
- **Must fix before beta: 11 items** (M1–M11). They cover 13 findings: all 6 highs and 7 mediums.
- **Cheap wins: 12 items** (C1–C12). They don't block beta, but they are small and some get harder once beta builds are installed.
- **Post-beta**: everything else, grouped into 27 duplicate groups and a ranked refactor shortlist.
- No section needs a rewrite. The weak spots are the same few concepts built separately in each feature: ending a session on the phone, error identity, timeouts on outbound calls, and loading/error/empty states. See "Cross-cutting themes".

### How the review ran

1. **Tooling first** (`tooling/`):
   - `bun run ci` passes.
   - The 317 integration tests pass against Postgres and Redis.
   - `bun audit` (all levels), `bun outdated -r` and knip were run, and every knip item was checked by hand.
2. **Ten section reviews**, S1–S10, each covering every file in its scope (`raw/S*.md`).
3. **A cross-cutting pass**, X, at higher effort (`raw/X.md`).
4. **Independent verification.** A second agent checked every high finding, every finding proposed as must-fix and the three crypto-integrity findings (`raw/V1.md`–`raw/V6.md`). Verifiers reproduced most of them with throwaway tests. They upgraded one finding, downgraded six, and rejected none.

Severity and launch rules are in `PLAN.md`. Every finding below has file:line, category, severity, failure scenario and suggested fix. The evidence behind each one (scripts, temp tests, measurements) is in its raw file.

### Versioning impact of the must-fix list

With the decisions above, none of the must-fix items needs an API compatibility level change. Nothing has shipped, and level 4 is recorded as the Beta 1 baseline (Q11).

- M2, M6 and M7 change server behaviour only. M7 also needs an app message.
- M8 relaxes the reader and widens `battery.level` to nullable (Q1). Only unshipped builds can't read the new value.
- M6 narrows `ciphertext` validation and adds limits and a group cap (Q2). Only unshipped builds are affected.
- M11 and Q10 add optional fields (`message`, `data.reason`).

Each item still needs the normal patch or minor bump of the app, the server or both (AGENTS.md rule 13):

- Q1 (M8) is an app minor bump.
- Q2 (M6) is a server minor bump.

Every PR body says `API compatibility: unchanged`.

---

## Must fix before beta

### M1. A stolen phone's session survives "Remove device" and can activate a new phone without the password

- **Status:** fixed on `fix/beta-1-review` by "Stop a session moving to a new phone and require a fresh sign-in to activate" (SHA added at wrap-up).

- Finding: S2-01 · security · **high** · verified (V1, reproduced in an integration test)
- Location: packages/api/src/lib/groupEpochs.ts:634-639 (`upsertUserDevice` moves the session link); packages/api/src/lib/removeDevice.ts:61-69 (only signs out sessions linked to the removed device or to none); packages/api/src/router/deviceRouter.ts:103-182 (`activationChallenge`/`activate` need no fresh sign-in)
- Failure scenario: An attacker extracts a stolen phone's session cookie and History private key. This needs a rooted or forensically read phone, because both are in SecureStore.
  1. From that session, the attacker registers a new device ID. The session's link moves to the new Pending device.
  2. The owner removes the stolen phone. The session survives, because it now points at the Pending device.
  3. The attacker answers the History-key challenge and activates the new device with no password, fresh sign-in or email code.
  4. Family phones wrap the next epoch keys to the new device, and the attacker sees live locations again.

  The only signals are a Pending row in Account › Devices, the new-sign-in banner and the optional email.

- Suggested fix:
  - In `upsertUserDevice`, refuse to move a session that is already linked to another non-revoked device (FORBIDDEN, "Sign in again"), matching `findDeviceToLink`. No normal app flow does this.
  - Add `requireFreshSession` to `device.activationChallenge` and `device.activate`.
  - Make the app treat the new error as "sign in again".
  - Add the reproduction as an integration test.
- Compatibility: server patch. No level change.

### M2. A member who leaves a group mints, and keeps, the group key used after they leave; new members can read pre-join rows

- **Status:** fixed on `fix/beta-1-review` by "Stop a leaver choosing the next group key and hide pre-join rows from new members" (SHA added at wrap-up). Integration tests in `groupDeparture.integration.test.ts` (leaver's epoch not stored, rotation flagged; later joiner sees no pre-join rows from `poll` or `getLatest`) and unit tests in `groupTracking.test.ts`.

- Findings: S3-01 · security · **high** · verified (V2, reproduced). S3-02 (read half) · security · medium · verified (V2).
- Location: packages/api/src/router/group/groupMembershipRouter.ts:212-308 (self-removal persists the leaver's `nextEpoch`); apps/mobile/lib/groupEncryption.ts:135-159; packages/api/src/lib/groupTracking.ts:233-283 (`poll`) and :285-324 (`getLatest`) filter only by group and cursor.
- Failure scenario:
  - **Leaver keeps the key.** The leaving phone builds the next epoch and so keeps its key. With a modified client, a hostile leaver (an estranged partner, say) keeps it and can read everything the group shares until the next epoch change. They can get the ciphertext by being re-invited, through a database leak, or as the hosted operator. This breaks the privacy draft's promise (line 128) that a removed member gets no future keys.
  - **New members see the past.** `poll` from a null cursor gives any new or re-admitted member up to 60 days of earlier rows: sender, device, time and count. A re-admitted member can decrypt the old-epoch ones.
- Suggested fix (server only):
  - On self-leave, ignore `nextEpoch`, delete the membership and set `epochRotationRequired = true`. Device removal, activation and account deletion already work this way. Remaining phones rotate through `rotationContext`/`rotate` within about 1–2 minutes, prompted by the `keyState` hash.
  - Keep the input schema so older apps still work.
  - If the leave empties the group, delete the group in the same transaction, the way `delete` does (decision E1).
  - In `poll` and `getLatest`, return only rows whose `GroupEpoch.epochNumber >= ctx.groupMember.joinedEpochNumber`. In `getLatest`, put the filter inside the LATERAL subquery. Clamp a null cursor to the join epoch's `createdAt`.
  - Leave the upload half of S3-02 (old-epoch uploads accepted) alone. It is a documented owner decision (privacy draft lines 128 and 137).
  - Update `groupDeparture.integration.test.ts` and add tests for both halves.
- Compatibility: server patch. No level change.

### M3. Switching server sends the old server's session cookie to the new server

- Finding: S8-01 · security · **high** · verified (V1; worse than reported)
- Location: apps/mobile/lib/auth-client.ts:9 and :47-51 (one fixed cookie key, not tied to a server); apps/mobile/lib/api.ts:101-104; apps/mobile/lib/auth.ts:79-92 (revoke token); apps/mobile/app/serverUrl.tsx:43-52 and :123-124 ("Your current session will remain active"); apps/mobile/components/ApiCompatibilityGate.tsx:150-154 ("Use a different server")
- Failure scenario: A user signed in to the hosted server enters someone else's self-hosted URL, for example "join my server". Every request then carries the hosted session cookie, and that operator can replay it against the hosted API.
  - With the cookie, `listDevices` returns the user's device IDs. Sending one as the device header unlocks every procedure that doesn't need a fresh session.
  - If the user is a group admin, the operator can call `groupInvites.createShared`, join with their own account and receive later epoch keys, so they see the family's live locations. Members do get a join alert.
  - The raw revoke token can't be replayed on its own. It does mean the old session is never revoked.
- Suggested fix (decided, Q3):
  - **Scope credentials by server.** Use `storagePrefix: openbeacon_<serverKey>`, where `serverKey` is a short hash of the normalised base URL (M9). Store the revoke token as `[server, token]`, and drop it on a mismatch. Nothing has shipped, so no cookie migration is needed.
  - **Wipe on a server change.** Before the new URL is saved, run `endSession({ reason: "serverChanged" })`. It makes a best-effort sign-out against the old server, then clears that server's queued points, pending sharing changes and compatibility state.
  - **Build the full `endSession(reason)`** from X-01, with the reasons `signedOut | phoneRemoved | accountDeleted | serverChanged | sessionLost`. One table says what each reason clears, and a table-driven test pins it. All five existing paths call it. This also closes S8-06, S6-10 and I5: `sessionLost` records `{ userId, lostAt }` and wipes the keys after 30 days, or when a different account signs in.
  - Give the credentials `WHEN_UNLOCKED_THIS_DEVICE_ONLY` through one `getSecureStoreOptions`.
  - Change the "session will remain active" copy.
- Compatibility: app patch. No level change.

### M4. Opening the app stops location sharing until permissions load; offline, it stays off

- Finding: S6-01 · bug · **high** · verified (V4, reproduced)
- Location: apps/mobile/providers/TrackingProvider.tsx:51-54 and :186; apps/mobile/providers/LocationPermissionProvider.tsx:42 and :112-120; apps/mobile/lib/tracking.ts:221-235, :273-290, :493-498
- Failure scenario: On a cold launch, `permissionState` is `null`, and the first cycle reads that as "not allowed". It stops the capture service and revokes the native epoch keys. Offline (looking at the map on a hike, say), nothing restarts capture:
  - the key check still looks fresh, so the phone doesn't re-fetch keys for 4 to 30 minutes;
  - after the app is backgrounded, nothing at all restarts capture.

  The phone shares nothing until the app is opened online, and the persistent notification just disappears. Online, every launch still stops and restarts the service and drops fixes. The same happens on entering the setup and recovery screens.

- Suggested fix:
  - Gate only the reconcile step, not the whole cycle, on a known permission state.
  - If the permission sync fails, fall back to a direct `getLocationPermissionState()` read, or a "skip while null" rule would disable reconciles for the session.
  - Whenever native keys are revoked, also call `markTrackingKeysStale()`, or fall through to the network path when `startCapture && !hasKeys`.
  - Keep stop-and-revoke for a known `isReadyForSharing === false`.
  - Add tests that start at `permissionState: null` and cover revoke followed by a fresh-looking key check.
- Compatibility: app patch.

### M5. Redis outages longer than about 30 seconds break every API call until the backend restarts

- Finding: S4-01 · bug · **high** · verified (V3, reproduced against a throwaway Redis)
- Location: packages/cache/src/cache/OpenBeaconCache.ts:59-61; apps/backend/src/cache.ts:4-7; packages/auth/src/index.ts:28-33 and packages/email/src/index.ts:43-45 (two more clients); packages/api/src/middlewares/rateLimitMiddleware.ts:34-40; apps/backend/src/routes/health.ts:8-16
- Failure scenario: Bun's `RedisClient` gives up after an outage of about 25–33 s and stays closed for good. A Redis redeploy, host reboot or crash loop easily lasts that long. After that:
  - every tRPC call fails in the rate-limit middleware;
  - email-code limits and email sends fail;
  - the runner's emails stop silently;
  - `/health` still reports ok, so nothing restarts the container.

  During shorter outages, requests hang for the whole outage, because there is no per-command timeout and commands queue while offline.

- Suggested fix:
  - Wrap the client: on `ERR_REDIS_CONNECTION_CLOSED` or `onclose`, call `connect()` with backoff. A closed client can be revived; a new one isn't needed.
  - Race each command against a short timeout and set `enableOfflineQueue: false`.
  - Handle a Redis error per caller, as in the Q5 table. Fail open with a log line for the general, upload and invite limits. Fail closed for email-code requests and guesses, and for the new password-failure limit. The email cap skips optional alerts but sends required mail. `alertsTurnedOff` sends straight away, and the pmtiles cache is bypassed.
  - Add a Redis ping to a readiness check, keeping `/health` fast for the app.
  - Ideally share one client per process (D6).
  - Add an integration test that restarts Redis.
- Compatibility: server patch.

### M6. Any signed-in user can write about 100 MB of ciphertext a minute, kept for 60 days

- Finding: S3-03 · security · **high** · verified (V2)
- Location: packages/api/src/router/group/groupTrackingRouter.ts:21-28 (240 requests/min); packages/schemas/src/schemas/group/tracking.ts:23-36 (100 points per batch, `ciphertext` up to 4096 chars); packages/api/src/router/group/groupLifecycleRouter.ts:85-91 (anyone can create a group of one)
- Failure scenario: A user, or a script running a few free accounts, creates a solo group and loops `uploadBatch`. The hosted Postgres disk fills within hours, and every group's uploads and sign-ins fail.
- Suggested fix (decided, Q2; per account, no IP limits):
  - Lower `ciphertext.max` from 4096 to 1024. The real worst case is 260 characters.
  - Add a cost-based limit of 2,000 points a minute per user (`cost: points.length`), checked inside `uploadBatch`. Keep the 240 requests a minute.
  - Add a daily budget of `9,504 + 8,640 × G` accepted points per account, where G is the user's group count: 147,744 a day at 16 groups.
  - Cap group membership at 16 per user. Creating a group, accepting an invite or redeeming a join code past the cap fails with `GROUP_LIMIT_REACHED` (Q10).
  - When a limit is hit, return `TOO_MANY_REQUESTS`. The phone keeps the points. The user isn't shown anything. The server logs it, and the scheduled jobs report the accounts with the most daily row growth.
- Compatibility: only unshipped builds are affected, so no level change. Server minor (a new limit), plus an app patch for the cap message.

### M7. Google sign-in silently adds Google to an existing password account

- **Status:** fixed on `fix/beta-1-review` by "Refuse Google sign-in for an email that signs in with a password" (SHA added at wrap-up). Integration test `googleSignIn.integration.test.ts` (signed id token, Google keys stubbed): Google sign-in for a password email gets 401 `OAUTH_LINK_ERROR` and adds no Account row. App message mapping tested in `lib/auth.test.ts`. Emulator check of the message is in the end-of-branch batch.

- Finding: S2-02 · security · medium · verified (V1, reproduced). The reviewer said post-beta; V1 made it must-fix.
- Location: packages/auth/src/createAuth.ts:29-214 (no `account.accountLinking` option, so better-auth links by default)
- Failure scenario: Someone with brief access to the inbox signs in with Google for that email. Google is now a second way into the account:
  - no alert is sent;
  - the owner can't see it or remove it, because `/unlink-account` is disabled;
  - it survives a password change, a password reset and "sign out other sessions".

  This breaks the "password or Google, never both" rule. It applies wherever the local email is verified, which includes the hosted server.

- Suggested fix:
  - Set `account: { accountLinking: { enabled: false } }`.
  - In `apps/mobile/lib/auth.ts`, map better-auth's `OAUTH_LINK_ERROR` / "account not linked" to "This email signs in with a password".
  - Add an integration test.
  - No data clean-up is needed. There is no live hosted database yet (Q4).
- Compatibility: server patch, plus an app patch for the message.

### M8. The location-point reader rejects any new field, so every future payload change forces the whole family to update

- Findings: S10-02 · design · medium · verified (V5, reproduced). Related: S6-14 and S10-08 (D4).
- Location: packages/encryption/src/trackingPoint.ts:55-87 (`Object.keys(value).length !== 6`, the same check for `battery`); apps/mobile/lib/mapTrackingDecrypt.ts:115; BatteryReader.kt:17-30
- Failure scenario: After beta, someone adds `accuracy`. Every older app marks every point from an updated phone as unreadable, and the only remedy is raising `minClientApiCompatibilityLevel` for everyone. The reader is in every installed build, so it has to be relaxed before beta builds ship. A nullable field (a `null` battery level, say) can't be added later even with a tolerant reader, because it changes the type of an existing field.
- Suggested fix:
  - Make the v1 reader ignore unknown keys at the top level and in `battery`, keep validating the known keys, and return a new object built only from them (not `value as TrackingPointV1`).
  - Keep `v === 1` as the switch for a real break, and keep the encoder strict.
  - Widen `battery.level` to `number | null` (Q1). Kotlin sends `null` when `BatteryReader` has `levelKnown = false`. The battery UI must handle an unknown level. Don't add `accuracy` now; it can come later as an optional key.
  - Add the Kotlin non-finite guard (S10-08): `null` for a non-finite speed, and no point for non-finite coordinates.
  - Add test vectors for an extra key and for a `null` level, and have the Kotlin JVM tests read them.
- Compatibility: no level change, because only unshipped builds can't read a `null` level (Q1, Q11). App minor.

### M9. A server URL with a trailing slash or a path breaks the app, and the launch screen then traps the user

- Findings: S8-02 · bug · medium and S8-04 · UX · medium. Both verified (V5, reproduced against the real backend); worse together.
- Location: apps/mobile/app/serverUrl.tsx:16-18 and :44; apps/mobile/lib/server-url.ts:9-15; apps/mobile/lib/base-url.ts:5-6; apps/mobile/lib/api.ts:93; apps/mobile/lib/apiCompatibility.ts:114; apps/mobile/app/index.tsx:79-104
- Failure scenario: A self-hoster pastes `https://beacon.example.com/`, and the reachability check passes.
  1. better-auth trims the slash, so sign-in succeeds.
  2. tRPC calls `//api/trpc/...` and gets a 404, so setup fails with the session already saved.
  3. From the next launch, the index screen retries the device check every 5 s forever behind a pulsing logo, with no message and no route to the server screen. Only clearing app data recovers.

  A path prefix (`https://a.com/beacon`) makes better-auth and tRPC call different paths. A long hosted or self-hosted outage gives a Pending phone the same unexplained logo.

- Suggested fix:
  - Normalise in the `currentServer` module (Q3) with `new URL`. Require http(s), reject a query, fragment or credentials, keep any path prefix, and strip trailing slashes (decision E2). Normalise on read too, for values already saved.
  - Build every URL from the normalised base: `${base}/api/auth` passed explicitly to better-auth, `${base}/api/trpc` and `${base}/health`. Test it behind a reverse proxy that serves the backend under a path, and document that `BETTER_AUTH_URL` must include the path.
  - Run the compatibility check on the normalised value.
  - On the launch screen, after the first failure show the error with "Try again", "Sign out" (through `signOutOfThisPhone`) and, when self-hosted, "Change server". Back off the retries: 5 s, 15 s, 60 s.
  - Fix the "leave blank" copy.
  - Add unit tests for the normaliser.
- Compatibility: app patch.

### M10. Deleting a heavy account can time out and roll back, locking the user's groups each time

- Finding: S4-02 · bug · medium (the reviewer said high) · verified (V3, reproduced)
- Location: packages/api/src/lib/account-deletion.ts:19-98, called from apps/scheduled-jobs/src/jobs/accountDeletion.ts:21-36, apps/scheduled-jobs/src/deleteAccount.ts:17 and packages/api/src/router/accountRouter.ts:358-366. The same pattern for one group is at groupMembershipRouter.ts:310.
- Failure scenario: All of a user's location rows are deleted inside one transaction with Prisma's 5 s default timeout, while the user's groups are locked.
  - A first attempt at 345k rows failed after 7.1 s, and at 691k after 19.2 s. Other members' uploads were blocked for the whole time.
  - Retries can succeed once the rows are cached. On a small box with interleaved rows they may keep failing every 5 minutes.
  - A typical user has about 40k rows per group, but a heavy mover in 3 or more groups reaches these sizes.
  - The "delete now" path ignores the error, and failures are logged without a code. This undermines the erasure promise.
- Suggested fix:
  - Before the locking transaction, delete `GroupEncryptedPayload` rows by `senderUserId` in batches of about 5000, the way `locationHistoryCleanup.ts` does. Sessions are already revoked, so nothing new arrives.
  - Run the batches only after re-checking, under the User lock, that the account is due. No "deleting" mark is needed: after `deletionDate`, `session.create.after` refuses a sign-in instead of cancelling, so nothing can cancel a deletion once the batches start (Q6). Add a test proving it.
  - Keep a final `deleteMany` for stragglers.
  - Give the transaction an explicit `timeout`, and log `errorCode(error)`.
  - Apply the same batching to the leave and remove-member path.
  - Add a test that seeds about 500k rows.
- Compatibility: server patch.

### M11. The "Update Open Beacon" screen has a permanently disabled Update button

- Finding: S10-03 · UX · medium · verified (V5)
- Location: apps/mobile/components/ApiCompatibilityGate.tsx:150-154; apps/backend/src/helpers/apiCompatibility.ts:16; apps/backend/src/routes/health.ts:9-15
- Failure scenario: The first time `minClientApiCompatibilityLevel` rises after beta, every beta install shows a greyed-out Update button. Play Store auto-update helps store installs, but sideloaded and internal-track testers have nowhere to go. The hosted operator also can't show a message such as "maintenance until 15:00". The gate is in every installed build, so it has to be right before beta.
- Suggested fix:
  - Have the button open `market://details?id=net.openbeacon.app`, with an https Play Store fallback.
  - Add an optional plain-text `message` (at most 280 characters) to the 426 body and to `/health`, taken from a new `CLIENT_UPDATE_MESSAGE` env var. The app shows it as plain text on any compatibility screen. On the hosted server the owner sets it at deploy. There is no `updateUrl`, because a hostile self-hosted server could point people at an APK (Q8).
  - Update the frozen-shape tests in apps/backend/src/app.test.ts and the "Frozen surfaces" section of docs/development/api-compatibility.md.
- Compatibility: additive, no level change. App and server patch, or minor.

---

## Cheap wins worth taking before beta

These don't block beta. Each is small, and several get harder to change once beta builds are installed.

| ID  | What                                                                                                                                                                                                                                                                                                                                                                                                                     | Findings                                                                                             | Why now                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| C1  | Outbound clients with default timeouts: `s3Client`/`r2Client` `requestHandler` timeouts; Resend calls with `AbortSignal.timeout`; Google token and certs fetches; `PrismaPg` pool `connectionTimeoutMillis` and `statement_timeout`; a timed fetch for the app's image PUT; the auth client reading the body inside its timer                                                                                            | D5: S5-01, S3-05, S2-07, S4-03, S4-04, S8-11, S9-06, and the Google certs row in the X timeout table | A hung Resend, S3 or DB call can stall request handlers, the account-deletion job and group delete. About a day's work. |
| C2  | Return a generic message for INTERNAL_SERVER_ERROR, and log the real one server-side                                                                                                                                                                                                                                                                                                                                     | S2-03 (V1), I2                                                                                       | Prisma error text (queries, paths, DB host) reaches anonymous callers today                                             |
| C3  | Make a "too old" verdict from a missing procedure stick until "Try again" or a server version change, on both clearing paths (`/health` and response headers)                                                                                                                                                                                                                                                            | S10-04 (V4)                                                                                          | The gate logic is in every installed build                                                                              |
| C4  | `android.allowBackup: false`                                                                                                                                                                                                                                                                                                                                                                                             | D1: S1-09, S8-09                                                                                     | MMKV (decrypted group colours, pending invite codes) and native tracking prefs go to cloud backup                       |
| C5  | Patch hono to 4.13.16 or later and better-auth to 1.7.22; `bun add superjson` in apps/mobile; remove unused backend and scheduled-jobs deps                                                                                                                                                                                                                                                                              | S2-09, X-09, D8                                                                                      | superjson is the stored format for pending sharing changes but is undeclared                                            |
| C6  | Pass `location.time` (epoch ms) into `onFix` and drop the `java.time.Instant` round trip, and raise `minSdk` to 26 (decision E3)                                                                                                                                                                                                                                                                                         | S6-09                                                                                                | `java.time.Instant` in the capture path crashes Android 7 on the first fix                                              |
| C7  | `.env.example`: move inline comments onto their own lines. docker-compose: bind Postgres and Dragonfly to 127.0.0.1                                                                                                                                                                                                                                                                                                      | S5-02, S5-03                                                                                         | With `docker run --env-file`, `CLOUDFLARE_ORIGIN_SECRET` becomes the public comment text and passes validation          |
| C8  | Docs: reword privacy draft line 43 and state near line 9 that a malicious backend can make phones accept a key it chose; update OPE-213's scope (V6); record level 4 as the Beta 1 baseline in the level history (`requestedAt`, nullable `battery.level`, 1.10/1.11 unsupported; Q11); say Beta 1 is Android 8+ only (Q9, E3) and remove `"ios"` from `platforms` along with the iOS background-location config (S6-02) | S1-01, S10-01, S6-02                                                                                 | Claims shouldn't outrun the code at launch                                                                              |
| C9  | Disable the unused better-auth endpoints, including the open redirect                                                                                                                                                                                                                                                                                                                                                    | S2-06                                                                                                | It is blocked today only because the version check refuses browsers                                                     |
| C10 | Promote to foreground before any `stopSelf` on every `startForegroundService` path. Check on a real device first.                                                                                                                                                                                                                                                                                                        | S6-04 (unverified on device)                                                                         | Android counts this as a crash, and unit tests can't catch it                                                           |
| C11 | Disable Remove/Leave while the new epoch is being built                                                                                                                                                                                                                                                                                                                                                                  | S9-04                                                                                                | A double tap starts two removals                                                                                        |
| C12 | Reset group-screen state when `groupId` changes (`key={groupId}`)                                                                                                                                                                                                                                                                                                                                                        | S9-01                                                                                                | An unsaved rename on group A can be saved onto group B                                                                  |

---

## Decisions needed before fixing

All settled on 13 Nov 2026. See "Decisions" at the top. The M and C items above already reflect them.

Pre-beta work that the decisions add outside M1–M11 and C1–C12:

- **Q7.** A per-account password-failure limit (10 failures in 15 minutes, keyed on the normalised email), then removal of every IP-based limit. `feedback.submit` gets one server-wide limit.
- **Q9.** Block iOS builds (part of C8).
- **Q10.** A minimal error vocabulary: `ErrorReason`, `data.reason` and the app's `errorReason()`.
- **Q2.** A 16-group membership cap.

---

## Cross-cutting themes

The full evidence is in `raw/X.md`: the storage-wipe table, the error-code counts and the timeout tables for app and server.

1. **No single owner for ending a session on the phone** (X-01). Five paths each clear a different subset of local state, and storage keys are scoped seven different ways. S8-01, S8-06 and S6-10 are each a path that forgot one row. Deleting an account also leaves the user's other phones holding device and history private keys forever (I5).
2. **Errors have no machine-readable identity** (X-02, X-03).
   - The server sends three `cause` values, and the app branches 56 times on HTTP-style codes through six classifiers.
   - It also matches English server text twice.
   - 50 places show `error.message` to users, which can be a JSON zod issue array or a raw Redis error.
   - There are 24 hand-written "can't reach the server" strings and four separate ways of detecting offline.
3. **Timeouts are set per call, not per client.** The app writes them nine different ways and the server three, and no outbound client has a default. The gaps are S3, Resend, Google, the Postgres pool and statements, Redis commands, and the image PUT (D5, C1).
4. **Permanent server rejections are retried forever.** This covers queued uploads (S6-03), sharing changes (S6-06) and the level-4 interaction (I1). Fixing these safely needs the reason codes from theme 2.
5. **Shared formats and limits are retyped instead of shared.**
   - The join-code regex appears four times.
   - The sharing revision prefix is parsed four times, in both TS and Kotlin.
   - Name and ID limits are written in several places.
   - `packages/shared` carries server-only code, so server edits force app bumps (X-07).
   - API outputs mix `void`, English messages, whole Prisma rows, three time formats and two cursor styles (X-05).
6. **Loading, failed, empty and signed-out states look alike** (D11). Failed loads show as "No groups yet" (S9-03), an endless spinner (S7-03, S8-04) or the wrong copy (S8-14). There are no shared ErrorState or EmptyState components.

Project-rule compliance is mostly good (X-08):

- 0 `.js` imports, 0 explicit `any` and 0 non-null assertions.
- 258 `tryCatch` uses against 20 `catch` blocks.
- 50 `function` declarations, all in apps/mobile, 40 of them in the shadcn-derived `components/ui`.
- About 15 `as` casts, 5 of them on untrusted data.
- 10 single-use `*Props` aliases.
- 31 non-workaround comment lines.

The missing `tryCatchSync` causes most of the try/catch workarounds.

## What checked out

These were looked at specifically and found sound.

**Crypto**

- The hand-written HPKE passes the RFC 9180 test vectors.
- Each HPKE use has its own info string.
- Kotlin and TS produce identical bytes, pinned by shared vectors.
- No key material reaches logs or error text.

**Auth and devices**

- The setup allow-list and the DEVICE_PENDING / DEVICE_UNVERIFIED gates match the docs and are pinned by a test.
- Spoofing the device-ID header gains nothing.
- Device-link and session-link challenges are single-use.
- Neither Hono advisory affects the backend (tested against the real app).

**Server data access**

- No deadlocks: lock order is the same everywhere (User → Group → GroupMember → AccountHistoryKey), and jobs use `SKIP LOCKED`.
- No cross-group or cross-account access was found by passing someone else's IDs.

**Database**

- `prisma migrate diff` from the migration to the schema is empty.
- No `@map` is used.
- Timestamps are consistently UTC.
- Hot queries have indexes, apart from S4-08.

**Ops**

- Emails escape user values, and SMTP has timeouts.
- The backend image runs as non-root, has a healthcheck and bakes in no secrets.
- The map-tiles service binds to 127.0.0.1 and has no path traversal.

**Mobile tracking**

- Every background-upload call has a timeout.
- A killed upload is retried and de-duplicated by the server.
- Points captured while sharing is paused are never stored.
- The boot receiver is safe.

**Map**

- Polling doesn't stall or leak; it backs off and stops in the background.
- Edge-marker and pin-grouping maths guard against division by zero, NaN and the antimeridian.
- 58 tests cover this.

**App auth**

- Sign-out and the device-removed wipe are thorough.
- The recovery-phrase and QR screens use FLAG_SECURE.
- tRPC requests have timeouts.

**Version skew**

- Every procedure the app calls exists with a matching input shape.
- No procedure has been added since level 4 was set.
- The app tolerates new enum values.
- The offline compatibility gate behaves as documented.

## Rejected and downgraded

No finding was rejected outright. Verification changed these:

- **S10-01**: high → low. Apps 1.10.0 and 1.11.0 never left development. The process gap remains (S10-05).
- **S6-02**: high → low. iOS isn't in Beta 1. It must be fixed before any iOS release.
- **S4-02**: high → medium. "Never completes" was overstated, and typical row counts are about 40k per group. It stays must-fix.
- **S1-02**: medium → low. It needs a malicious server, so it belongs with OPE-213.
- **S3-05, S5-01 and S10-04**: must-fix → post-beta. They are covered by cheap wins C1 and C3.
- **S2-02**: post-beta → must-fix.
- **Knip items rejected on manual check**: `@prisma/client` and `pg` (used by generated code), `expo-image` and `expo-glass-effect` (expo-router dependencies), `expo-dev-client` and `expo-updates`.

---

## Refactor shortlist

Ranked by value, from `raw/X.md`. "Before beta" means it is the cheapest safe way to fix a must-fix item.

1. **App session and server identity owner** (X-01, D16). Add `endSession(reason)`; a `currentServer` module that normalises the URL, scopes credentials and wipes on change; and one key-builder for all device storage, with a table-driven test.
   - Before beta, minimal version: carries M3 and M9.
   - Size: medium, 2–3 days.
2. **Outbound clients with default timeouts** (D5).
   - Before beta: this is C1.
   - Size: small, about 1 day.
3. **One self-healing Redis client per process**, injected into auth and email (D6).
   - Before beta: carries M5.
   - Size: small to medium.
4. **Phased account deletion with a shared batched-delete helper**, also used by group leave and history cleanup (D7).
   - Before beta: carries M10.
   - Size: small to medium.
5. **Error vocabulary** (X-02, X-03).
   - A shared `ErrorReason` sent in `data.reason`.
   - On the app, one `errorReason`/`userMessage` helper plus `ErrorState`/`EmptyState` components.
   - Before beta, minimal version (Q10): the union, `data.reason` and `errorReason()`, used for the group cap, upload limits, password lockout and the uploader's split. The other classifiers and the components come after beta, but before S6-03 and S6-06.
   - Size: medium.
6. **Split `lib/tracking.ts`** (1,020 lines) into a key reconciler, a queue uploader and a session lifecycle.
   - Post-beta.
   - Size: medium to large.
7. **Group mutation preamble and lock helpers** (`lockUser`, `withLockedGroup(tx, groupId, userId, minRole)`).
   - Removes 30 copied lock statements and makes role rules one table.
   - Post-beta.
   - Size: medium.
8. **API surface hygiene**.
   - All inputs in packages/schemas with a shared `idSchema` and limits.
   - Explicit output `select`s, and the dead procedures (S10-07) removed.
   - A procedure and test-vector snapshot in CI (S10-05).
   - Post-beta.
   - Size: medium, mostly mechanical.
9. **`TrackingCaptureService` lifecycle state machine** (S6-04, S6-12).
   - Post-beta.
   - Size: medium.
10. **Map pipeline**: merge the 6-file marker pipeline, stop idle-poll re-renders (S7-01), and fold the tiny map modules.
    - Post-beta.
    - Size: medium.
11. **UI kit**: `ScreenHeader` (inlined in 18 screens), `TextField`, `useBlockBack`, theme tokens merged (S9-05, S9-11), and the dead shadcn parts removed.
    - Post-beta.
    - Size: medium, mechanical.
12. **Small, independent items**:
    - split `accountRouter.ts`;
    - an `expiredRecordsCleanup` helper;
    - env helpers;
    - split `packages/shared` (X-07);
    - add `tryCatchSync` (X-08);
    - a root dependency `catalog` for zod, tRPC, better-auth, AWS SDK and TypeScript, so the app stops bundling two copies of zod (X-09).

## Duplicate groups

Findings in different sections that describe the same underlying issue. Fix each group together.

| Group                                                                        | Findings                                                                          | Notes                                                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D1 Android Auto Backup                                                       | S1-09, S8-09                                                                      | C4                                                                                                          |
| D2 Departed members and old epochs                                           | S3-01, S3-02, S6-07, S1-02                                                        | M2 fixes S3-01 and the S3-02 read half; the S3-02 upload half and S6-07 are accepted; S1-02 goes to OPE-213 |
| D3 SecureEpochKeyStore `apply()` and silent empty on keystore failure        | S1-08, S6-13                                                                      |                                                                                                             |
| D4 Tracking payload v1                                                       | S10-02, S6-14, S10-08                                                             | M8                                                                                                          |
| D5 Outbound calls without timeouts                                           | S2-07, S3-05, S4-03, S4-04, S5-01, S8-11, S9-06                                   | C1                                                                                                          |
| D6 Redis clients                                                             | S4-01, S2-11, S5-13                                                               | M5                                                                                                          |
| D7 Unbounded or network work inside transactions                             | S4-02, S3-05, S4-06, S4-03                                                        | M10, C1                                                                                                     |
| D8 Undeclared `superjson`                                                    | S6-16, S8-16, X-09                                                                | C5                                                                                                          |
| D9 Product name spelled three ways                                           | S6-17, S8-15                                                                      |                                                                                                             |
| D10 Deep links not allow-listed; tab components routable; no not-found route | S8-05, S8-10, S9-02                                                               | One `+native-intent` allow-list plus `+not-found.tsx`                                                       |
| D11 Loading, failed, empty and signed-out look alike                         | S9-03, S8-04, S8-14, S7-02, S7-03, S7-09, S8-15                                   | X-03 components                                                                                             |
| D12 Raw Prisma rows and dead procedures                                      | S3-09, S10-07, S10-10, X-05                                                       |                                                                                                             |
| D13 Strict versus loose input schemas                                        | S5-06, S10-06                                                                     |                                                                                                             |
| D14 Validation limits inconsistent                                           | S5-07, S5-08, X-06                                                                |                                                                                                             |
| D15 Sharing revision prefix parsed in TS and Kotlin                          | X-06                                                                              | Shared parser plus a JSON vector                                                                            |
| D16 No "current server" identity                                             | S8-01, S8-02, S8-03, X-01                                                         | M3, M9                                                                                                      |
| D17 Silent account-deletion failures                                         | S2-10, S4-05                                                                      | M10                                                                                                         |
| D18 Dead code shipped                                                        | S1-05, S2-11, S6-16, S7-07, S7-08, S9-12, S10-07, X-09                            |                                                                                                             |
| D19 AGENTS.md rule breaches                                                  | S1-10, S2-11, S4-13, S8-16, S9-18, X-08                                           |                                                                                                             |
| D20 Docs out of date                                                         | S4-11, S6-15, S7-11                                                               | Also: the "Places" context in CONTEXT-MAP.md has no code; mark it as planned                                |
| D21 `check-version-bump` gaps                                                | S5-12, S10-05, X-07                                                               |                                                                                                             |
| D22 Permanent rejections retried forever                                     | S6-03, S6-06, X-02                                                                | Needs reason codes first                                                                                    |
| D23 Client and server clocks mixed                                           | S7-04, S7-05, S6-06, X-05                                                         |                                                                                                             |
| D24 Raw error text shown to users                                            | S2-03, X-03                                                                       | C2                                                                                                          |
| D25 IP-based limits still present                                            | S2-04, plus `feedback.submit`, the invite-redeem limits and `EMAIL_CODE_IP_LIMIT` | Q7                                                                                                          |
| D26 Double submit when async work runs before the mutation                   | S9-04, S8-12, X-04                                                                | C11                                                                                                         |
| D27 JS and native disagree on when sharing may run                           | S6-01, S6-11                                                                      | M4                                                                                                          |

## Tooling evidence

- **`bun run ci`**: passes.
- **Integration tests**: 317 pass, 0 fail, in 38 s.
- **`bun audit`**: 16 advisories (4 high, 9 moderate, 3 low).
  - The four highs are the documented ignores.
  - Undocumented: hono 4.13.11 has two moderate middleware-bypass advisories, tested as not exploitable here (S2-09).
  - `decode-uri-component` is reached at runtime through deep-link parsing; it is documented.
- **`bun outdated -r`**:
  - Expo SDK 55.0.8 against 58 latest (55.0.32 is within range).
  - tRPC 11.15 against 11.28.
  - better-auth 1.7.14 against 1.7.22.
  - hono 4.13.11 against 4.13.18.
- **knip**: 3 unused files, 20 unused exports and several unused or unlisted dependencies. All were triaged by hand in X-09, S9-12 and S7-07.

## Coverage

Every file under `apps/` and `packages/`, plus `scripts/`, the Docker files, the env files and the README, was assigned to exactly one section. Each section's `## Files reviewed` list is in its raw file. CI workflows were out of scope. The separate OpenBeacon-Docs repo wasn't reviewed.

---

## All findings by section

Generated from the raw files, with verifier corrections applied. Must-fix findings point to their M item above. Within each section, entries are ordered by severity.

### S1 Encryption and key handling

#### S1-01 · medium · security

**Wrap sender keys come from the server response, so HPKE auth mode doesn't authenticate the epoch key, and History wraps accept any sender**

- Location: packages/encryption/src/index.ts:212-241 (`unwrapEpochKey` reads `senderPublicKey` from the wrap it is checking); packages/encryption/src/recovery.ts:200-234 (`unwrapHistoryEpochKey`, same); apps/mobile/lib/epochKeys.ts:19-74; packages/api/src/router/group/groupEpochRouter.ts:9-56 (each History wrap is returned with its own stored `senderPublicKey`); docs/security/beta-1-privacy-draft.md:43
- Failure scenario: A malicious or compromised server inserts a History wrap with a key it chose for an existing epoch E, or answers `getEpochKeyWraps` with its own `senderPublicKey`. It needs no directory key swap to do this. A phone that reads E only through History wraps (any new or restored phone) accepts the key. The server can then serve location points it made up, and they decrypt as any member's device in that group's history and on the live map. `useGroupKeyAccess` also reports the epoch as readable. The documented threat model only accepts a server that swaps directory keys (OPE-213). This attack doesn't need a swap, and signing the directory under OPE-213 won't stop it, because no caller compares the wrap's sender against the directory.
- Suggested fix: Make the expected sender a separate parameter of `unwrapEpochKey` and `unwrapHistoryEpochKey`, so it can't come from the wrap itself. On the client, take it from the device directory: the epoch's `createdByDeviceId` key for device wraps, and the creator or one of the account's own devices for History wraps (the backfill senders). Check that `createdByDeviceId` is a current member device. This adds little while the directory is trusted, but it's the call-site change OPE-213 depends on. Also correct privacy-draft line 43, which says the check exists, and say that History wraps aren't covered.
- Verification: V6: worse than reported (a malicious server can also make a phone encrypt to a key it chose), but already an accepted Beta 1 risk under OPE-213. Fix docs before beta (C8).

#### S1-03 · medium · security

**Nothing checks that all wraps of an epoch hold the same key, so a malicious member can quietly break other members' live view or history**

- Location: apps/mobile/lib/groupEncryption.ts:20-51 (`createEpochBundle`); packages/encryption/src/index.ts:162-210; apps/mobile/hooks/useGroupKeyAccess.ts:95-106
- Failure scenario: A group member with a modified app joins, accepts an invite or rotates, and so creates the next epoch. They wrap a different random key in each member's History wrap than in the Device wraps. Live sharing keeps working through Device wraps. When a member later restores on a new phone, every epoch made by that creator is unreadable. The app still reports the history as complete because the wraps open, and backfill never repairs it because a History wrap for that version already exists. Wrapping different keys to different devices also splits the group into readers that can't see each other until the next rotation.
- Suggested fix: Store a key commitment with each epoch, for example `HMAC-SHA256(epochKey, "openbeacon.epoch-commit.v1" || epochId)`, sent in the epoch bundle and returned with the wraps. After unwrapping, the client checks the key against it and treats a mismatch as "missing". Adding the column is backwards compatible: older epochs without a commitment are accepted as now.
- Confidence: medium
- Verification: V6 reproduced it. Add a key commitment per epoch when the epoch bundle next changes.

#### S1-02 · low · security

**The client accepts any "latest" epoch, and epoch numbers aren't bound to the key, so the server can roll a group back to a pre-removal epoch**

- Location: apps/mobile/lib/tracking.ts:315-409 (uses `groupEpoch.getLatest`'s `epochId` with no check that it moved forward); packages/encryption/src/index.ts:64-70 (wrap info binds `epochId` and `recipientDeviceId`, not `groupId` or `epochNumber`); packages/api/src/lib/groupTracking.ts:121-180 (uploads are accepted for any epoch of the group)
- Failure scenario: Member M is removed and epoch 5 replaces epoch 4. A server that colludes with M (or an attacker who controls API responses) keeps returning epoch 4 from `getLatest` and its wraps from `getEpochKeyWraps`. Every remaining phone goes on provisioning epoch 4 to native capture and uploading under it, and M still holds that key. The phones never notice the rollback. The same applies after a device is removed. This sits next to the accepted directory-trust risk, but rollback isn't listed in the threat model docs.
- Suggested fix: Store the highest `epochNumber` and `epochId` seen for each group in MMKV, and refuse to provision a lower one (show a key-problem state instead). In the next wrap-info version, add `groupId` and `epochNumber` to the info so the creator authenticates them. Wraps are per epoch and old epochs are deleted after 60 days, so a v2 info string can be phased in after beta. Add rollback to the threat list in beta-1-privacy-draft.md.
- Verification: V2: needs a malicious server; fold into OPE-213.
- Same issue as: D2 (see Duplicate groups)

#### S1-04 · low · security

**Personal data uses HPKE base mode, so anyone with the History public key can forge or replay nicknames and colours**

- Location: packages/encryption/src/personalData.ts:53-76, 83-125
- Failure scenario: The server swaps the user's nickname records for two members, for example writing "Mum" against another member's ID. The user then reads that member's live location as Mum's. The server can also replay an older ciphertext to undo a nickname or colour change. The privacy promise covers confidentiality, but users will assume these labels are their own.
- Suggested fix: When a v4 envelope is next needed, seal with HPKE auth mode using the History key as both sender and recipient, the way escrows are sealed. Only a holder of the History private key can then make a record. `resealForSelf` already migrates records whose version differs, so the rollout is cheap. Binding a counter or the record ID into the info would also stop replay.

#### S1-05 · low · design

**Dead and legacy crypto paths that can be dropped before beta**

- Location: packages/encryption/src/personalData.ts:29-51, 97-103 and apps/mobile/lib/personalData.ts:63-69 (v2 device-key personal data: `sealPersonalData` is only called from tests, and v2 lived only from 7 to 8 Nov 2026, commits 1a668f09 to 2880197e); apps/mobile/lib/deviceKeys.ts:108-145, 226-234 (unscoped "legacy" device key migration from March 2026, commit 682492c1); packages/encryption/src/index.ts:243-316 (`encryptPayloadWithEpochKey`/`decryptPayloadWithEpochKey` only wrapped by `encryptGroupPayload`/`decryptGroupPayload`), :361-365 `decodeUtf8Payload` and :427 `getRecordEpochId` (unused), `encodeTrackingPointV1` (tests only); GroupPayloadEncrypt.kt:44-63 `decryptGroupPayload` and InMemoryEpochKeyStore.kt (test or benchmark only, but in `main`); the `nonce` parameter on the production encrypt APIs (index.ts:247, 329; GroupPayloadEncrypt.kt:22)
- Failure scenario: The legacy migration in `getStoredDeviceKeyContext` copies an unscoped key into the storage of whichever account signs in first. On a phone that had account A's unscoped key, account B signing in first registers with A's device ID and key. I didn't confirm whether the server then refuses B (medium confidence on the impact). The v2 read path keeps a second, device-bound personal-data format alive that no current build writes. A `nonce` parameter on production encrypt APIs invites nonce reuse under a long-lived epoch key.
- Suggested fix: Before beta, while only testers' data exists, delete the v2 envelope (sealing and opening) and the device-key fallback in `createPersonalDataOpener`, plus the legacy unscoped device-key migration. Drop the unused exports. Move the injectable nonce to a test-only helper, or keep it internal and set it only from the vector tests.
- Same issue as: D18 (see Duplicate groups)

#### S1-06 · low · design

**The Device wrap info has no pinned vector, and two wire formats depend on JSON object key order**

- Location: packages/encryption/src/index.ts:55-85 (`encodeMetadata(JSON.stringify({...}))` for wrap info and payload AAD); packages/encryption/src/recovery.ts:31-40 (History wrap info)
- Failure scenario: A refactor reorders the object literal in `getWrapInfo` or passes it through a key-sorting helper. Every test still passes, because they round-trip with the same code. Every existing Device wrap then stops opening, so live keys and history are lost for all users until each group rotates.
- Suggested fix: Add a `device-wrap-v1.json` vector with fixed keys, ephemeral key, expected info bytes and ciphertext, as recovery-v1.json does for History wraps. Use positional JSON arrays for any new info or AAD format.

#### S1-07 · low · design

**The epoch key is also used as the HMAC key for `clientPointId`**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/CapturePipeline.kt:70-78
- Failure scenario: No practical attack is known for HMAC-SHA256 and XChaCha20 sharing a key. Still, it breaks key separation, and the output is sent to the server for every point. If either primitive or this ID scheme changes later, that shared key will need to be reasoned about again.
- Suggested fix: Derive a sub-key once per provisioned key with HKDF-SHA256 (`info = "openbeacon.tracking-point-id.v1"`) and use it for the HMAC. The ID only deduplicates uploads, so changing it costs at most one duplicate point per queued fix across the upgrade.

#### S1-08 · low · bug

**Small robustness gaps in SecureEpochKeyStore, which has no tests**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/keys/SecureEpochKeyStore.kt:24-26, 39-48
- Failure scenario: (a) After a member removal, JS provisions the new epoch key. Android kills the process before the `apply()` write reaches disk. On restart capture reads the previous epoch key, and the server accepts uploads under it (it accepts any epoch of the group), until the next JS reconcile. (b) A Keystore key loss (OS update or restore) makes `list()` return empty forever. Capture then stops silently until JS notices there are no keys.
- Suggested fix: Use `commit()` in `replaceAll` too, since the API is already synchronous. When decryption fails, delete the stored blob so the state is clean, and surface "no keys" to JS. Add an instrumented (androidTest) round-trip test.
- Confidence: medium
- Same issue as: D3 (see Duplicate groups)

#### S1-09 · low · security

- **Status:** fixed on `fix/beta-1-review` by "Turn off Android cloud backup" (SHA added at wrap-up). C4. Config only, so no new test; `expo config --type introspect` shows `android:allowBackup="false"` in the manifest.

**Android Auto Backup is on, so MMKV and the native key-store and queue files go to the user's cloud backup**

- Location: apps/mobile/app.json (no `android.allowBackup`; `@expo/config-plugins` defaults it to `true`); apps/mobile/lib/storage.ts; SecureEpochKeyStore.kt (SharedPreferences `openbeacon_tracking_epoch_keys_v2`)
- Failure scenario: Group colours (personal data the docs say only the user can read) and a live invite code can be copied to Google Drive backup. After a restore on a new phone, MMKV still says `encryption.device.active.<oldId>` and keeps the old registration record. The code copes, because the private key is missing and a new key is made, but the restored state is stale.
- Suggested fix: Set `android.allowBackup: false`, or add backup rules that exclude `mmkv/`, the epoch-key prefs and the Room queue. Neither holds anything a restore can use.
- Confidence: medium
- Same issue as: D1 (see Duplicate groups)

#### S1-10 · low · style

**Style and duplication in the crypto code**

- Location: packages/encryption/src/index.ts:109-112, 318-321 (JSDoc comments, against rule 1); `getSecureStoreOptions` copied in apps/mobile/lib/deviceKeys.ts:36, historyKeys.ts:7, savedDeviceLink.ts:43; base64url helpers in index.ts:50-53 and deviceLink.ts:39-43; the `tryCatch(Promise.resolve().then(() => syncCall()))` wrapper repeated 9 times (epochKeys.ts:29,59; recovery.ts:237; deviceLink.ts:209; deviceActivation.ts:288; sessionLink.ts:26 and elsewhere); `decodeJsonPayload<T>` returns `as T` from untrusted JSON (index.ts:361)
- Failure scenario: There's no direct user impact. Keychain options copied three times can drift (one copy changed to an accessibility class that isn't `THIS_DEVICE_ONLY`). `as T` on decrypted JSON invites callers to skip validation.
- Suggested fix: Move the SecureStore options into one module next to `storage.ts`. Export a single base64url helper from the encryption package. Add a synchronous `tryCatchSync` (or let `tryCatch` take a function) in `@openbeacon/shared`. Have `decodeJsonPayload` return `unknown`. Remove the two comments.
- Same issue as: D19 (see Duplicate groups)

### S2 Server: auth, accounts and devices

#### S2-01 · high · security · **must-fix, see M1**

- **Status:** fixed on `fix/beta-1-review` by "Stop a session moving to a new phone and require a fresh sign-in to activate" (SHA added at wrap-up).

A session moved to a new phone survives removal of the stolen phone, which can then activate the new phone without the password

#### S2-02 · medium · security · **must-fix, see M7**

- **Status:** fixed on `fix/beta-1-review` by "Refuse Google sign-in for an email that signs in with a password" (SHA added at wrap-up). Integration test `googleSignIn.integration.test.ts` (signed id token, Google keys stubbed): Google sign-in for a password email gets 401 `OAUTH_LINK_ERROR` and adds no Account row. App message mapping tested in `lib/auth.test.ts`. Emulator check of the message is in the end-of-branch batch.

Google sign-in silently links Google to an existing password account

#### S2-03 · medium · security

- **Status:** fixed on `fix/beta-1-review` by "Return a generic message for internal server errors and log the real one" (SHA added at wrap-up). C2. Unit test `packages/api/src/trpc.test.ts`: Prisma-style text and a storage cause don't reach the response. The new `onError` log line has no test.

**Unexpected server errors return their internal message to the client**

- Location: packages/api/src/trpc.ts:79-122 (errorFormatter keeps `shape.message` for INTERNAL_SERVER_ERROR)
- Failure scenario: Any unhandled Prisma error (constraint names, model and field names, query arguments, file paths, DB host), an S3/R2 SDK error (bucket, endpoint), `"SMTP could not send email (ECONNECTION)"` or `"Resend could not send email: ..."` from `accountRecovery.requestResetCode`, or `"Cannot identify group image for cleanup."` is shown to any caller, including anonymous callers of public procedures and failures inside `createTRPCContext`. This exposes internals on the hosted server and gives the app raw text where it expects user-facing copy.
- Suggested fix: In the errorFormatter, when `error.code === "INTERNAL_SERVER_ERROR"` and the cause isn't a `TRPCError` the code threw on purpose, replace `message` with a generic string. The `onError` hook already logs the location. Add a unit test that pins this.
- Verification: V1 confirmed in production mode. Return a generic message for INTERNAL_SERVER_ERROR and log the real one (the error hook logs no message today).
- Same issue as: D24 (see Duplicate groups)

#### S2-04 · medium · security

**Password guessing has no per-account limit; only better-auth's implicit per-IP limiter applies**

- Location: packages/auth/src/createAuth.ts:29-214 (no `rateLimit` option, no sign-in hook); better-auth `context/create-context.mjs:170-175`, `api/rate-limiter/index.mjs:305-318`
- Failure scenario: An attacker spreading guesses over many IPs gets unlimited online guesses against one account's password. Passwords only need 8 characters. Once the team removes IP-based limits as planned, there will be no throttle at all. The implicit better-auth limiter is also an IP limit the team may not know is on: everyone behind one NAT or one reverse proxy (self-hosters who leave `TRUSTED_PROXY_PROVIDER=none` behind nginx/Caddy) shares 3 sign-ins per 10 s, and the counts reset on restart and aren't shared across instances.
- Suggested fix: Add a per-account failed-attempt budget for `/sign-in/email` and `/change-password` in a better-auth `before`/`after` hook, keyed on the normalised email or user ID in the existing Redis `rateLimits` (as the email-code wrong-guess limit does). Prefer progressive delay over hard lockout to limit lockout abuse. Then set `rateLimit: { enabled: false }` (or a deliberate config) so the IP limiter isn't on implicitly.
- Same issue as: D25 (see Duplicate groups)

#### S2-05 · low · security

**A session can create unlimited Pending devices, each sending a new-sign-in email**

- Location: packages/api/src/router/authRouter.ts:28-52; packages/api/src/lib/groupEpochs.ts:615-657
- Failure scenario: Anyone holding a session (including one with no device) can send up to 120 alert emails a minute to the owner and add thousands of rows to Devices. On the hosted server this burns the email quota and sending reputation, and it hides real new-sign-in alerts in noise.
- Suggested fix: Cap Pending devices per account (for example 3 to 5; refuse or replace the oldest), or coalesce new-sign-in alerts per account per time window.

#### S2-06 · low · security

- **Status:** fixed on `fix/beta-1-review` by "Switch off the better-auth routes the app doesn't use" (SHA added at wrap-up). C9. Extended the "routes the app doesn't use are switched off" test: the proxy redirect to `https://phish.example` now returns 404.

**Unused better-auth endpoints are still enabled, including an open redirect**

- Location: packages/auth/src/createAuth.ts:30-50
- Failure scenario: If the compat gate is ever relaxed for GET (it already is for the Google deletion callback), `https://<server>/api/auth/expo-authorization-proxy?authorizationURL=https://phish.example` becomes an open redirect on the server's domain. The other routes add attack surface that no test pins.
- Suggested fix: Add these paths to `disabledPaths` (keep `/sign-in/social`, which the id-token flow uses) and extend the "routes the app doesn't use are switched off" test.

#### S2-07 · low · bug

**Outbound calls inside requests have no timeout**

- Location: packages/auth/src/googleDeletion.ts:40-60 (token exchange `fetch` and `verifyGoogleIdToken` JWKS fetch) used by packages/api/src/router/accountRouter.ts:242-248; packages/api/src/router/accountRecoveryRouter.ts:196-201 (awaits `emailCodes.send`, which for Resend calls `resend.emails.send` without a signal, packages/email/src/transport.ts:33)
- Failure scenario: Google's token endpoint or Resend hangs. `account.requestDeletion` with Google, or `accountRecovery.requestResetCode`, waits until the app's 30 s client timeout, and the server keeps the dangling promise. The user sees a generic timeout instead of "try again".
- Suggested fix: Pass `signal: AbortSignal.timeout(10_000)` to the Google token fetch, and wrap the Resend send in a timeout in `createEmailTransport` (S5 owns the transport).
- Same issue as: D5 (see Duplicate groups)

#### S2-08 · low · security

**tRPC batches have no size limit**

- Location: apps/backend/src/routes/trpc.ts:22-48
- Failure scenario: One HTTP request carries about 1,000 calls. Each runs the middleware chain and a Redis `consume`, and every call after the 60th is rejected one by one, so one request costs about 1,000 Redis round trips.
- Suggested fix: Set `maxBatchSize` to a little above the largest batch the app sends (for example 20 to 50).
- Confidence: medium

#### S2-09 · low · security

- **Status:** fixed on `fix/beta-1-review` by "Patch hono and better-auth, declare superjson in the app, drop unused deps" (SHA added at wrap-up). C5 (the dependency half of X-09; the zod catalog and the rest of X-09 stay post-beta). No new test: `bun audit` no longer lists hono, `bun run ci` and 320 integration tests pass.

**Hono 4.13.11 advisories do not affect the backend, but the dependency should still be upgraded**

- Location: apps/backend/package.json (hono 4.13.11); apps/backend/src/app.ts:8-17
- Failure scenario: None today. A future route with a regex param or `foo*` pattern, or auth middleware added on a wildcard, would be exposed.
- Suggested fix: Upgrade hono to 4.13.16 or later.

#### S2-10 · low · bug

**A failed immediate account deletion is swallowed with no log**

- Location: packages/api/src/router/accountRouter.ts:358-367
- Failure scenario: The operator sees nothing in the logs when an immediate deletion fails. If the failure is permanent, for example the "Cannot identify group image" error, the account sits undeleted until someone notices the runner's failures, while the user was told it was deleted.
- Suggested fix: Log a non-identifying line on failure (as the email paths do), and let the runner's retry be the documented fallback.
- Same issue as: D17 (see Duplicate groups)

#### S2-11 · low · duplication

**Small clean-ups: dead file, duplicated config and checks, rule breaches**

- Location: - apps/backend/src/helpers/db.ts (unused; knip lists it; duplicates apps/backend/src/db.ts)
  - apps/backend/src/env.ts:6-8 and apps/backend/src/validateEnv.ts:10-14 (the same Cloudflare secret check twice)
  - packages/auth/src/env.ts and apps/backend/src/envSchema.ts (BETTER_AUTH__, GOOGLE__, EMAIL_CODE_IP_LIMIT and REDIS_HASH_SECRET parsed twice with separate schemas)
  - apps/backend/src/helpers/clientIp.ts:4-5 (`TrustedProxyProvider` repeats the zod enum in envSchema.ts:25-27; derive it with `z.infer`)
  - packages/auth/src/index.ts:13-18 opens a second Redis client next to apps/backend/src/cache.ts
  - packages/api/src/router/accountRouter.ts:474-480 repeats `requireThisDevice` inline with a different error code (NOT_FOUND versus BAD_REQUEST)
  - packages/api/src/router/accountRouter.ts:163 `deletionVerificationMethods` is used by `ConfirmIdentity` for every re-authentication (remove device, phrase setup, change and reset), so the name misleads
  - apps/backend/src/helpers/apiCompatibility.ts:41-45 uses `try/catch` instead of `tryCatch` (AGENTS rule 8)
- Failure scenario: Config drift between the two env parsers (for example, a default changed in one place) and confusing names for future contributors.
- Suggested fix: Delete `helpers/db.ts`, keep one Cloudflare check, share the env schema fragment, derive the proxy type, reuse `requireThisDevice`, and rename the procedure in a compatible way (add a new name and keep the old one until the client minimum passes it).
- Same issue as: D6, D18, D19 (see Duplicate groups)

### S3 Server: groups, tracking and media

#### S3-01 · high · security · **must-fix, see M2**

- **Status:** fixed on `fix/beta-1-review` by "Stop a leaver choosing the next group key and hide pre-join rows from new members" (SHA added at wrap-up). Integration tests in `groupDeparture.integration.test.ts` (leaver's epoch not stored, rotation flagged; later joiner sees no pre-join rows from `poll` or `getLatest`) and unit tests in `groupTracking.test.ts`.

A member who leaves creates, and keeps, the group key used after they leave

#### S3-03 · high · security · **must-fix, see M6**

Any signed-in user can write about 100 MB of ciphertext a minute, with no quota

#### S3-02 · medium · security · **must-fix, see M2**

- **Status:** fixed on `fix/beta-1-review` by "Stop a leaver choosing the next group key and hide pre-join rows from new members" (SHA added at wrap-up). Integration tests in `groupDeparture.integration.test.ts` (leaver's epoch not stored, rotation flagged; later joiner sees no pre-join rows from `poll` or `getLatest`) and unit tests in `groupTracking.test.ts`.

Tracking reads ignore when the reader joined, and uploads under superseded epochs are accepted indefinitely

#### S3-04 · medium · security

**Presigned image uploads don't bind Content-Type, so the public CDN will serve any file type**

- Location: packages/api/src/lib/storage.ts:197-217 (`getPresignedUploadUrl`); packages/api/src/lib/image-upload.ts:136-158 (`confirmImageUpload` checks only the size)
- Failure scenario: a user requests a profile or group image upload, then PUTs an HTML page with `Content-Type: text/html`. The object is publicly reachable at `S3_CDN_URL/<bucket>/user/<id>/uploads/avatar/<uuid>.webp`, before or after confirmation, until cleanup. That is free phishing or script hosting on the operator's CDN domain. If confirmed, members' apps get an image that won't decode.
- Suggested fix: add `content-type` to `signableHeaders`, so the PUT must send `image/webp`. On confirm, check `HeadObject.ContentType === "image/webp"` and the WebP magic bytes with a ranged GET; delete the object if either fails. At the CDN, set `X-Content-Type-Options: nosniff` and `Content-Disposition: inline` for that path.

#### S3-05 · medium · bug

**Group deletion calls storage with no timeout while it holds the group lock; storage calls never time out anywhere**

- Location: packages/api/src/router/group/groupLifecycleRouter.ts:23-82; packages/api/src/s3client.ts:4-11; packages/api/src/lib/storage.ts:219-287 (no `abortSignal`)
- Failure scenario: storage is slow. An owner deletes a group. For up to 15 s every upload, mutation and join in that group queues on the row lock, holding pool connections, and fails with a Prisma transaction timeout ("Transaction already closed"), so the app sees a 500. If the image `DeleteObjects` succeeds but the transaction then times out, the group survives while its image has been deleted, leaving a broken `group.image`. Outside transactions, `confirmGroupImageUpload` and `confirmProfileImageUpload` can hang forever on a black-holed HEAD.
- Suggested fix: give `s3Client` a request handler with connection and request timeouts, or pass `abortSignal: AbortSignal.timeout(…)` on every `send` in storage.ts. For group delete, commit the DB deletion first and record the image keys for the cleanup job (as `accountDeletionCleanup` does for accounts), or at least do the storage calls before taking the lock and keep the lock only for the DB work.
- Verification: V2: stall is capped at 15 s by the transaction timeout and only hits the group being deleted. Fixed by the timeout factories in C1.
- Same issue as: D5, D7 (see Duplicate groups)

#### S3-06 · medium · bug

**Changing `S3_CDN_URL` makes every group with an image impossible to delete**

- Location: packages/api/src/lib/storage.ts:345-371 (`extractImageStorageObject` returns null unless the URL starts with the current `S3_CDN_URL`); packages/api/src/router/group/groupLifecycleRouter.ts:61-76; packages/api/src/lib/account-deletion.ts:56-58
- Failure scenario: a self-hoster moves their CDN to a new domain, or the hosted service changes CDN. Every owner who tries to delete a group that has an image gets a 500 with no way forward. Scheduled account deletions for users with imaged solo groups fail on every run. Old images are orphaned on replacement.
- Suggested fix: store the object key (or bucket and key) in the database and build the public URL when reading. Until then, document that `S3_CDN_URL` must never change, and fall back to matching the key suffix `user/<id>/uploads/group/<groupId>/avatar/<file>`.

#### S3-07 · low · security

**Shared invite codes stay valid after their creator is demoted or removed**

- Location: packages/api/src/router/group/groupMembershipRouter.ts:387-395 (demotion deletes only `groupMemberInvite`); packages/api/src/router/group/assertGroupMemberCanBeRemoved.ts:46-51 (removal deletes only email invites); packages/api/src/router/group/groupInvitesRouter.ts:115-168 (`acceptShared` doesn't check the creator's current role)
- Failure scenario: an owner removes a misbehaving admin, who has just generated a code. For up to 5 minutes, anyone with that code can still join the group as a member.
- Suggested fix: in `acceptShared`, require the creator to still be an OWNER or ADMIN of the group. Alternatively, delete the creator's unused shared invites in `updateRole` and in the removal CTE.

#### S3-08 · low · security

**An upload can claim any of the account's active devices as its sender**

- Location: packages/api/src/lib/groupTracking.ts:120-162; packages/api/src/router/group/groupTrackingRouter.ts:47-53
- Failure scenario: a session on the account's phone uploads points attributed to the account's tablet. Viewers then see the tablet somewhere it isn't, and it overrides the tablet's real `lastLocationAt`. This only works within one account, so the impact is small, but it weakens the per-device pause guarantees and audit trail.
- Suggested fix: require `point.senderDeviceId === ctx.deviceId`, or document why queued points from another device ID must be accepted. If that is needed for re-registration, accept only the session's device or a revoked predecessor that the server can map.

#### S3-09 · low · duplication

**Group list items are built by hand in three places, and `get` returns the raw Prisma row**

- Location: packages/api/src/router/group/groupMembershipRouter.ts:41-56 and 57-61; packages/api/src/router/group/groupInvitesRouter.ts:234-311; packages/api/src/router/group/groupLifecycleRouter.ts:108-166
- Failure scenario: a new field is added to one copy and not the others, or a sensitive column added to `Group` or `GroupMember` later leaks through `get` with no review.
- Suggested fix: add one `groupListItemSelect` and `toGroupListItem` helper in `types/GroupListItem.ts`. Give `get` an explicit `select`. Remove the dead check.
- Same issue as: D12 (see Duplicate groups)

### S4 Data layer and jobs

#### S4-01 · high · bug · **must-fix, see M5**

Redis client never reconnects after a short outage under traffic, so every API call fails until the backend restarts

#### S4-02 · medium · bug · **must-fix, see M10**

Deleting a heavy user's account overruns Prisma's 5 s transaction timeout, so it never completes, and each retry locks the user's groups

#### S4-03 · medium · design

**Prisma/pg pool has no connection-wait limit, no statement timeout and an unconfigurable pool size**

- Location: packages/database/src/client.ts:14-15
- Failure scenario: A slow query, a lock wait (for example behind S4-02's group locks) or a stalled S3 call inside a transaction holds connections. With only 10 per process, later requests queue for a pool slot with no limit. The API hangs instead of returning errors, and `/health` stays green.
- Suggested fix: Pass `max`, `connectionTimeoutMillis` and `idleTimeoutMillis` to `PrismaPg`, read from env with sane defaults. Set `options: "-c statement_timeout=… -c lock_timeout=… -c idle_in_transaction_session_timeout=…"`, with a longer statement timeout for the runner. Document pool sizing for self-hosters.
- Same issue as: D5, D7 (see Duplicate groups)

#### S4-04 · medium · bug

**Runner jobs have no timeouts on S3, Resend or Redis calls, and `/health` is static, so a hung call stops a job forever unnoticed**

- Location: apps/scheduled-jobs/src/scheduler.ts:26-44; apps/scheduled-jobs/src/jobs/accountDeletion.ts:49-50,63; apps/scheduled-jobs/src/jobs/imageUploadCleanup.ts:59,104,132; apps/scheduled-jobs/src/health.ts:5-13; packages/api/src/s3client.ts:4-11; packages/api/src/r2.ts:8-15; packages/email/src/transport.ts:31-36
- Failure scenario: An S3 `ListObjectVersions`/`DeleteObjects` call or a Resend request never returns, for example after a half-open TCP connection. `account-deletion` never runs again in that process, so due accounts stay undeleted, while Docker's HEALTHCHECK keeps reporting the runner healthy.
- Suggested fix: Give the S3 and R2 clients a `NodeHttpHandler` with `connectionTimeout` and `requestTimeout`, and give Resend sends an `AbortSignal.timeout`. Have the scheduler record each job's last start and finish, and make `/health` return 503 when a job has run far longer than its delay or hasn't succeeded within N intervals. Optionally run each job under a hard timeout.
- Confidence: medium (the AWS SDK and Resend defaults are from knowledge of those libraries, not tested here)
- Same issue as: D5 (see Duplicate groups)

#### S4-05 · low · design

**Account deletion failures are logged without a code, and permanent failures retry every 5 minutes forever**

- Location: apps/scheduled-jobs/src/jobs/accountDeletion.ts:30-36,53-58; apps/scheduled-jobs/src/deleteAccount.ts:15
- Failure scenario: An operator sees `Scheduled account deletion failed` every 5 minutes with no hint of the cause. The account is never deleted and nobody is told.
- Suggested fix: Log `errorCode(result.error)` or the TRPC code. After N failures, or for CONFLICT, log a distinct line, or email the owner if the conflict needs their action. Lowercase and trim the CLI email.
- Same issue as: D17 (see Duplicate groups)

#### S4-06 · low · bug

**Pending device cleanup runs one unbounded transaction, so a backlog stops the device-link and challenge cleanup too**

- Location: apps/scheduled-jobs/src/jobs/pendingDeviceCleanup.ts:7-25
- Failure scenario: Many abandoned sign-ins (abuse, or a buggy client creating Pending devices) build a backlog large enough to pass 5 s. Every hourly run then times out and rolls back, and expired device links (which hold wrapped `ciphertext`) and challenges are never cleaned.
- Suggested fix: Add `LIMIT 1000` and loop like the other jobs, and run the link and challenge deletes independently, for example in their own `tryCatch` steps.
- Confidence: medium
- Same issue as: D7 (see Duplicate groups)

#### S4-07 · low · design

**Schema constraints that Prisma doesn't see, or that are missing**

- Location: packages/database/prisma/schema.prisma:173,191 with migration.sql:621-622 (CHECK constraints); schema.prisma:140-150 (PendingUpload.groupId); schema.prisma:86-101 (Account)
- Failure scenario: Code written against the generated types handles impossible nulls, or a future migration drops the CHECK without anyone noticing. A concurrent link race inserts a duplicate Google account row, and that user can no longer sign in.
- Suggested fix: Make `memberId` and `creatorId` required and drop the CHECKs. Model user and group avatar uploads so `groupId` can be a real FK, for example a separate table or a nullable `groupId` with a surrogate id and a partial unique index. Add `@@unique([providerId, accountId])` to `Account`.

#### S4-08 · low · design

**Missing FK index on PersonalGroupNickname.targetId**

- Location: packages/database/prisma/schema.prisma:225-232
- Failure scenario: Once nicknames are widely used, member removal and account deletion get slower in proportion to the table size. This isn't urgent at beta scale.
- Suggested fix: Add `@@index([targetId])`.

#### S4-09 · low · design

**Removed devices that were ever active are kept forever with their name, model and platform**

- Location: packages/database/prisma/schema.prisma:241-275; apps/scheduled-jobs/src/jobs/pendingDeviceCleanup.ts:8-16; packages/api/src/lib/removeDevice.ts:59
- Failure scenario: The server keeps the device name, model and platform of every phone a user has ever removed until the account is deleted. That is personal operational data with no remaining purpose, and the table grows without bound.
- Suggested fix: Add the planned device clean-up. Delete revoked devices with no remaining `GroupEncryptedPayload` rows a set time after `revokedAt`, and set the history-wrap and epoch sender references to null as the FKs already allow.

#### S4-10 · low · design

**Encrypted payloads stored as base64 text, with repeated label strings, on the largest table**

- Location: packages/database/prisma/schema.prisma:358-380 (GroupEncryptedPayload), plus the key and wrap columns in GroupEpochRecipientKey and GroupEpochHistoryWrap
- Failure scenario: Storage and I/O on the hot table are about a third higher than needed, which affects the hosted bill, vacuum time and the cleanup throughput the README measures.
- Suggested fix: Consider `Bytes` (bytea) for nonce and ciphertext while keeping base64 on the wire, and enums for `kind` and `algorithm`. Converting a populated table later means a full rewrite.
- Confidence: medium (size impact estimated, not measured)

#### S4-11 · low · design

**Docs contradict the schema and the code**

- Location: apps/scheduled-jobs/README.md ("None of their `expiresAt` columns are indexed. `Session` can be large, but an index was left out on purpose…", "`image` isn't indexed"); docs/security/beta-1-privacy-draft.md:15 ("Each run deletes at most 100,000 points")
- Failure scenario: Operators and future maintainers rely on numbers and trade-offs that are no longer true. The privacy draft understates the per-run deletion limit. Either the Session index is wrong (HOT updates are lost on every refresh), or the README is.
- Suggested fix: Decide on the Session `expiresAt` index (keep it or drop it) and update the README. Fix the privacy draft's per-run figure.
- Same issue as: D20 (see Duplicate groups)

#### S4-12 · low · design

**`rateLimits.peek` ignores its `cost` input and always reports `allowed: true`**

- Location: packages/cache/src/rateLimits/rateLimits.ts:148-160; packages/cache/src/rateLimits/schemas.ts:19-25
- Failure scenario: A future caller writes `if (!(await peek(...)).allowed)` and gets no limiting at all.
- Suggested fix: Remove `cost` from the peek schema, and either drop `allowed` from the peek result or compute it as `tokens >= 1`.

#### S4-13 · low · style

**Style and AGENTS.md rule breaches in packages/cache**

- Location: - packages/cache/src/pmtilesSignedUrls/pmtilesSignedUrls.ts:45-50 and packages/cache/src/rateLimits/schemas.ts:81-86: plain `try/catch` where rule 8 prefers `tryCatch`.
  - packages/cache/src/rateLimits/testUtils.ts:1-6: JSDoc comment block (rule 1).
  - packages/cache/src/rateLimits/rateLimits.ts:11-16 (`RateLimitsDependencies`) and packages/cache/src/cache/redis.ts:3-11 (`RedisOptionsInput`): single-use type aliases (rule 10).
  - packages/cache/src/cache/redis.ts:19-45: `toRedisOptions` only strips `undefined` keys from an object zod has already validated, and is unused in production.
  - packages/cache/package.json:6: usage notes put in `description`.
  - packages/cache/package.json:19: pins `zod` `^4.3.6` while other packages use `^4.6.7`.
- Failure scenario: None functionally. This is noise for readers and AI tools that follow AGENTS.md.
- Suggested fix: Inline the single-use types, use `tryCatch`, delete `toRedisOptions` (pass the parsed options straight through), drop the comment and description text, and align the zod range.
- Same issue as: D19 (see Duplicate groups)

### S5 Supporting packages, map tiles and ops

#### S5-01 · medium · bug

**Resend email calls have no timeout, so a slow Resend stalls requests and piles up background sends**

- Location: packages/email/src/transport.ts:34, packages/email/src/transport.ts:38, packages/email/src/transport.ts:49; awaited in packages/api/src/router/accountRecoveryRouter.ts:196 and packages/auth/src/emailCode.ts:123
- Failure scenario: Resend accepts the TCP connection but never answers, as happens during a partial outage. `accountRecovery.requestReset` awaits `emailCodes.send`, which awaits `sendCodeEmail`. The request hangs until Bun's 60 s server `idleTimeout` (apps/backend/src/index.ts:68) drops the connection, and the user sees a network error even though the code row was written. Sign-up, password-reset and email-verification codes and every security alert run through `runInBackground`/`sendInBackground`, so each one leaves a pending promise for as long as Resend hangs. At startup, `checkEmail` (index.ts:18) can hang inside `checkServices`. That call is bounded at 10 s, but the hung fetch is never aborted.
- Suggested fix: Pass `{ signal: AbortSignal.timeout(15_000) }` as the second argument to `emails.send`, `domains.list` and `domains.get`. A test that a never-resolving `fetch` makes `send` reject would prevent this coming back.
- Verification: V3 confirmed a hung Resend send stays pending past 60 s and also holds up the account-deletion job. Fixed by C1.
- Same issue as: D5 (see Duplicate groups)

#### S5-02 · medium · UX

- **Status:** fixed on `fix/beta-1-review` by "Put .env.example comments on their own lines and bind compose services to localhost" (SHA added at wrap-up). C7. Config only, so no new test; the emulator script's secret substitution was updated to match and checked by hand.

**Following the docs with `docker run --env-file .env` turns the inline comments in `.env.example` into values**

- Location: .env.example:1-48 (every line with a trailing `# ...` comment); apps/map-tiles/README.md:51 (`docker run -d --name map-tiles --env-file .env ...`)
- Failure scenario: A self-hoster follows the root README (`cp .env.example .env`) and then the map tiles README (`docker run ... --env-file .env`). `MAP_TILES_PORT` and `MAP_TILES_UPDATE_INTERVAL_DAYS` fail validation (`blankAsUndefined` only drops all-whitespace values), so the service won't start. The backend image fails in the same way on `BETTER_AUTH_URL`, `TRUSTED_PROXY_PROVIDER` and `SMTP_PORT`. One case is quieter: if `TRUSTED_PROXY_PROVIDER=cloudflare-authenticated` is written on a clean line but `CLOUDFLARE_ORIGIN_SECRET` is left as in the example, the secret becomes the public comment text. That text is over 32 characters, so it passes `z.string().min(32)`, and anyone who reads the repo can forge the origin-secret header.
- Suggested fix: Move every comment in `.env.example` onto its own line above the variable, or split it into per-container env examples with comments on separate lines. Optionally refuse env values that contain `#` after whitespace.

#### S5-03 · medium · security

- **Status:** fixed on `fix/beta-1-review` by "Put .env.example comments on their own lines and bind compose services to localhost" (SHA added at wrap-up). C7. Config only, so no new test; the emulator script's secret substitution was updated to match and checked by hand.

**docker-compose publishes Postgres (with a known password) and Dragonfly (with no auth) on every interface**

- Location: docker-compose.yml:4-9, docker-compose.yml:18-22
- Failure scenario: A developer on shared Wi-Fi, or a self-hoster who reuses this file on a VPS, exposes the whole database (accounts, emails, device names, wrapped keys) to anyone who tries `openbeacon:openbeacon`. Redis can be read or flushed, which resets rate limits and email caps.
- Suggested fix: Bind to loopback (`"127.0.0.1:5432:5432"`, `"127.0.0.1:6379:6379"`), use `restart: unless-stopped`, and add a comment at the top of the file saying it is for development only.

#### S5-04 · medium · UX

**There is no working self-hosting path in the README**

- Location: README.md:49-57 ("Run the backend"), README.md:61-69, README.md:136-148 (R2 required); apps/map-tiles/src/r2.ts:15 and packages/api/src/r2.ts:10 (hard-coded R2 endpoint)
- Failure scenario: Someone follows the README on a home server. They end up with a development-mode server on HTTP, with no guidance on HTTPS, migrations in production (handled only in the backend's docker-entrypoint.sh), the runner, or that the map stays blank until a 130 GiB transfer to a Cloudflare bucket finishes.
- Suggested fix: Add a "Self-hosting" section, or link the docs site, with a production compose file (backend, runner, map tiles, Postgres and Redis on an internal network, with only the proxy exposed), a Caddy/nginx TLS example, the secrets to generate, and the cost of the map. Longer term, make `R2_ENDPOINT` configurable so MinIO or another S3 store works, and consider making map tiles optional.
- Confidence: medium (user-facing docs may live in the separate OpenBeacon-Docs repo, which I did not review)

#### S5-05 · low · security

**The map tiles service's localhost API accepts cross-site POSTs**

- Location: apps/map-tiles/src/server.ts:66-71, apps/map-tiles/src/server.ts:96-126
- Failure scenario: An operator runs `bun run map-tiles serve` locally and visits a hostile page. The page `fetch`es `http://127.0.0.1:8080/rollback` (no body needed), or `/update` with `{"force":true}`. That rolls the live map back, or reinstalls a rolled-back build and starts a 130 GiB transfer. DNS rebinding would also expose `/status`.
- Suggested fix: Require `content-type: application/json` on POSTs (which forces a preflight the server never approves), and reject requests whose `Host` isn't `127.0.0.1:<port>`.
- Confidence: medium

#### S5-06 · low · design

**API input schemas mix `z.strictObject` and `z.object`, so additive fields break older servers on some routes**

- Location: packages/schemas/src/schemas/auth/accountRecovery.ts:26-68 (strict) and registerDeviceKey.ts:66 (strict) vs. every other input schema (`z.object`, which strips unknown keys)
- Failure scenario: A future app adds an optional field to `accountRecovery.changeRecoveryPhrase` without raising `minServerApiCompatibilityLevel`, as the rules allow for additive changes. Every server still on the old version answers BAD_REQUEST, and users can't change their recovery phrase.
- Suggested fix: Pick one policy and document it in docs/development/api-compatibility.md. Either use `z.object` everywhere, or keep strict objects but state that any new input field needs a `minServerApiCompatibilityLevel` raise.
- Confidence: medium
- Same issue as: D13 (see Duplicate groups)

#### S5-07 · low · bug

**Inconsistent length limits on IDs and passwords; the client accepts passwords the server rejects**

- Location: packages/schemas/src/schemas/account/fields.ts:8-10 (`passwordSchema` has no max), changePassword.ts:5; group/tracking.ts:34,42,46,51 (`groupId`, `cursor.id` have no max); group/removeMember.ts:5-7 (`groupId`, `memberId`, `successorMemberId` have no max); group/inviteMember.ts:6 (`groupId: z.string()` with no min or max); auth/accountRecovery.ts:65 (`groupId` has no max)
- Failure scenario: A user picks a 150-character passphrase in a password manager. The sign-up form accepts it and the server answers with a generic error, so the user doesn't know why sign-up failed. Unbounded IDs let a member send megabyte-long strings into Prisma `where` clauses and logs. This is harmless today but inconsistent.
- Suggested fix: Add `.max(128)` to `passwordSchema` with a clear message, matching better-auth's limit. Add a shared `idSchema = z.string().min(1).max(128)` to `@openbeacon/schemas` and use it for every ID field, including the inline copies in packages/api routers.
- Same issue as: D14 (see Duplicate groups)

#### S5-08 · low · security

**Name validation is inconsistent: account and group names allow bidi overrides, and group names allow control characters**

- Location: packages/schemas/src/schemas/account/fields.ts:11-18, packages/schemas/src/schemas/group/create.ts:9-11, compared with packages/schemas/src/schemas/account/devices.ts:6-13
- Failure scenario: A group member renames themselves with a bidi override so that their name displays like another member's. Or a group name carries control characters that break rendering or end up in server logs as terminal escapes.
- Suggested fix: Move the device-name refine (`/[\p{Cc}\p{Cs}]|(?!‍)\p{Cf}/u`) into one shared `displayNameRefine`, apply it to account, device and group names, and add tests.
- Same issue as: D14 (see Duplicate groups)

#### S5-09 · low · bug

**turbo's strict env mode silently drops several backend and map-tiles variables exported in the shell**

- Location: turbo.json:3-39
- Failure scenario: `OPENBEACON_API_PORT=4000 bun run dev --filter=@openbeacon/backend` still listens on 3000. `TRUSTED_PROXY_PROVIDER=trusted-proxy bun run dev` is ignored with no warning, which is confusing when testing proxy setups.
- Suggested fix: Add the missing names to `globalPassThroughEnv`, or generate the list from the env schemas in a test so it can't drift.
- Confidence: medium

#### S5-10 · low · design

**The backend Docker image ships devDependencies and test files, and base images aren't pinned by digest**

- Location: Dockerfile:15-17, Dockerfile:26, .dockerignore:6; apps/map-tiles/Dockerfile (unpinned `apt-get install ca-certificates curl`)
- Failure scenario: The image is larger and has a bigger attack surface than it needs (the TypeScript toolchain, types, test files), and a re-tagged base image changes the build without any repo change.
- Suggested fix: Move `prisma` to a dependency of `@openbeacon/database` (or install it in a separate stage) and install with `--production`. Add `**/*.test.tsx` to `.dockerignore`. Optionally pin base images by `@sha256:` digest.

#### S5-11 · low · design

**Empty optional env values are handled inconsistently, and the README documents the trap rather than fixing it**

- Location: apps/backend/src/envSchema.ts:23-24 (`OPENBEACON_API_PORT`, `OPENBEACON_API_HOSTNAME` have no empty-to-undefined preprocessing); README.md:69; compare packages/email/src/config.ts:6-18, apps/map-tiles/src/env.ts:6-12, packages/schemas/src/env.ts:3-10
- Failure scenario: An operator blanks `OPENBEACON_API_PORT=` in Coolify to "use the default", and the backend won't start.
- Suggested fix: Export one `emptyAsUnset` preprocessor from `@openbeacon/schemas`, use it for every optional env var except `TRUSTED_PROXY_PROVIDER`, and drop the README caveat.

#### S5-12 · low · bug

**`check-version-bump` asks only for a server bump when the root catalog or overrides change the app's dependencies**

- Location: scripts/check-version-bump.ts:5-18
- Failure scenario: Someone bumps `catalog.react` and the CI check passes with only a server bump. The app ships changed code under the same `expo.version`, `buildNumber` and `versionCode`, so the store upload is rejected or two different builds share one version.
- Suggested fix: Treat a change to the root `package.json` as both client and server, or parse the diff and require a client bump when `catalog` changes. Add a test case.
- Confidence: medium
- Same issue as: D21 (see Duplicate groups)

#### S5-13 · low · design

**The email package creates its own Redis client and reads the environment at import time**

- Location: packages/email/src/index.ts:13-48
- Failure scenario: A process that only needs `renderEmail` or the types still opens Redis and validates SMTP settings. A bad `SMTP_PORT` crashes at import with a t3-env error instead of the backend's tidy `validateEnv` output (the backend avoids this only because `validateEnv.ts` imports `config.ts` directly).
- Suggested fix: Export a `createEmail({ env, rateLimits })` factory and build it once in the backend and runner composition roots, passing in the existing cache's `rateLimits`.
- Same issue as: D6 (see Duplicate groups)

#### S5-14 · low · style

**The shared tsconfig base has dead or overridden options**

- Location: packages/tsconfig/base.json:8-9,19
- Failure scenario: None at runtime. It misleads anyone who reads the base config about what is in force.
- Suggested fix: Remove the decorator options and set `skipLibCheck: true` in the base, then drop the per-package overrides.

#### S5-15 · low · style

**Small `.env.example` and README gaps**

- Location: .env.example:39-42; README.md:14
- Failure scenario: A self-hoster leaves R2 blank and the backend fails validation on start.
- Suggested fix: Mark R2 as required, group variables by container, and fix the typo.

### S6 Mobile: tracking, sharing and native

#### S6-01 · high · bug · **must-fix, see M4**

Cold app launch stops sharing and wipes native keys before permissions load; offline, sharing stays off

#### S6-03 · medium · bug

**Queue rows the server permanently rejects are retried forever and never leave the queue**

- Location: apps/mobile/lib/tracking.ts:608-649, :535-541; apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/CiphertextQueueDao.kt:83-97; packages/api/src/procedures/auth/group.ts:12-14; packages/api/src/lib/groupTracking.ts:156-173
- Failure scenario: A user leaves a family group while 2,000 points for it are queued from a day offline. Those rows fail with FORBIDDEN on every flush, every ≤5 minutes for as long as the app is installed. Each failure makes `syncBackgroundTracking` throw, and the rows hold queue space until eviction. Rows from an old device ID, kept after re-registration, behave the same way.
- Suggested fix: Treat "not a member", "device not registered" for a device that isn't this one, and a single-item BAD_REQUEST as terminal: delete those rows, or move them to a failed state that is purged. When reconcile finds that a group has disappeared from membership, delete its queued rows. Add a test for each terminal error.
- Same issue as: D22 (see Duplicate groups)

#### S6-04 · medium · bug

**Several start paths stop the service before `startForeground` after `startForegroundService`, which Android treats as a crash**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingCaptureService.kt:116-120, :136-144, :204-211; OpenBeaconTrackingModule.kt:70-111; SharingResumeWorker.kt:144-162; TrackingBootReceiver.kt:194-208
- Failure scenario: Sign-out, or a permission-driven `reconcile({startCapture:false})`, runs right after `startCapture`. JS calls `stopService` before the service promotes, and the app crashes. The same happens when permission changes between the boot receiver's or resume worker's check and `onStartCommand`.
- Suggested fix: On every branch reached by a `startForegroundService` intent, call `startForeground` with the paused or idle notification before `stopSelf`, as the indefinite-pause branch already does. Alternatively, mark foreground starts with an extra and always promote when it is present. Avoid `stopService` from JS while a foreground start is pending: send an `ACTION_STOP` intent instead (the action exists but is never used).
- Confidence: medium

#### S6-05 · medium · design

**High-accuracy GPS runs every 30 s all day even when the phone isn't moving**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingCaptureService.kt:227-251, :385-394; CaptureSamplingPolicy.kt:127-153, :172-173
- Failure scenario: A phone on a desk or nightstand keeps GPS active through the day and night for a heartbeat that is queued only every 5 minutes. On many devices that is the largest battery cost of the app, and it is the usual reason people uninstall location sharing apps.
- Suggested fix: When stationary (several fixes within 25 m), drop to `PRIORITY_BALANCED_POWER_ACCURACY` or `PRIORITY_LOW_POWER` with a longer interval and `setMaxUpdateDelayMillis` for batching. Switch back to high accuracy on movement, using hysteresis (for example, enter moving at 1.5 m/s and leave below 0.5 m/s across two fixes), or the Activity Recognition transition API. Extend `CaptureSamplingPolicyTest` to cover the hysteresis.

#### S6-06 · medium · bug

**A sharing change the server will never accept blocks uploads forever**

- Location: apps/mobile/lib/locationSharing.ts:164-198, :87-89; apps/mobile/lib/tracking.ts:747; apps/mobile/components/LocationSharingCard.tsx:179-182; packages/schemas/src/schemas/account/locationSharing.ts:38-41
- Failure scenario: A phone whose clock is more than a day fast pauses before it has ever synced, or after its offset key was cleared. Every retry gets BAD_REQUEST, uploads stop for good, and the queue fills to 10 MiB and starts evicting. After a resume, the card says "We'll update your groups when you're back online" while the phone is online.
- Suggested fix: In `synchronizeSharing`, run the `locationSharing` query (and measure the offset) even when a replay fails. Drop a pending change on terminal codes (BAD_REQUEST, NOT_FOUND, FORBIDDEN) and reload state, as "superseded" already does. Show a distinct "couldn't apply" message rather than the offline copy.
- Confidence: medium
- Same issue as: D22, D23 (see Duplicate groups)

#### S6-07 · medium · security

**Points captured after a group key rotation can still be encrypted to the old epoch and are accepted indefinitely**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/CapturePipeline.kt:38-92; apps/mobile/lib/tracking.ts:665, :843-845; packages/api/src/lib/groupTracking.ts:134-145, :224-229
- Failure scenario: A member is removed and the group rotates. A phone that is offline for a day keeps encrypting fixes with the old epoch key, which the removed member still holds, and uploads them when it reconnects. The server stores them under the old epoch. A removed member working with the hosted operator can decrypt a day of locations captured after the removal. Online, the window is about one upload interval. Removal-triggered rotation exists to prevent exactly this.
- Suggested fix: After provisioning a new epoch, re-encrypt or drop queued rows for the old epoch whose plaintext timestamp is after the new epoch's `createdAt`. The phone still holds the old key, so it can decrypt to check. Alternatively, have the server reject old-epoch uploads once the successor epoch was created for a removal and is older than some grace period. Coordinate with S1/S3.
- Confidence: medium
- Same issue as: D2 (see Duplicate groups)

#### S6-08 · medium · UX

**Location services off, or no fixes arriving, goes unnoticed while the notification says "Sharing your location"**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingCaptureService.kt:237-247, :489-522
- Failure scenario: The user turns off Location in quick settings to save battery. The foreground service keeps running with "Sharing your location. End-to-end encrypted…", no fixes arrive, and the family sees a stale pin. Neither side is told why.
- Suggested fix: Watch location availability and provider changes. While location is off, change the service notification to "Location is off. Your groups can't see where you are", and dismiss the warning when location comes back.

#### S6-09 · medium · bug

**`java.time.Instant` in the capture path crashes on Android 7 (minSdk 24, no desugaring)**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/CapturePipeline.kt:46; TrackingCaptureService.kt:404-434, :465-469
- Failure scenario: On an Android 7.0 or 7.1 phone, the first fix crashes the app, and START_STICKY restarts capture into the same crash.
- Suggested fix: Pass `location.time` (epoch ms) into `onFix` and drop the format/parse round trip. Alternatively, raise minSdk to 26 to match the research note's test targets, and say so in the docs.
- Confidence: medium

#### S6-02 · low · UX

- **Status:** fixed on `fix/beta-1-review` by "Build the app for Android only" (SHA added at wrap-up). Q9 (Beta 1 only; S6-02 is a must-fix again for the first iOS release). Config only, so no new test; `expo config` shows `platforms: ['android']`. The beta docs note lands with C8.

**iOS build asks for Always location and says "Sharing enabled", but iOS never captures or uploads**

- Location: apps/mobile/app.json:7, :22-26, :48-56; apps/mobile/lib/trackingModule.ts:3-6; apps/mobile/components/LocationSharingCard.tsx:153-163; apps/mobile/providers/LocationPermissionProvider.tsx:202-224; apps/mobile/modules/openbeacon-tracking/expo-module.config.json:2
- Failure scenario: A family member installs the iOS build, grants Always location and sees "Sharing enabled on this device". The rest of the family see them as "waiting for location" forever, and they are never told why. In a family-safety product, that false sense of coverage is the worst outcome. App Store review is also likely to reject a declared background location mode that is never used.
- Suggested fix: Either leave iOS out of the beta, or gate the iOS UI. On iOS, skip the background and precise location prompts, and make the sharing card say "Location sharing from iPhone isn't available yet. You can still see your groups". Remove `isIosBackgroundLocationEnabled` until there is an iOS capture implementation.
- Verification: V4: iOS is not in Beta 1 (privacy draft says Android only; no eas.json). Must be fixed before any iOS release.

#### S6-10 · low · bug

- **Status:** fixed on `fix/beta-1-review` by "End every session on the phone through one endSession table" (SHA added at wrap-up). Q3. Table-driven `endSession.test.ts` pins what each reason clears across 13 kinds of state; lost-session tests cover same account, different account, and the 30-day expiry; JVM and Robolectric tests for `deleteByOwner` (IN_FLIGHT rows). Owner decision 13 Nov 2026: `signedOut` also records the lost marker, so a signed-out account's keys are wiped after 30 days or when a different account signs in. The 7-day delete option uses `signedOut`; "delete immediately" uses `accountDeleted`. Emulator check in the end-of-branch batch.

**Sign-out and wipe leave IN_FLIGHT queue rows behind**

- Location: apps/mobile/lib/tracking.ts:938-954; apps/mobile/lib/signOut.ts:72-77; apps/mobile/lib/deviceRemoved.ts:33-34; queue/RoomCiphertextQueue.kt:394-402
- Failure scenario: The phone is removed or wiped mid-upload. A few ciphertext rows survive the wipe. If the same account signs in again, they upload under a revoked sender device and join the S6-03 retry loop. They are ciphertext only, so nothing leaks, but "wipe" isn't complete.
- Suggested fix: Add a native `deleteByOwner(owner)` that ignores status, and use it for wipe and held-back sign-out.

#### S6-11 · low · design

**Approximate-only location is handled differently by JS and native**

- Location: apps/mobile/lib/locationPermissions.ts:87-106; apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/TrackingRuntime.kt:162-168
- Failure scenario: A user switches to Approximate in Android settings. Background capture restarts and shares obfuscated fixes. Then the app opens and sharing turns off entirely, with only an account warning. The behaviour depends on which side ran last.
- Suggested fix: Pick one rule. Either share approximate fixes (recommended; `android-device-support.md` lists it as a choice users make), or make `hasLocationPermission` in Kotlin require fine location.
- Same issue as: D27 (see Duplicate groups)

#### S6-12 · low · bug

**Race between `stopCapture` and an interval change can leave an orphaned GPS request**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingCaptureService.kt:286-299 vs :385-394, :227-251
- Failure scenario: A rare race leaves the fused location request registered after the service is destroyed. Fixes are discarded, but GPS keeps running until the process dies.
- Suggested fix: Do the callback removal and `isCaptureRunning = false` in the same locked block, and have `requestLocationUpdates` check `isCaptureRunning` before registering.
- Confidence: medium

#### S6-13 · low · bug

**Epoch keys saved with `apply()`, and a keystore failure silently empties them while the notification still says sharing**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/keys/SecureEpochKeyStore.kt:24-27, :39-48; CapturePipeline.kt:38-41
- Failure scenario: After a keystore problem, such as the key being invalidated on some OEM builds after a lock-screen change, capture keeps the "Sharing your location" notification but queues nothing until the next JS key check notices `hasKeys` is false.
- Suggested fix: Use `commit()` for both. Cache the decrypted list in memory, invalidating it on write. When the list can't be read, stop capture or show a notice instead of silently dropping fixes.
- Confidence: medium
- Same issue as: D3 (see Duplicate groups)

#### S6-14 · low · bug

**Unknown battery level is sent as 0%**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/BatteryReader.kt:12-28; TrackingCaptureService.kt:410-411; crypto/GroupPayloadEncrypt.kt:65-75
- Failure scenario: The battery broadcast is unavailable (sticky intent `null`) and family members see "0%" for that person.
- Suggested fix: Send `null` for an unknown level. This changes the plaintext format, so check the decoder and the test vectors with S10 first.
- Same issue as: D4 (see Duplicate groups)

#### S6-15 · low · style

**Docs describe a 30-second remote check that no longer exists**

- Location: docs/development/location-sharing.md ("During a timed pause it checks for remote preference changes every 30 seconds while awake"); TrackingCaptureService.kt:310-319
- Failure scenario: Support and self-hosters expect a remote resume to reach a paused phone within 30 seconds. It can take about 5 minutes.
- Suggested fix: Update the doc to "about every five minutes, subject to Android scheduling".
- Same issue as: D20 (see Duplicate groups)

#### S6-16 · low · style

- **Status:** fixed on `fix/beta-1-review` by "Patch hono and better-auth, declare superjson in the app, drop unused deps" (SHA added at wrap-up). C5 (the dependency half of X-09; the zod catalog and the rest of X-09 stay post-beta). No new test: `bun audit` no longer lists hono, `bun run ci` and 320 integration tests pass.

**Dead and test-only code shipped, plus an unlisted dependency**

- Location: queue/InMemoryCiphertextQueue.kt and keys/InMemoryEpochKeyStore.kt (main source set, only used by tests and the benchmark); TrackingCaptureService.kt:111-115, :544 (`ACTION_STOP` never sent); apps/mobile/lib/locationPermissions.ts:181, :214-215 (`requestForegroundLocationPermissions` exported only for the one-line alias `requestLocationPermissionsForLaunch`); `LocationPermissionStatus`/`LocationPermissionRequirement` exported but unused (knip); `superjson` imported by `lib/locationSharing.ts` and `lib/api.ts` but missing from `apps/mobile/package.json` (knip "unlisted")
- Failure scenario: Test doubles ship in the APK. `superjson` resolves only through hoisting, so a workspace change can break the encoding of the stored sharing queue.
- Suggested fix: Move the in-memory doubles to the test source sets. Either use `ACTION_STOP` (see S6-04) or delete it. Collapse the alias. Add `superjson` to the mobile dependencies with `bun add`.
- Same issue as: D8, D18 (see Duplicate groups)

#### S6-17 · low · UX

**Copy inconsistencies in tracking prompts**

- Location: apps/mobile/providers/TrackingProvider.tsx:112; apps/mobile/providers/LocationPermissionProvider.tsx:217-223, :239
- Failure scenario: The brand name is inconsistent, and users who expect Settings to open get a system dialog instead.
- Suggested fix: Use "Open Beacon". Label the button "Continue" when `canRequestBackgroundInApp` is true.
- Same issue as: D9 (see Duplicate groups)

### S7 Mobile: live map

#### S7-01 · medium · design

**Every idle poll re-renders the whole map screen, even when nothing changed**

- Location: apps/mobile/lib/mapTracking.ts:493-497 (poll), :449-453 (getLatest); apps/mobile/hooks/useLiveTrackingPositions.ts:38-40; apps/mobile/app/(tabs)/map/index.tsx:216-288; apps/mobile/components/map/NativeMap.tsx:360
- Failure scenario: A user in 3 groups with the map open and nobody moving gets about 3 full screen re-renders every 5 s, each rebuilding every marker and pin. This is wasted CPU and battery on the screen people leave open longest, and it gets worse as groups and members grow.
- Suggested fix: In `mapTracking`, only notify when the sharing state actually changes (compare deviceId, paused and revisionPrefix) or positions change, and keep `getLivePositions()`/`getStatus()` referentially stable between changes (cache the last result). Memoise `devices` in index.tsx, and memoise the style string together with `mapStyle` in `useNativeMapStyle`.

#### S7-02 · medium · UX

**The "Can't reach the server" warning only appears inside the people tray**

- Location: apps/mobile/components/map/LiveMapPeopleTray.tsx:64-70; apps/mobile/lib/classifyMapPeople.ts:25; apps/mobile/app/(tabs)/map/index.tsx:142-151
- Failure scenario: The phone goes offline or the server goes down while the map is open. Polls back off to 60 s, but pins keep showing the last known positions with no warning. The clock badge only appears once a location is 10 minutes old. Someone checking where a family member is right now can be shown stale data with nothing on screen to say so.
- Suggested fix: Show a small banner in the map overlay (next to the paused and key banners in index.tsx) whenever `trackingStatus.connection === "failing"` or `membership === "failed"`, whatever the tray state.
- Same issue as: D11 (see Duplicate groups)

#### S7-03 · medium · UX

**A map that fails to load shows only a spinner, forever, with no explanation**

- Location: apps/mobile/components/map/NativeMap.tsx:323-346, 478-485; apps/mobile/components/map/useNativeMapStyle.ts:200-221; apps/mobile/hooks/useSignedPmtilesUrl.ts:24-25
- Failure scenario: The user opens the app with no signal, or a self-hosted server has a broken R2/PMTiles config. The map tab spins indefinitely, gives no hint that the network or server is the problem, offers no retry, and even the people list is unavailable.
- Suggested fix: After a short delay or N failures, replace the spinner with copy ("Can't load the map. Check your connection.") and a Retry button wired to `retryUrl`/`retryMapLoad`. Consider rendering the people tray without the base map.
- Same issue as: D11 (see Duplicate groups)

#### S7-04 · medium · bug

**Signed PMTiles URL refresh ignores server clock offset and misses tile-level expiry**

- Location: apps/mobile/hooks/useSignedPmtilesUrl.ts:18-23; apps/mobile/lib/pmtilesUrl.ts:1-14; apps/mobile/components/map/useNativeMapStyle.ts:82-103; packages/api/src/lib/pmtilesUrl.ts:11,29
- Failure scenario: A phone whose clock runs more than 60 s slow, or a minute of flaky network around refresh time, lets the signed URL expire while the map is open. Panning or zooming into new areas then gives blank tiles with no error and no forced refresh until the next scheduled refetch succeeds. Upstream MapLibre reports that errored tiles can stay blank even after recovery (docs/research/map-rendering.md, "tile retry report").
- Suggested fix: Compute the delay with `serverNow()`, or have the server return a relative `refreshInMs`. Widen the refresh window to several minutes. Also treat tile HTTP 403 log lines as a load failure that triggers `forceRefreshSignedPmtilesUrl`.
- Confidence: medium
- Same issue as: D23 (see Duplicate groups)

#### S7-05 · low · bug

**A position with a future timestamp pins that device's marker until the screen remounts**

- Location: apps/mobile/lib/liveMapReducer.ts:17-31 (`isNewerThan`)
- Failure scenario: A phone's clock jumps a day ahead (manual time, a mock-location app, a GPS glitch) and uploads one point, then the clock is corrected. Every later real point loses the comparison, so the map shows the old position, labelled "just now", until the user leaves the tab or restarts the app. A separate edge case: within the same second, string comparison orders "…:00Z" after "…:00.5Z".
- Suggested fix: Compare with `Date.parse`, and ignore or cap sender timestamps more than a few minutes beyond server `createdAt` (or beyond `serverNow()`) when ranking.
- Confidence: medium
- Same issue as: D23 (see Duplicate groups)

#### S7-06 · low · design

**Groups with no visible points call getLatest every 5 seconds indefinitely**

- Location: apps/mobile/lib/mapTracking.ts:466-475 (coldTick), 531-534
- Failure scenario: A user's family group with everyone paused, open on the map, makes the heavier LATERAL-join `getLatest` query, plus the sharing-state query, every 5 s instead of the cheap cursor poll. Across many hosted users this adds server load and radio wake-ups.
- Suggested fix: Have `getLatest` return the group's current max cursor, even when there are no visible points, and switch to `live` with it. Alternatively, back off cold retries when results stay empty.

#### S7-07 · low · style

**Dead hooks and wrappers around useLiveTrackingPositions**

- Location: apps/mobile/hooks/useGroupLivePositions.ts:1-4; apps/mobile/hooks/useLiveTrackingPositions.ts:15,28-36; apps/mobile/hooks/useMapLivePositions.ts:1-3
- Failure scenario: Readers follow the dead group-scoped path and assume it is used. It would also start a second polling session with its own epoch-key cache if anyone wired it up.
- Suggested fix: Delete `useGroupLivePositions.ts` and the `groupId` option, and either import `useLiveTrackingPositions` directly or rename it to `useMapLivePositions`.
- Same issue as: D18 (see Duplicate groups)

#### S7-08 · low · style

**Test harness lives in components/ and two refresh comments describe the wrong platform**

- Location: apps/mobile/components/map/nativeMapTestHarness.tsx; apps/mobile/components/map/LiveMapPointAnnotation.tsx:54; apps/mobile/components/map/LiveMapMarkerPin.tsx:104
- Failure scenario: A future maintainer removes the refresh thinking it is Android-only legacy, or ships the harness by importing it from a non-test file.
- Suggested fix: Move the harness to `apps/mobile/test/` and fix the two comments to say iOS ViewAnnotation snapshots.
- Same issue as: D18 (see Duplicate groups)

#### S7-09 · low · UX

**No empty state on the map for users with no groups or no visible people**

- Location: apps/mobile/app/(tabs)/map/index.tsx:316-348; apps/mobile/components/map/LiveMapPeopleTray.tsx:300-332
- Failure scenario: A new user who skips group creation, or who has left every group, opens Map and sees a blank world map with nothing to explain why.
- Suggested fix: When `groups?.length === 0`, overlay a short message with a Link to create or join a group. Give the tray a "No one to show yet" line.
- Same issue as: D11 (see Duplicate groups)

#### S7-10 · low · UX

**Every group defaults to the same pink ring, so multi-group rings collapse to one colour**

- Location: apps/mobile/lib/groupColor.ts:39-45; apps/mobile/lib/buildLiveMapMarkers.ts:61-67
- Failure scenario: A user in "Family" and "Friends" cannot tell from ring colour which group a pin comes from, which defeats the point of ring colours and multi-colour rings.
- Suggested fix: Default to a deterministic palette index from a hash of the group id, still overridable by the encrypted per-user colour.
- Confidence: medium

#### S7-11 · low · style

**Map research docs are out of date**

- Location: docs/research/map-rendering.md:9; docs/research/map-asset-distribution.md:11-12
- Failure scenario: Someone triaging map rendering bugs relies on the wrong library version and asset story.
- Suggested fix: Add a dated "superseded" note, or update the two paragraphs.
- Same issue as: D20 (see Duplicate groups)

### S8 Mobile: auth, setup, account and plumbing

#### S8-01 · high · security · **must-fix, see M3**

Switching server sends the old server's session cookie and raw session token to the new server

#### S8-02 · medium · bug · **must-fix, see M9**

A server URL with a trailing slash or path passes the check, then every API call 404s

#### S8-03 · medium · security

**Plain `http://` server URLs are accepted, but release builds will likely block them, and they would send passwords and session tokens in clear text**

- Location: apps/mobile/app/serverUrl.tsx:30-41, apps/mobile/app.json:27-35
- Failure scenario: A self-hoster enters `http://192.168.1.10:3000`. In a release build, the health check fails with "Couldn't reach this server", they tap "Save anyway", and nothing ever connects. If a build did allow cleartext, the password at sign-in, email codes and the session cookie would cross the network unencrypted. E2E still protects locations, but not the account.
- Suggested fix: Require `https://`, except for `localhost` and `10.0.2.2` in development builds. Say why in the error message, and point to the README's reverse-proxy guidance.
- Confidence: medium
- Same issue as: D16 (see Duplicate groups)

#### S8-04 · medium · UX · **must-fix, see M9**

The launch screen retries forever with no message or way out when the device check fails

#### S8-05 · medium · security

**Any route can be opened by deep link, including the setup "Remove devices" screen, which ticks every other device and blocks Back**

- Location: apps/mobile/app/+native-intent.tsx:4-7, apps/mobile/app/setup/remove-devices.tsx:28-33, apps/mobile/app/setup/remove-devices.tsx:39, apps/mobile/app/setup/remove-devices.tsx:48-64, apps/mobile/app/_layout.tsx:47-71
- Failure scenario: A crafted link sent in a chat opens "Remove devices you no longer have", with all of the user's other phones and tablets ticked and no way back. If the user taps the big red button within the fresh-session window, every other device is removed, and each one wipes its keys and queued locations the next time it connects.
- Suggested fix: Allow-list deep-link paths in `redirectSystemPath` (`join`, and auth callback paths) and map everything else to `/`. In `remove-devices`, start with nothing ticked or ask for confirmation, and only allow the screen when it's reached from a just-completed reset (for example, a one-shot in-memory flag).
- Same issue as: D10 (see Duplicate groups)

#### S8-06 · medium · security

- **Status:** fixed on `fix/beta-1-review` by "End every session on the phone through one endSession table" (SHA added at wrap-up). Q3. Table-driven `endSession.test.ts` pins what each reason clears across 13 kinds of state; lost-session tests cover same account, different account, and the 30-day expiry; JVM and Robolectric tests for `deleteByOwner` (IN_FLIGHT rows). Owner decision 13 Nov 2026: `signedOut` also records the lost marker, so a signed-out account's keys are wiped after 30 days or when a different account signs in. The 7-day delete option uses `signedOut`; "delete immediately" uses `accountDeleted`. Emulator check in the end-of-branch batch.

**Deleting the account only signs out; it leaves the device key, history keys and queued points on the phone**

- Location: apps/mobile/app/account/delete.tsx:314-331
- Failure scenario: A user picks "Delete immediately". Their account and server data are gone, but the phone keeps their history private keys and any unsent encrypted points until the app is uninstalled. That contradicts what the user expects of deleting an account in a privacy-first app. The 7-day option can keep the keys, so that cancelling by signing in still works, but immediate deletion has no reason to.
- Suggested fix: For `immediate`, run `wipeAfterRemovingThisPhone()` (or `wipeThisPhone`) before signing out. For the 7-day path, at least clear the pending join codes and pending sharing changes, and say on screen that this phone keeps its keys until deletion completes.

#### S8-07 · medium · UX

**Join accepts an invite without saying which group or who will see your location**

- Location: apps/mobile/app/join.tsx:29-52, apps/mobile/app/join.tsx:62-115
- Failure scenario: Someone sends a stranger, or a child on a family account, an invite link. They tap it and press the only button. Their live location now goes to an unknown group, with no confirmation step that says so.
- Suggested fix: Fetch the acceptance context first. Show a confirmation that says location sharing will start and how many members the group has, and require a deliberate "Join and share my location" tap.
- Confidence: medium

#### S8-08 · low · bug

**ConfirmIdentity with a different Google account signs that account up**

- Location: apps/mobile/components/ConfirmIdentity.tsx:356-360, apps/mobile/components/ConfirmIdentity.tsx:322-331, apps/mobile/lib/auth.ts:168-175
- Failure scenario: A user with two Google accounts picks the wrong one at "Confirm it's you". The server creates a new OpenBeacon account for that Google identity, with no device and no history key, and leaves it orphaned. The user is signed out and sees "Signed in to a different account".
- Suggested fix: Check identity without creating a user, for example a server endpoint that verifies the ID token against the current user. Or pass a flag that stops sign-up for this call.
- Confidence: medium

#### S8-09 · low · security

- **Status:** fixed on `fix/beta-1-review` by "Turn off Android cloud backup" (SHA added at wrap-up). C4. Config only, so no new test; `expo config --type introspect` shows `android:allowBackup="false"` in the manifest.

**Android Auto Backup is on by default and backs up native tracking preferences**

- Location: apps/mobile/app.json:27-35
- Failure scenario: A user moves to a new phone with Google's transfer tool. The new install starts with `capture enabled = true` and the old phone's device ID and queue owner, before the app has been opened or signed in. How the boot receiver behaves then is S6's area, but the state is stale at best. Any future secret put in plain SharedPreferences would also be backed up silently.
- Suggested fix: Set `"android": { "allowBackup": false }`, since nothing in the app is useful to restore. Or ship explicit `dataExtractionRules` that exclude everything.
- Confidence: medium
- Same issue as: D1 (see Duplicate groups)

#### S8-10 · low · UX

**No not-found route: unknown deep links and the Google deletion callback land on Expo's default "Unmatched route" screen**

- Location: apps/mobile/app/+native-intent.tsx:4-7, apps/mobile/app/account/delete.tsx:347, apps/backend/src/routes/auth.ts:16
- Failure scenario: After verifying with Google, or when a mistyped or old `openbeacon://…` link is opened, the user may see Expo's developer-style unmatched-route page instead of the app.
- Suggested fix: Add `+not-found.tsx` that redirects to `/`. In `redirectSystemPath`, map `google-deletion` (and any other callback paths) to the current screen or `/`.
- Confidence: medium
- Same issue as: D10 (see Duplicate groups)

#### S8-11 · low · bug

**Auth client timeout stops at response headers; a stalled body hangs sign-in**

- Location: apps/mobile/lib/auth-client.ts:29-35
- Failure scenario: A proxy or overloaded self-hosted server sends headers and then stalls. `signIn.email`, `get-session` or `signUp` never settle, so the "Signing in…" button spins until the app is killed.
- Suggested fix: Keep the timer running until the body is consumed. For example, read `await response.clone().arrayBuffer()` inside the timed section and return a new `Response` from it, or drop the custom signal handling and let better-fetch own the timeout.
- Confidence: medium
- Same issue as: D5 (see Duplicate groups)

#### S8-12 · low · bug

**A sign-in that fails after the session exists leaves the user signed in on the sign-in screen; retrying creates another session**

- Location: apps/mobile/app/signIn.tsx:75-86, apps/mobile/app/signUp.tsx:327-342, apps/mobile/app/forgotPassword.tsx:85-99
- Failure scenario: On a flaky connection, a user taps Sign In three times. They end up with three live sessions on the server, two of which nothing will ever revoke. Each one may also trigger the "new sign-in" alert.
- Suggested fix: When setup fails after a successful sign-in, either `router.replace("/")` (index retries registration) or sign out to drop the session. Don't leave a signed-in user on the sign-in form.
- Same issue as: D26 (see Duplicate groups)

#### S8-13 · low · UX

**Recovery setup and change don't block Back while saving, unlike restore and reset**

- Location: apps/mobile/app/account/recovery-setup.tsx:78, apps/mobile/app/account/recovery-change.tsx:55
- Failure scenario: A user presses Android Back during "Setting up…" or "Protecting your history". The work continues off-screen. They never see "Your phrase is set up" or the "some history couldn't be protected" message, and they can't tell whether the words they wrote down are now live.
- Suggested fix: Use the same `BackHandler` and `Stack.Screen gestureEnabled` pattern as restore and reset (see the refactor note about a shared hook).

#### S8-14 · low · UX

**Setup screens show "couldn't reach the server" when the real problem is a lost session**

- Location: apps/mobile/app/setup/index.tsx:155-165, apps/mobile/app/_layout.tsx:47-71
- Failure scenario: The account owner signs out other sessions or changes the password from their main phone while the new phone sits on `/setup`. The new phone shows "We couldn't reach the server. Check your connection" with a Try again button that never works. Only "Cancel and remove this phone" gets out.
- Suggested fix: In the setup screens, redirect to `/` when `useSession()` is settled and null. Or map UNAUTHORIZED to "You've been signed out" with a sign-in button.
- Confidence: medium
- Same issue as: D11 (see Duplicate groups)

#### S8-15 · low · UX

**Copy and small UX inconsistencies across auth and account screens**

- Location: apps/mobile/app/account/add-device.tsx:112; apps/mobile/app/setup/index.tsx:40; apps/mobile/app/serverUrl.tsx:99-101; apps/mobile/components/ApiCompatibilityGate.tsx:128-132; apps/mobile/app/(tabs)/account/overview.tsx:108-110; apps/mobile/app/account/devices.tsx:118,194; apps/mobile/app/(tabs)/account/overview.tsx:233-296; apps/mobile/app/device-removed.tsx:11-15; apps/mobile/app/index.tsx:136; apps/mobile/app/account/delete.tsx:409-444; apps/mobile/app/account/password.tsx:86-102
- Failure scenario:
- Suggested fix: Fix the strings, use `thisDeviceNoun()` everywhere, hide or remove Help Center until it exists, give the Update button a store link (or explain how beta testers update), and add loading states.
- Same issue as: D9, D11 (see Duplicate groups)

#### S8-16 · low · style

- **Status:** fixed on `fix/beta-1-review` by "Patch hono and better-auth, declare superjson in the app, drop unused deps" (SHA added at wrap-up). C5 (the dependency half of X-09; the zod catalog and the rest of X-09 stay post-beta). No new test: `bun audit` no longer lists hono, `bun run ci` and 320 integration tests pass.

**AGENTS.md rule breaches and dependency hygiene in scope**

- Location: apps/mobile/lib/server-url.ts:5,9,17; apps/mobile/app/index.tsx:19,66; apps/mobile/app/serverUrl.tsx:20,32; apps/mobile/app/(tabs)/_layout.tsx:11; apps/mobile/lib/apiCompatibility.ts:142; apps/mobile/providers/ThemeProvider.tsx:15-24; apps/mobile/app/index.tsx:143-157, apps/mobile/app/signIn.tsx:213-219, apps/mobile/app/signUp.tsx:279-285; apps/mobile/package.json (superjson)
- Failure scenario:
- Suggested fix: Convert to arrow functions, use `tryCatch`, inline the context type, use `Link`, and `bun add superjson` in `apps/mobile`.
- Same issue as: D8, D19 (see Duplicate groups)

### S9 Mobile: groups, UI kit and components

#### S9-01 · medium · bug

- **Status:** fixed on `fix/beta-1-review` by "Reset the group screen when switching to another group" (SHA added at wrap-up). C12. Tested in `groupScreen.test.tsx`: the dismissed warning and selected tab reset when `groupId` changes.

**Group screen state carries over from one group to the next (unsaved rename can hit the wrong group)**

- Location: apps/mobile/app/(tabs)/groups/[groupId]/index.tsx:53-57; apps/mobile/app/(tabs)/groups/[groupId]/SettingsTab.tsx:282,302-317; apps/mobile/app/(tabs)/groups/[groupId]/MembersTab.tsx:39-52
- Failure scenario: An admin opens group A and goes to Settings. They type "Grandparents" in the rename box, don't save, and go back. Then they open group B. The screen opens on Settings, the field still says "Grandparents", and the placeholder now shows B's name. "Save name" renames group B. Separately, dismissing the history warning for group A can hide group B's warning, because the in-memory dismissal time takes priority over B's stored value.
- Suggested fix: Render the group body with `key={groupId}`. A simple way is to split `GroupScreen` into a wrapper that reads params and an inner component keyed by `groupId`. Moving group detail into a stack (see S9-02) also fixes it.
- Confidence: medium

#### S9-03 · medium · UX

**Groups list shows "No groups yet" when loading fails; group page "Try again" can do nothing**

- Location: apps/mobile/app/(tabs)/groups/list.tsx:28-55,245-286; apps/mobile/app/(tabs)/groups/[groupId]/index.tsx:85-127; apps/mobile/hooks/useCachedGroup.ts:4-19
- Failure scenario: The server is down, or a self-hoster's box is offline, while the phone has internet. A user with three groups opens the app and is told they have no groups and should create one. Some will create a duplicate group. If they reach a group page by deep link, "Try again" does nothing and the copy says "not found" when the real problem is the network.
- Suggested fix: Add an error state to list.tsx ("Couldn't load your groups" + Retry → `refetch()`), shown when `isError && !data`. On the group page, tell "failed to load" apart from "not a member": the retry should call `refetch()` on the list query, and the copy should say the group couldn't be loaded.
- Same issue as: D11 (see Duplicate groups)

#### S9-04 · medium · bug

- **Status:** fixed on `fix/beta-1-review` by "Stop a member removal or leave being submitted twice" (SHA added at wrap-up). C11. Tested in `memberNicknames.test.tsx`: a second confirm during the epoch build doesn't submit, and Remove/Leave stay disabled until it finishes.

**Remove member and Leave group can be submitted twice while the new epoch is being built**

- Location: apps/mobile/app/(tabs)/groups/[groupId]/MembersTab.tsx:115-149,380-389; apps/mobile/lib/groupEncryption.ts:51-67,135-159
- Failure scenario: An owner taps Remove on Alice and confirms. On a slow network nothing visible happens for a second or two, so they tap Remove again (or remove Bob). Two epoch builds start from the same `latestEpoch`. The second submission fails with "Unable to update group" (stale epoch or member not found), or a second leave runs after the screen has already navigated away.
- Suggested fix: Wrap `confirmRemoval`'s onPress in `useSingleFlight` keyed by member id. Disable the remove/leave buttons and show `loading` on the pressed one while the flight is pending.
- Same issue as: D26 (see Duplicate groups)

#### S9-05 · medium · UX

**Theme text colours fail contrast: `text-muted` in dark mode, `text-muted-foreground` in light mode**

- Location: apps/mobile/global.css:13-14,54-55; 38 uses of `text-muted` (e.g. MembersTab.tsx:431-477, TabBar.tsx:72, ui/Card.tsx:52 `CardDescription`, list.tsx:255, account/overview.tsx:471, signIn/signUp/forgotPassword/serverUrl/index, map sheets); 142 uses of `text-muted-foreground`
- Failure scenario: In dark mode, the member card's "Location updated 3 min ago", "Battery unavailable", inactive tab-bar labels and every `CardDescription` (e.g. "3 members") come out dark purple on near-black. In light mode, every `text-muted-foreground` description (dialog descriptions, settings section labels, field descriptions) is light grey on lavender. Both are hard to read outdoors or with low vision.
- Suggested fix: In dark mode, raise `--muted` to about 65–70% lightness, or stop using `muted` as a text colour. Give `--muted-foreground` a light-mode value of about 40–45% lightness. Pick one "secondary text" token and use it everywhere: today `text-muted`, `text-muted-foreground` and `text-secondary` are mixed with no clear rule.

#### S9-06 · medium · bug

**Image upload PUT has no timeout; the avatar spinner can stay forever**

- Location: apps/mobile/lib/image-upload.ts:18-34; apps/mobile/components/image/EditableImage.tsx:97-134
- Failure scenario: The phone moves into a dead zone during the PUT, or a self-hosted S3/MinIO stops answering. The group or profile avatar shows a spinner with the edit button disabled until the app restarts, and no error ever appears. The presigned URL expires after 5 minutes anyway, so waiting longer can't succeed.
- Suggested fix: Pass `AbortSignal.timeout(60_000)`, or a value under the 5-minute presign lifetime, to the fetch, and map an abort to "Upload timed out. Try again."
- Confidence: medium
- Same issue as: D5 (see Duplicate groups)

#### S9-02 · low · bug

**MembersTab, SettingsTab and HistoryTab are routable screens**

- Location: apps/mobile/app/(tabs)/groups/[groupId]/MembersTab.tsx, SettingsTab.tsx, HistoryTab.tsx; apps/mobile/app/+native-intent.tsx:4-7
- Failure scenario: The link `openbeacon://groups/<id>/SettingsTab` (or a mistyped internal link) renders `SettingsTab` with `groupId` undefined. The screen has no back button and no group. MembersTab fires `listMemberDevices({ groupId: undefined })`, which the server rejects. It also gives a confusing route tree to anyone adding screens later.
- Suggested fix: Move the three tab components to `components/groups/`, or anywhere outside `app/`, and import them from there.
- Same issue as: D10 (see Duplicate groups)

#### S9-07 · low · UX

**Invite dialog content can't scroll; many email rows push "Send invitation" off-screen**

- Location: apps/mobile/components/dialogs/InviteMemberToGroupDialog.tsx:37-67,129-170; apps/mobile/components/ui/Dialog.tsx:46-83
- Failure scenario: An owner adds 6–8 emails on a small phone, or 3–4 with the keyboard open. The top and bottom of the dialog are clipped, and "Send invitations" can't be reached without deleting rows.
- Suggested fix: Give `DialogContent` an optional `scroll` mode, as `AlertHost` does, and use it for the invite dialog. Or cap the visible email list in a ScrollView.
- Confidence: medium

#### S9-08 · low · design

**Pull-to-refresh refetches the entire query cache**

- Location: apps/mobile/components/RefreshablePage.tsx:7-11
- Failure scenario: A user pulls to refresh on the groups list after visiting five groups. The app fires a dozen or more requests and decrypts nickname payloads again, on a battery-sensitive app that has deliberately cut its request count (see OPE-281/285). If the server is down, the spinner stops and nothing tells the user it failed.
- Suggested fix: Pass `{ type: "active" }`, or have each page pass its own query keys. Show an inline error or toast when any of those refetches fail.

#### S9-09 · low · UX

**Owner who leaves must always pick a successor, even when another owner exists**

- Location: apps/mobile/app/(tabs)/groups/[groupId]/MembersTab.tsx:96-102
- Failure scenario: A group has two owners. One leaves and is forced to pick a "new owner". If they pick a plain member, that member gets promoted to owner for no reason. The Continue button won't proceed until they choose.
- Suggested fix: Skip the successor dialog when another member already has role `OWNER`.

#### S9-10 · low · UX

**Accessibility: small touch targets, unlabelled icon buttons, fixed heights that clip scaled text**

- Location: components/headers/BackButton.tsx:7-16 and ReturnToHomeHeader.tsx (14 px icon + "Back" text, no padding or hitSlop, about 20 dp tall); components/image/EditableImage.tsx:39,45,157-166 (edit button 24 dp for `sm`, 32 dp for `md`, which the group header uses); components/dialogs/InviteMemberToGroupDialog.tsx:161-166 (trash `Pressable` with no `accessibilityLabel` or role); components/ui/Dialog.tsx:51-58 (close button has no `accessibilityLabel`/role and relies on a `sr-only` Text); components/TabBar.tsx:54-71 (no `accessibilityRole="tab"` or `selected` state); components/ui/Button.tsx:20-23 and ui/Tabs.tsx:19,41 (fixed `h-14`/`h-10`/`h-9` heights)
- Failure scenario: The Back link on every account sub-page and on the group page is hard to hit, especially one-handed. TalkBack reads the invite row's delete button as just "button". At 200% font size, the labels in the invite dialog's "Email / Link / Code / QR code" tabs and in `size="sm"` buttons get clipped.
- Suggested fix: Give BackButton `min-h-11` and `hitSlop`. Make the edit badge's hit area at least 44 dp (`hitSlop` is enough). Add labels and roles to the trash, dialog-close and tab-bar items. Change fixed `h-*` on Button and TabsList to `min-h-*` with vertical padding.

#### S9-11 · low · style

**Hard-coded colours bypass the theme tokens**

- Location: app/(tabs)/groups/list.tsx:336 (`bg-gray-100` overflow-member chip, a light grey blob in dark mode); app/(tabs)/groups/[groupId]/SettingsTab.tsx:85,114 (`bg-red-700 dark:bg-red-700` + `text-white` override the destructive variant); app/(tabs)/groups/[groupId]/index.tsx:144-145 (amber-600/400/700 instead of the existing `warning-*` tokens); app/join.tsx:111 (`dark:text-white` on a secondary button); components/ui/SwipeTabs.tsx:225 (`#0F0C1A`/`#EEE6FA`); components/image/EditableImage.tsx:138 (`border-white` ring in dark mode); components/OfflineBanner.tsx:19 (`#b91c1c`); lib/theme.ts:24-58 (a second hex palette that duplicates `global.css`)
- Failure scenario: The destructive "Delete group" button is red-700, while destructive alert buttons are `bg-destructive` (and `/60` in dark mode). The overflow chip and the white avatar ring don't follow dark mode. Changing the brand palette means editing `global.css`, `lib/theme.ts` and SwipeTabs separately.
- Suggested fix: Use `variant="destructive"` with no override, use `bg-secondary` for the chip and the `warning`/`warning-border`/`warning-text` tokens for the history card, and read SwipeTabs' track colour from a token. Keep one palette source: derive `getColors` from the CSS variables or the other way round.

#### S9-12 · low · design

**Dead code in the UI kit and related modules (knip results verified)**

- Location: - `components/ui/Accordion.tsx`: whole file unused (no importers), plus the `@rn-primitives/accordion` dependency and the `accordion-down/up` keyframes in tailwind.config.js:71-82
  - `components/ui/Text.tsx:8-23,34-46`: none of the `variant` values (h1–h4, p, blockquote, code, lead, large, small, muted) is used anywhere, so the `ROLE`/`ARIA_LEVEL` maps are dead too
  - `components/ui/Button.tsx`: sizes `lg` and `icon` unused; exports `buttonTextVariants`, `buttonVariants`, `ButtonProps` not imported elsewhere
  - `components/ui/Card.tsx`: `variant: "warning"`, `cardVariants`, `CardFooter` unused
  - `components/ui/Dialog.tsx`: exports `DialogClose`, `DialogTrigger`, `DialogPortal`, `DialogOverlay` unused outside the file
  - `components/ui/Field.tsx`: `FieldSet`, `FieldLegend`, `FieldGroup`, `FieldContent`, `FieldTitle`, `FieldSeparator` unused; `font-sans-medium` is not a defined class
  - `components/ui/Select.tsx`: `SelectLabel`, `SelectSeparator` unused
  - `components/ui/swipeTabs.ts:28-47`: `getActiveSceneHeight` used only by its test (SwipeTabs no longer sizes the active scene, see S9-14)
  - `components/ui/Input.tsx:9-10,29,34` and `formInputs/FormSelectInput.tsx:24-25,40,42-43`: `hideError` and `descriptionPosition` props accepted and ignored; FormSelectInput also swallows `onBlur`/`onFocus`
  - `components/image/EditableImage.tsx:17,33-34`: `showEditButton` prop unused; `pickerOpen`/`isLoading` duplicate `isUploading`
  - `tailwind.config.js:54`: `on-primary` colour refers to an undefined `--on-primary` variable and is unused (it has a TODO comment)
  - `global.css:5`: `@custom-variant dark` is Tailwind v4 syntax and does nothing under Tailwind 3.4; `--card` and `--card-foreground` are declared twice in `:root` (lines 10-11 and 33-34); `--chart-*`, `--popover*` and `--accent*` are used only by unused kit parts
  - Exported only for local use: `InviteMembersInputs`, `GroupInvitesList`, `GroupList`, `computeSha256Base64`, `uploadToPresignedUrl`
  - Not dead, despite knip: `expo-image` and `expo-glass-effect` are dependencies of `expo-router@55` and probably need to stay for autolinking. Check before removing.
- Failure scenario: Dead variants and props suggest features that don't exist. For example, `hideError` silently does nothing, and AI tools copy unused shadcn patterns into new code.
- Suggested fix: Delete Accordion and its dependency and keyframes, the unused variants and exports, the ignored props and the duplicate CSS variables. Drop `export` from symbols used only in their own file.
- Same issue as: D18 (see Duplicate groups)

#### S9-13 · low · duplication

**The same UI is rebuilt inline in several places**

- Location: - Screen header (SafeAreaView + BackButton + `text-2xl` title, `border-b px-6 py-4`) copied in 18 screens: account/* (16), setup/link.tsx:239, setup/waiting.tsx:28. Group detail puts BackButton inside a card with no title bar, the Account tab centres its title, and Groups uses a left-aligned `text-3xl` title with no bar.
  - Raw `TextInput` with copied classes instead of a non-form input: SettingsTab.tsx:294-301, MembersTab.tsx:184-190 (the nickname input lacks the placeholder colour classes, so the placeholder uses the platform default in dark mode), join.tsx:97-105. `ui/Input` only works with react-hook-form.
  - Radio lists: MembersTab successor picker (250-264), the role segmented control (299-355), account/theme.tsx:63 and `ui/RadioCardGroup`.
  - Tabs: `ui/Tabs.tsx` (rn-primitives, used only by the invite dialog) and `ui/SwipeTabs.tsx` look different.
  - Warning cards: group page amber card (index.tsx:136-175), `PromptCard` in account/overview.tsx:127, notifications.tsx:94 and the unused `Card variant="warning"`.
  - Avatar initials: list.tsx:308,330 (`charAt(0)+charAt(1)` upper-cased), MembersTab.tsx:418 (`slice(0,2)`, not upper-cased). Both split surrogate pairs, so an emoji-first name renders a broken glyph.
  - Loading: join.tsx:67 shows a plain "Loading..." string, while every other screen uses `LoadingIndicator`.
- Failure scenario: Styling drifts between copies (the missing placeholder colour above, mixed initial casing), and every theme or a11y fix has to be made N times.
- Suggested fix: Add a `ScreenHeader` component (title + optional back) and a plain `TextField`. Use `RadioCardGroup` or one segmented control for role, successor and theme. Use `Card variant="warning"` (or `PromptCard` moved into `components/`) for warnings. Add one `initials(name)` helper using `Array.from(name)`.

#### S9-14 · low · UX

**SwipeTabs pages are as tall as the tallest tab**

- Location: apps/mobile/components/ui/SwipeTabs.tsx:293-319; components/ui/swipeTabs.ts:28-47
- Failure scenario: In a group with 10 members, after the Members tab has been visited, the History and Settings tabs have a long empty scroll area below their content inside the page's vertical scroll.
- Suggested fix: Measure each scene and set the pager's height to the active scene's height (wire `getActiveSceneHeight` back in), or delete the helper if the current behaviour is accepted.
- Confidence: medium

#### S9-15 · low · UX

**Join code is a 32-character hex string with no grouping, and the share link only works on the default server**

- Location: apps/mobile/components/dialogs/SharedInvite.tsx:77-91; apps/mobile/app/join.tsx:29-34
- Failure scenario: A parent reads the code aloud to a child: 32 hex characters with no separators, so transcription errors are likely. Or the child types it with spaces and gets "Enter the complete join code". When the inviter self-hosts, an invitee on the default hosted server gets "Unable to join" plus a server message, with no hint that they need to change server first.
- Suggested fix: Show the code in groups of 4. Strip whitespace and dashes before validating. Mention the server in the share text when it isn't the default, or add the server to the link and handle it in `+native-intent`.
- Confidence: medium

#### S9-16 · low · UX

**Copy and small UI inconsistencies in group screens**

- Location: list.tsx:61,290 ("Your Groups" title and an identical section heading); list.tsx:315 (`{n} members`, which gives "1 members"); MembersTab.tsx:426 (role shown raw as "OWNER" while the role picker says "Owner"); CreateGroupDialog.tsx:85-86 ("privately; All", "end to end") and :97 ("Group Name" label vs "Group name" elsewhere); CreateGroupDialog.tsx:90-92 and account/overview.tsx:343-346 (camera icons that look tappable but do nothing); SharedInvite.tsx:31 ("Unable to create invitation" drops the server reason, unlike every other alert); `text-md` (not a Tailwind class) in MembersTab.tsx:431-437 and InviteMemberToGroupDialog.tsx:131,182; HistoryTab ships a "Timeline coming next" placeholder while the group page warns about history the user can't view anywhere; settingsContainer.tsx:41-55 (disabled rows still show a chevron and give no reason)
- Failure scenario: Small things that make the beta look unfinished. The fake camera button gets tapped and nothing happens. A user can't tell why "Password" is greyed out on iOS.
- Suggested fix: Fix the strings and pluralisation, title-case roles, remove the decorative camera icons (or make them open the picker), pass `error.message` through, replace `text-md` with `text-base`, hide the History tab until it has content, and add a one-line reason under disabled settings rows.

#### S9-17 · low · design

**`ui/Input` spreads the RHF `field` (including `onChange`) onto TextInput**

- Location: apps/mobile/components/ui/Input.tsx:35-38; components/formInputs/FormSelectInput.tsx:65-73
- Failure scenario: Today the final value is correct because React batches the two updates. But any `watch`/`useWatch` subscriber or async resolver sees a transient `undefined`, which makes field-level side effects flaky and hard to debug.
- Suggested fix: Pass only `value`, `onBlur` and `ref` from `field` (not `onChange`). Give FormSelectInput its own props type, and have it use `undefined` rather than "N/A".
- Confidence: medium

#### S9-18 · low · style

**AGENTS.md style rules broken across the kit and group screens**

- Location: `function` declarations (rule 9): ui/Accordion, Avatar, Button, Card, Field, Icon, Input, Select, Separator, Tabs, Text; lib/cn.ts:4; components/BeaconIcon.tsx:6; app/(tabs)/groups/list.tsx:27; app/(tabs)/_layout.tsx:11; app/index.tsx:66; app/serverUrl.tsx:20. Single-use `interface`/`type …Props` (rule 10b): list.tsx:123,240; CreateGroupDialog.tsx:26; InviteMemberToGroupDialog.tsx:21,71; EditableImage.tsx:14; BeaconIcon.tsx:3 (`type Props`); Field.tsx:9 (`FieldContextValue`); FormSelectInput.tsx:15. Comments (rule 1): ui/Icon.tsx:23-42 (JSDoc copied from the registry, with a non-existent `@/registry` import path), lib/image-upload.ts:87 (cleanup comment), tailwind.config.js:54 (TODO). `components.json` points the shadcn CLI at `@/components` and `@/lib/utils` aliases that don't exist and don't use `.ts` suffixes (rule 7), so `npx … add` output won't compile as is.
- Failure scenario: New code copies the kit's style.
- Suggested fix: Convert to arrow functions, inline the single-use prop types, drop the comments, and either fix `components.json` aliases or delete the file.
- Same issue as: D19 (see Duplicate groups)

#### S9-19 · low · design

**`tailwind-merge` v3 is paired with Tailwind CSS v3**

- Location: apps/mobile/package.json (`tailwind-merge ^3.5.0`, `tailwindcss ^3.4.17`); lib/cn.ts
- Failure scenario: `cn()` may resolve conflicts wrongly for classes whose names or groups changed between v3 and v4 (shadow, ring, blur scales, some renamed utilities), so a `className` override sometimes doesn't override. This is hard to spot because the result is a style that is only slightly off.
- Suggested fix: Pin `tailwind-merge@^2` while on NativeWind 4 / Tailwind 3.
- Confidence: medium

### S10 Version skew and encrypted formats

#### S10-02 · medium · design · **must-fix, see M8**

The tracking-point reader rejects any extra field, so every future change to the location payload will force the whole family to update

#### S10-03 · medium · UX · **must-fix, see M11**

The "Update Open Beacon" screen has a disabled Update button and the server can't send users any guidance, and every installed build keeps this behaviour

#### S10-04 · medium · bug

**A "too old" result taken from a missing procedure flips on and off, because only same-level mismatches stick**

- Location: apps/mobile/lib/apiCompatibility.ts:35-46 (`decideUnknownProcedure`), :174-207 (`applyVerdict`), :43-46 in ApiCompatibilityGate.tsx (foreground refresh)
- Failure scenario: The app and server disagree after a missed bump. Each time the app comes to the foreground, the gate disappears after `/health`, then comes back as soon as a screen calls the missing procedure. Background uploads start and stop the same way. Tests only cover the sticky same-level case. This logic is the safety net for our own mistakes (S10-01 was one), and beta installs will keep whatever version they ship with.
- Suggested fix: Save where the verdict came from. When it came from `UNKNOWN_PROCEDURE` or a 426, keep it until the user presses Try again or the server's `version` changes, as `outOfSync` already works. Add a test for each level ordering.
- Verification: V4: worse than reported, because every API response's level headers also clear it. Cheap; see C3.

#### S10-05 · medium · design

**CI can't catch API-narrowing mistakes, and the version check can be bypassed by merge order**

- Location: scripts/check-version-bump.ts:6-12, 87-115, 199-229; .github/workflows/pre-merge-checks.yml:60-76 and 151-158; .github/pull_request_template.md:5; AGENTS.md rules 13a, 13c, 14e
- Failure scenario: A future PR tightens an input or removes an output field the app reads, ticks "unchanged", and every check passes. Self-hosters and older apps then break with generic errors that the handshake can't attribute to a version (same pattern as S10-01).
- Suggested fix: Snapshot the API surface: `z.toJSONSchema(input, { io: "input", unrepresentable: "any" })` for every procedure in `appRouter._def.procedures`, plus the procedure list and the testVectors file list, committed as JSON. Fail CI when the snapshot changes without a matching `API compatibility:` line in the PR body. That forces a decision rather than automating it. Run the version check in `merge_group` against `github.event.merge_group.base_sha`. Add `packages/database/prisma/schema.prisma` to the client paths, or move the shared enums into `packages/schemas`. Fix the wording of rule 13c.
- Same issue as: D21 (see Duplicate groups)

#### S10-06 · medium · design

**The compatibility rules miss two kinds of skew: new fields on loose schemas, and the better-auth surface**

- Location: docs/development/api-compatibility.md:20-31 and 50-56; apps/backend/src/routes/trpc.ts:13-21; apps/backend/src/routes/auth.ts:20-27; packages/schemas (all inputs except accountRecovery and history wraps are loose `z.object`)
- Failure scenario: Someone follows the doc and adds an optional guard field the app relies on for correctness, with no level change. Apps then misbehave silently against self-hosted servers that haven't updated.
- Suggested fix: Extend rule 1 and rule 14a: "…or a new input the app needs the server to act on, whether or not the schema is strict." Write down one strict/loose convention (for example, strict only inside cryptographic bundles) and say why. Either return the frozen `UNKNOWN_PROCEDURE` body for unknown `/api/auth/*` paths too, or document that auth endpoints must never be added without a minServer bump. Fix the table.
- Same issue as: D13 (see Duplicate groups)

#### S10-01 · low · bug

**`setLocationSharing` started requiring `requestedAt` without a level bump, so level-4 apps 1.10.0 and 1.11.0 can no longer pause or resume**

- Location: packages/schemas/src/schemas/account/locationSharing.ts:13 (`requestedAt: z.date()`), packages/api/src/router/accountRouter.ts:65, packages/shared/src/apiCompatibilityLevel.ts:1-3, apps/mobile/lib/locationSharing.ts:59-66
- Failure scenario: A tester on 1.11.0 (the release APK on pixel_8c, for one) talks to the current server (0.12.0 or later). Pausing or resuming sharing fails with a validation error and no "update" screen. Separately, a pending change that a 1.10/1.11 install saved offline has no `requestedAt`, so `readPendingChange` drops it silently after the upgrade to 1.12 (`parseStored` fails, then `storage.remove`).
- Suggested fix: Either raise `apiCompatibilityLevel` and `minClientApiCompatibilityLevel` to 5 before any beta build ships (rule 14b), or make `requestedAt` optional on the server and default it to the server's `now`. Bumping is cleaner while no public installs exist. Add a level-history row either way. S10-05 covers stopping this class of mistake.
- Verification: V5: 1.10.0/1.11.0 never left development. Record the narrowing in the level history; fix the process gap with S10-05.

#### S10-07 · low · design

**Four server procedures are no longer called by any app, and two of them return more than they need to**

- Location: packages/api/src/router/authRouter.ts:53-70 (`listMyDeviceKeys`), packages/api/src/router/group/groupEpochRouter.ts:122-147 (`listRecipientPublicKeys`), packages/api/src/router/group/groupMembershipRouter.ts:57-61 (`get`), :81-98 (`members`)
- Failure scenario: The extra surface has to be secured, rate-limited and kept compatible for no benefit, and `get` will expose future `Group` columns without anyone reviewing them.
- Suggested fix: Delete all four in one PR, with "API compatibility: unchanged" and a note in the PR body that the newest app that called them was at level 2. Also see S10-10.
- Same issue as: D12, D18 (see Duplicate groups)

#### S10-08 · low · bug

**The Kotlin tracking-point encoder doesn't validate the way the TS encoder does**

- Location: apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/crypto/GroupPayloadEncrypt.kt:65-75, capture/TrackingCaptureService.kt:356-360
- Failure scenario: A device with a misbehaving GPS provider uploads points that no family member can read.
- Suggested fix: In `encodeTrackingPointV1Json`, write `null` for non-finite speed and skip non-finite coordinates. Add a JVM test with NaN and Infinity inputs.
- Confidence: medium (I didn't confirm that Android can deliver a non-finite speed)
- Same issue as: D4 (see Duplicate groups)

#### S10-09 · low · UX

**Unknown crypto versions show error messages that blame the user, not "update the app"**

- Location: apps/mobile/lib/recovery.ts:221-235, packages/encryption/src/deviceLink.ts:59-71, packages/encryption/src/personalData.ts:94-95
- Failure scenario: After a future format change, a user with an older app is told their correct recovery phrase is wrong.
- Suggested fix: Check for unknown versions or algorithms before comparing, and say "Update Open Beacon to use this". This is cheap to add now while every reader is new.

#### S10-10 · low · design

**Some mutations return whole database rows, so a migration silently changes their API output**

- Location: packages/api/src/router/group/groupSettingsRouter.ts:34 (`rename` returns `tx.group.update`), packages/api/src/router/group/groupMembershipRouter.ts:396-399 (`updateRole` returns the full `GroupMember`), :60 (`get`)
- Failure scenario: A later migration adds an internal or sensitive column to `Group` or `GroupMember`, and it ships in API responses unreviewed.
- Suggested fix: Return `{}` or an explicit `select` from these mutations.
- Same issue as: D12 (see Duplicate groups)

### X Cross-cutting

#### X-01 · medium · design

- **Status:** fixed on `fix/beta-1-review` by "End every session on the phone through one endSession table" (SHA added at wrap-up). Q3. Table-driven `endSession.test.ts` pins what each reason clears across 13 kinds of state; lost-session tests cover same account, different account, and the 30-day expiry; JVM and Robolectric tests for `deleteByOwner` (IN_FLIGHT rows). Owner decision 13 Nov 2026: `signedOut` also records the lost marker, so a signed-out account's keys are wiped after 30 days or when a different account signs in. The 7-day delete option uses `signedOut`; "delete immediately" uses `accountDeleted`. Emulator check in the end-of-branch batch.

**No single owner for "end this session on this phone"; six entry points each clear a different subset of local state**

- Location: apps/mobile/lib/deviceRemoved.ts:21-49 (`wipeThisPhone`); apps/mobile/lib/signOut.ts:39-86 (`signOutOfThisPhone`); apps/mobile/providers/SessionDataCleanup.tsx:22-34; apps/mobile/providers/TrackingProvider.tsx:171-176; apps/mobile/lib/deviceRemoved.ts:68-80 (`checkThisPhoneAfterSessionLoss`); apps/mobile/app/account/delete.tsx:314-331; apps/mobile/components/ConfirmIdentity.tsx:55-56; apps/mobile/app/serverUrl.tsx (server switch: no cleanup); apps/mobile/lib/auth-client.ts:9,47-51 (SecureStore with default accessibility)
- Failure scenario: (a) A user with a phone and a tablet deletes their account from the phone. `requestDeletion` deletes all sessions (accountRouter.ts:356) but doesn't revoke devices. The tablet's next request gets UNAUTHORIZED, not DEVICE_REMOVED. The tablet treats this as an ordinary session loss (`checkThisPhoneAfterSessionLoss` only forgets the registration record) and keeps the device private key, every History private key (versions 1 to N), the queued ciphertext and the pending sharing change. When the deletion completes 7 days later, nothing on the tablet ever runs again to remove them. S8-06 covers only the phone that pressed Delete. (b) Every bug in this area so far (S8-01, S8-06, S6-10) is a path that forgot one row of the table. The next feature that adds local state (Places, for example) has to be added to five places, and nothing fails when one is missed.
- Suggested fix: Add one `endSession({ reason })` in `lib/` with reason `signedOut | phoneRemoved | accountDeleted | serverChanged | sessionLost`, driven by a single table like the one above. Make the five entry points call it. Scope every credential and per-account key family by `[serverOrigin, userId]` through one key-builder module, and give credentials `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. On `sessionLost`, keep keys, but record `{userId, lostAt}`. On the next sign-in by a different account, or after 30 days with no sign-in, wipe the previous user's key material. Add a table-driven test that checks each reason against the expected keys.
- Same issue as: D16 (see Duplicate groups)

#### X-02 · medium · design

**Errors have no machine-readable identity: the app branches on overloaded HTTP-style codes and on English message text**

- Location: packages/api/src/trpc.ts:79-122 (a `cause` with only 3 values); apps/mobile/lib/tracking.ts:609-647 (upload classifier, message match at :625); apps/mobile/lib/groupEncryption.ts:62 (`HISTORY_RECIPIENT_MISMATCH_MESSAGE`, exported from packages/schemas); apps/mobile/app/setup/link.tsx:161; apps/mobile/lib/needsFreshSignIn.ts:3-4; apps/mobile/lib/recovery.ts:48-49,152,286,331-336; apps/mobile/app/account/add-device.tsx:49-53; apps/mobile/app/account/sign-out-others.tsx:36; docs/development/api-compatibility.md (error identity not listed as API surface)
- Failure scenario: Someone fixes S6-03 by making "not a member" terminal (delete queued rows). With today's signals, the uploader can only tell that apart from "device not registered" by message text, so the fix either matches more English strings or drops rows on any FORBIDDEN. A later server copy edit, or an S2-03 change that rewrites messages, then makes old apps either delete rows they should keep or keep retrying rows forever. The same applies to the S6-06 fix (terminal versus transient sharing changes).
- Suggested fix: Extend the existing `cause` mechanism into a shared `ErrorReason` string union in packages/shared, for example `NOT_GROUP_MEMBER`, `GROUP_GONE`, `DEVICE_NOT_REGISTERED`, `FRESH_SIGN_IN_REQUIRED`, `RECOVERY_CHANGED`, `ALREADY_MEMBER`, `STALE_WRITE`, `SOLE_OWNER` and `HISTORY_RECIPIENT_MISMATCH`. Set it through a typed `cause` class, the way `DeviceRemovedError` works, and send it in `data.reason`. The change is additive, so no level bump is needed. Give the app one `errorReason(error)` helper, delete the six local classifiers, and stop comparing message text. Add "error reasons are API surface; never repurpose one" to docs/development/api-compatibility.md and to the S10-05 snapshot.
- Same issue as: D22 (see Duplicate groups)

#### X-03 · medium · UX

**Server and library error text reaches users verbatim; failure copy and offline detection are re-invented per screen**

- Location: 50 lines in apps/mobile that show an `error.message` in `Alert.alert` or inline text; 26 of the files are in app/ and components/ (for example app/join.tsx:45, app/(tabs)/groups/[groupId]/SettingsTab.tsx:49,99, MembersTab.tsx:146,227,330, app/account/devices.tsx:52, app/setup/name.tsx:66, app/account/delete.tsx:47, app/account/recovery-_.tsx, components/dialogs/_); apps/mobile/lib/serverUnreachable.ts (one shared string, used by 2 modules)
- Failure scenario: A 1.12 app talks to a self-hosted 0.11 server, or a future server tightens an input. The user taps "Save name" and gets an alert whose body is a block of JSON with `"code": "invalid_type"`. During a Redis blip they instead get "Connection closed". With the server down, the Groups tab says "No groups yet" (S9-03) while the Account tab says "Couldn't reach the server". Each screen behaves differently for the same fault.
- Suggested fix: Add `lib/userMessage.ts` that maps an error to copy. Use X-02's reason when present. Map no `data`, a timeout or a 5xx to one offline string, map BAD_REQUEST with `zodError` to "This app and server don't agree. Update the app or try again later.", and fall back to the server message only for 4xx with a known reason. Replace the 50 `error.message` uses. Add `ErrorState` (message + Retry) and `EmptyState` components, and require `isError && !data` handling before the empty state. This also fixes S9-03 and S8-14. Moving user copy out of server messages is optional but keeps one source of copy.
- Same issue as: D24 (see Duplicate groups)

#### X-04 · low · bug

**Client timeouts are shorter than the server's worst case, and create-style mutations aren't idempotent, so a retry after a timeout can duplicate work**

- Location: apps/mobile/lib/timeoutLink.ts:18-24 (30 s mutation timeout); apps/mobile/components/dialogs/CreateGroupDialog.tsx:45-71 with apps/mobile/lib/groupEncryption.ts:77 (new `groupId` on every attempt); packages/database/src/client.ts:14 (pool wait unbounded, S4-03); apps/backend/src/index.ts:66-68 (Bun `idleTimeout` 60 s); packages/api/src/router/accountRecoveryRouter.ts:196 (awaits Resend with no timeout, S5-01)
- Failure scenario: The hosted pool is saturated (for example, S4-02's deletion retries hold connections). A user taps Create on "Family", waits 30 s, sees "Can't reach the server" and taps Create again. Both requests commit, and the user now has two "Family" groups, each with its own epoch. They have to work out which one to invite people to, and delete the other. `groupInvites.send` and `requestResetCode` send duplicate emails the same way.
- Suggested fix: Generate the `groupId` once per dialog open, not per submit. Have the server treat a repeat `create` with the same `groupId` by the same user as success, returning the existing group instead of P2002/500. Give `groupInvites.send` and `requestResetCode` a client request ID and dedupe on it in Redis for a few minutes. The server-side timeout fixes (see the timeout table and D5 in the Duplicate map) shrink the window, but don't close it.
- Confidence: medium (the code paths are certain; reaching them needs a server that is already slow)
- Same issue as: D26 (see Duplicate groups)

#### X-05 · low · design

**API response shapes follow no convention: void, `{ message }`, whole Prisma rows, three time formats and two cursor styles**

- Location: per `outputs.txt`. Whole rows: auth.registerDeviceKey (packages/api/src/router/authRouter.ts:28-52, the full `UserDevice` including `sharingRequestId`, `activatedBy`, `revokedAt`, `publicKeyAlgorithm`), groupSettings.rename, groupMembership.updateRole, groupMembership.get. `{ message }`: groupLifecycle.create and delete, groupInvites.accept, acceptShared, decline and send, groupMembership.remove. ISO strings: maps.getSignedPmtilesUrl and forceRefreshSignedPmtilesUrl (`expiresAt`, `refreshAt`). Relative ms: groupInvites.createShared (`expiresInMs` next to `expiresAt: Date`), accountRecovery.status (`freshForMs`).
- Failure scenario: A migration adds a column to `UserDevice`, and it ships to every client in `registerDeviceKey` without review, the same risk S10-10 describes for groups. Someone adds an expiry to a new procedure and copies whichever of the three styles they find first. If they copy the maps style, the client-clock bug in S7-04 repeats.
- Suggested fix: Write a short convention into docs/development/api-compatibility.md. Mutations return the data the app needs or `void`, never an English message or a raw row. Use explicit `select` on every return. Use `Date` for instants plus a server `now` when the client must compare, or relative ms for countdowns. Use one cursor shape. Narrow `registerDeviceKey` to `{ sessionLinked, id, userId }` (check the app's reads first). The S10-05 snapshot would then enforce the convention.
- Same issue as: D12, D23 (see Duplicate groups)

#### X-06 · low · duplication

**Wire formats and validation limits are retyped in several places instead of coming from packages/schemas or packages/shared**

- Location: - Join code `^[A-F0-9]{32}$`: packages/api/src/router/group/groupInvitesRouter.ts:97 and :120 (inline), apps/mobile/app/join.tsx:31, apps/mobile/lib/pendingJoinCode.ts:37. The generator `randomBytes(16).toString("hex")` is at groupInvitesRouter.ts:41.
  - Email code `^\d{6}$`: packages/schemas/src/schemas/account/emailCode.ts:7, packages/auth/src/emailCode.ts:138, and `maxLength={6}` in apps/mobile/components/EmailCodeEntry.tsx:105.
  - Device name 40: schemas `deviceNameSchema`, plus literal `maxLength={40}` in apps/mobile/app/setup/name.tsx:103 and app/account/devices.tsx:83. Both screens also define the same `z.object({ name: deviceNameSchema, icon: deviceIconSchema })` (setup/name.tsx:24, devices.tsx:29).
  - Group name 100: `createGroupSchema`, while rename uses a raw `TextInput maxLength={100}` and `name.trim()` (SettingsTab.tsx:36-47) instead of the schema.
  - Confirm-password refine: apps/mobile/lib/signUpSchema.ts and app/forgotPassword.tsx:24.
  - ID `z.string().min(1).max(128)`: inline 25 times in packages/api, and missing elsewhere (S5-07).
  - Sharing revision prefix `s<a>.<d>:`: built in packages/shared/src/locationSharing.ts:32, parsed in apps/mobile/lib/mapTracking.ts:136-143 and Kotlin SharingCaptureState.kt:16-17, with `startsWith` checks in packages/api/src/lib/groupTracking.ts:185,336 and mapTracking.ts:345,383 (S6, S7 and S10 refactor notes).
  - Queue owner `JSON.stringify([baseUrl, userId])`: tracking.ts:69, locationSharing.ts:113 and Kotlin (S6 refactor note).
- Failure scenario: The join code changes to 8 grouped characters (S9-15 suggests grouping). Four regexes need updating in step, and an app that misses one rejects valid codes as "Invalid code". A Kotlin change to the revision prefix parser passes its own tests while the TS parser disagrees, and native capture keeps paused points that the map then hides.
- Suggested fix: Export `joinCodeSchema`, `emailCodeSchema`, `idSchema`, `DEVICE_NAME_MAX`, `GROUP_NAME_MAX` and a `passwordConfirmation` helper from packages/schemas, and use them on both sides. Put `parseRevisionPrefix`/`compareRevisionPrefix` and `queueOwner()` in packages/shared, and pin them with a JSON test vector that the Kotlin JVM tests also read, as group-payload-interop-v1.json already is.
- Same issue as: D14, D15 (see Duplicate groups)

#### X-07 · low · design

**packages/shared is a client package (rule 13a) but carries server-only utilities, so server-only edits force app version bumps and ship in the app bundle**

- Location: packages/shared/src/index.ts:8-10 (`logRateLimit`, `checkServices`, `validateEnv`); scripts/check-version-bump.ts:5-10 (`packages/shared/` in `clientPaths`); AGENTS.md rule 13a; packages/schemas → `@openbeacon/database/enums` (S10-05)
- Failure scenario: Someone changes `validateEnv` output for the backend. CI demands an app version bump, and a new store build is produced with no app change, or the contributor learns to ignore the rule. In the other direction, a server-only helper that later imports a Node module (`node:crypto`, for example) breaks the Metro bundle.
- Suggested fix: Move `validateEnv`, `checkServices`, `logRateLimit` and the server-only part of `tryCatch` usage into a server package (for example `@openbeacon/server-utils`, server paths only). Keep packages/shared for code both sides run: `tryCatch` (add `tryCatchSync`), sharing rules, headers, causes and API levels. Move the generated enums into packages/schemas as S10-05 suggests.
- Same issue as: D21 (see Duplicate groups)

#### X-08 · low · style

**AGENTS.md rule compliance across the codebase: mostly good, with concentrated breaches**

- Location: see the counts below. Section findings S1-10, S2-11, S4-13, S8-16 and S9-18 list the same breaches per section.
- Failure scenario: New code copies the kit's `function` style and the async-IIFE `tryCatch` workaround. Without a sync variant, rule 8 keeps producing either breaches or wrappers.
- Suggested fix: Add `tryCatchSync` to packages/shared and replace the 11 wrappers and the 14 sync `catch` blocks. Convert `components/ui/*` in one mechanical PR, and delete Accordion first (S9-12). Fold the remaining rule-10b and rule-1 items into the S9-18 and S1-10 fixes. Consider a biome rule for `function` declarations (`useArrowFunction` only covers function expressions, so a custom lint or grep check in `bun run ci` would be needed).
- Same issue as: D19 (see Duplicate groups)

#### X-09 · low · design

- **Status:** fixed on `fix/beta-1-review` by "Patch hono and better-auth, declare superjson in the app, drop unused deps" (SHA added at wrap-up). C5 (the dependency half of X-09; the zod catalog and the rest of X-09 stay post-beta). No new test: `bun audit` no longer lists hono, `bun run ci` and 320 integration tests pass.

**Dependency hygiene: knip results triaged, declared-but-unused and unlisted packages, version-range drift that ships two copies of zod in the app**

- Location: apps/backend/package.json; apps/scheduled-jobs/package.json; apps/mobile/package.json; packages/*/package.json (zod ranges); bun.lock:2192-2266; apps/mobile/app.json:10 (`userInterfaceStyle`)
- Failure scenario: A workspace change drops `superjson` from the hoisted root. Pending sharing changes saved by the app then fail to parse and are silently dropped (`parseStored` → `storage.remove`), the same way S10-01 describes for format changes. Separately, two zod copies add bundle size, and any `instanceof ZodError` across the encryption package boundary fails.
- Suggested fix: `bun add superjson` in apps/mobile. Remove the redundant backend and scheduled-jobs declarations. Put zod, `@trpc/*`, better-auth, `@aws-sdk/*`, `@t3-oss/env-core`, typescript and `@types/*` in the root `catalog`, and use `catalog:` in workspaces, so one `bun update` moves them together. Run `bunx expo install expo-system-ui` if prebuild warns. Track the Expo SDK upgrade as its own post-beta item, and patch better-auth and hono before beta.
- Same issue as: D8, D18 (see Duplicate groups)
