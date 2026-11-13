# Beta 1 code review: plan and coverage

Reviewed commit: `94a73b27` (main, 13 Nov 2026). No source code is changed during the review.

## Files

- `PLAN.md`: this plan, the coverage checklist and the run log.
- `FINDINGS.md`: the final, verified report, split into "Must fix before beta" and "Post-beta".
- `raw/<section>.md`: each reviewer's unverified findings.
- `raw/verify-<section>.md`: the second agent's verdict on each high or critical finding.
- `tooling/`: audit, outdated and knip output.

## How to resume

1. Read the checklist below. A ticked box means that section's raw file is complete.
2. Re-run any unticked section with the brief in "Sections".
3. Verification runs per section after its pass; cross-cutting runs after all section passes.
4. `FINDINGS.md` is assembled last from the raw and verify files.

Integration tests run against a throwaway integration database in a local Postgres container. The env file is `.env.ci` with `DATABASE_URL` pointed there.

## Finding format

```
### [S3-01] Short title
- Location: path/to/file.ts:123 (more locations if grouped)
- Category: security | bug | UX | design | duplication | style
- Severity: critical | high | medium | low
- Launch: must-fix | post-beta
- Confidence: high | medium
- Evidence: what was read, run or tested
- Failure scenario: concrete inputs or state, and the wrong result
- Suggested fix: what to change
```

### Severity

- **critical**: breaks the end-to-end privacy promise (server or another user can read plaintext or keys), authentication or authorisation bypass, access across groups or accounts, silent loss of many users' data, or a crash any user can trigger.
- **high**: exploitable by a signed-in user or group member, realistic data loss or corruption, the app or server stuck with no recovery, or app and server breaking each other across supported versions.
- **medium**: a real bug with a workaround, a narrow failure, inconsistent behaviour, or a design problem likely to cause bugs.
- **low**: polish, style, dead code and small clean-ups.

### Launch bucket

- **must-fix**: every critical; high security and data bugs; stalls and deadlocks; UX that blocks a core flow; and any breaking change to an encrypted format, API shape or database schema that is far cheaper now than after beta testers hold data.
- **post-beta**: refactors, rewrites, deduplication, style and dead code that carry no user-facing risk.

## Sections

| ID  | Section                                   | Effort | Scope                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Encryption and key handling               | high   | `packages/encryption`; mobile key code (`lib/deviceKeys`, `groupEncryption`, `epochKeys`, `recovery`, `personalData`, `historyKeys`, `createHistoryKey`, `currentHistoryKey`, `protectHistory`, `resealPersonalData`, `sessionLink`, `deviceLink`, `deviceActivation`, `installCrypto`, `savedDeviceLink`, `groupKeyAccess`); Kotlin `crypto/` and `keys/`               |
| S2  | Server: auth, accounts and devices        | high   | `packages/auth`; `apps/backend`; `packages/api` `trpc.ts`, `procedures/`, `middlewares/`, account, accountRecovery, accountHistory, auth, device, deviceLink, emailAlerts and feedback routers; `lib/` device, removeDevice, requestDevice, account-deletion                                                                                                             |
| S3  | Server: groups, tracking and media        | high   | `packages/api` group routers, maps router, `lib/` groupEpochs, groupTracking, locationSharing, trackingKeyState, lockUserGroups, groupJoinAlerts, emailInvites, image-upload, storage, pmtilesUrl, `r2.ts`, `s3client.ts`; locking, transactions and deadlocks                                                                                                           |
| S4  | Data layer and jobs                       | high   | `packages/database` (schema, migration, client); `packages/cache`; `apps/scheduled-jobs`                                                                                                                                                                                                                                                                                 |
| S5  | Supporting packages, map tiles and ops    | medium | `packages/email`, `packages/schemas`, `packages/shared`, `packages/map-tiles`, `apps/map-tiles`; `Dockerfile`, `docker-compose.yml`, `.env.example`, `scripts/`, README self-hosting steps                                                                                                                                                                               |
| S6  | Mobile: tracking, sharing and native      | high   | `lib/tracking.ts`, `locationSharing`, `locationPermissions`, `trackingKeyCheck`, `trackingEvents`, `trackingUploadTime`, `notifications`, `networkStatus`, providers `TrackingProvider`, `LocationPermissionProvider`; `modules/openbeacon-tracking` (Kotlin service, queue, worker, module bridge)                                                                      |
| S7  | Mobile: live map                          | medium | `components/map/*`, `app/(tabs)/map`, `lib/map*`, `liveMap*`, `buildLiveMapMarkers`, `classifyMapPeople`, `fitLiveMapMarkers`, edge points, heading, self-location, `hooks/` map and position hooks                                                                                                                                                                      |
| S8  | Mobile: auth, setup, account and plumbing | high   | `app/` signIn, signUp, forgotPassword, serverUrl, index, \_layout, join, device-removed, `setup/*`, `account/*`, `(tabs)/account`; `lib/` api, auth, auth-client, apiCompatibility, timeoutLink, signOut, deviceRemoved, finishAuthentication, googleAuth, emailCodes, server-url, storage; `ApiCompatibilityGate`, `ConfirmIdentity`, `EmailCodeEntry`, other providers |
| S9  | Mobile: groups, UI kit and components     | medium | `app/(tabs)/groups/*`, `components/dialogs`, `components/ui`, `components/image`, remaining `components/*`; UI consistency (spacing, typography, empty/loading/error states, dark mode, accessibility)                                                                                                                                                                   |
| S10 | Version skew and encrypted formats        | high   | Every procedure the app calls versus what supported servers expose; `apiCompatibilityLevel` rules; strict versus loose schemas; encrypted payload versioning in `packages/encryption` and Kotlin `GroupPayloadEncrypt`; `/health` and header handshake; test vectors                                                                                                     |
| X   | Cross-cutting                             | xhigh  | Same concept done differently across features: error handling, API response shapes, validation, loading/error states, timeouts and retries, logging, storage, naming; duplication; dead code; dependency hygiene; consistency with `AGENTS.md` rules                                                                                                                     |

Each section reviewer also checks: tests around the logic it owns, stalls (requests or locks with no timeout), and the project rules in `AGENTS.md`.

## Coverage checklist

### Tooling

- [x] `bun run ci` (passes; turbo replayed cached results; 314 integration tests skipped)
- [x] Integration tests against Postgres and Redis (317 pass, 0 fail)
- [x] `bun audit` at all levels → `tooling/audit-all.log`
- [x] `bun outdated -r` → `tooling/outdated.log`
- [x] knip (unused files, exports, dependencies; ad hoc, not added to the repo) → `tooling/knip.log`

### Section passes

- [x] S1 Encryption and key handling
- [x] S2 Server: auth, accounts and devices
- [x] S3 Server: groups, tracking and media
- [x] S4 Data layer and jobs
- [x] S5 Supporting packages, map tiles and ops
- [x] S6 Mobile: tracking, sharing and native
- [x] S7 Mobile: live map
- [x] S8 Mobile: auth, setup, account and plumbing
- [x] S9 Mobile: groups, UI kit and components
- [x] S10 Version skew and encrypted formats

### Cross-cutting and verification

- [x] X Cross-cutting pass
- [x] Verification of every high and critical finding (plus proposed must-fix and crypto-integrity findings)
- [x] `FINDINGS.md` assembled (catalogue generated by `raw/generate-catalogue.py`)

## Run log

- 13 Nov 2026: plan written; CI, audit, outdated and knip run; integration tests started.
- 13 Nov 2026: integration tests 317/317 pass. All ten section passes done (131 raw findings; 9 high, 0 critical). Leftover temp tests checked: none.
- Verification groups: V1 (S2-01, S2-02, S2-03, S8-01), V2 (S3-01, S3-02, S3-03, S3-05, S1-02), V3 (S4-01, S4-02, S5-01), V4 (S6-01, S6-02, S10-04), V5 (S10-01, S10-02, S10-03, S8-02, S8-04), V6 (S1-01, S1-03). Cross-cutting runs alongside.
- 13 Nov 2026: cross-cutting pass done (9 new findings, 27 duplicate groups, refactor shortlist). V1–V6 verified 22 findings: none rejected, 1 upgraded to must-fix (S2-02), 6 downgraded (S10-01, S6-02, S4-02, S1-02 in severity; S3-05, S5-01, S10-04 to post-beta). FINDINGS.md assembled: 140 findings (6 high, 46 medium, 88 low), 11 must-fix items, 12 cheap wins, 11 open decisions. The throwaway review database can be dropped.
