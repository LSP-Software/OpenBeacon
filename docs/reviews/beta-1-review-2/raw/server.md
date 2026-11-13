# Server, auth, data and jobs review

Reviewed `caccd60e406204c52523910974eeea5811e2e36b`. Application code unchanged. The checklist below covers authored production sources; generated Prisma output is excluded. Read the Accounts and Encryption contexts, context map and both encryption ADRs, plus the first review's decisions and resolved/carry-forward status. Parent owns global CI, audit and integration-suite evidence.

## Findings

### SR-01. A refused operator deletion permanently erases location history

- Location: `packages/api/src/lib/account-deletion.ts:27`, `packages/api/src/lib/account-deletion.ts:59`; CLI caller `apps/scheduled-jobs/src/deleteAccount.ts:26`.
- Category: bug.
- Severity: medium. The owner-only CLI is the demonstrated trigger; do not describe this as an unauthenticated API exploit.
- Launch: must fix before offering the deletion CLI as a beta support tool. Otherwise explicitly defer and do not use the CLI on live accounts.
- Confidence: high, reproduced against disposable PostgreSQL.
- Failure scenario: an operator runs `delete-account` for the only owner of a group that also has members. The CLI refuses with “Transfer ownership or delete your groups before deleting your account.” The account and memberships survive, but the helper has already committed deletion of all that user's location rows outside the final transaction. The account loses history despite the rejected operation.
- Evidence: `/tmp/beta2-server-deletion-probe.ts`, run with `bun --env-file=/tmp/openbeacon-beta2-probes.env /tmp/beta2-server-deletion-probe.ts`, printed `{"before":1,"after":0,"userSurvives":true,"error":"Transfer ownership or delete your groups before deleting your account."}`. It seeds and removes random fixture IDs. The existing `account-deletion-cli.integration.test.ts` tests refusal preserves the User, but seeds no payloads and therefore misses this regression.
- Suggested fix: run ownership and image-key preflight before destructive batches. For the CLI, use the same durable deletion request/locking transition as the API before batching, so the account cannot change membership or create sessions during deletion. Keep the final guarded transaction. Add a regression asserting a rejected deletion preserves payloads and membership.
- Compatibility: server-only fix; no wire or encrypted-format change expected.

### SR-02. Shared invite authority survives removal or demotion

- Location: `packages/api/src/router/group/groupMembershipRouter.ts:418`; `packages/api/src/router/group/assertGroupMemberCanBeRemoved.ts:45`; `packages/api/src/router/group/groupInvitesRouter.ts:140`.
- Category: security.
- Severity: medium.
- Launch: recommended must fix before beta, because removal should terminate the removed admin's invitation authority. This was beta-1 S3-07, still present; its earlier low severity reflected the five-minute window.
- Confidence: high from complete issuance, acceptance, removal and demotion paths; no fresh execution probe.
- Failure scenario: an admin creates a shared code, then the owner removes or demotes them. The code can still admit a new member for the remainder of five minutes. `acceptShared` checks code validity but never whether `creatorId` remains an admin; only email invites are revoked in the departure/demotion paths.
- Suggested fix: under the existing Group lock, require the creator to be a current OWNER or ADMIN, or atomically revoke unused shared codes whenever that authority is removed. Test removal and OWNER/ADMIN-to-MEMBER demotion.
- Compatibility: existing callers already handle refused/expired invitations. No encrypted-format change.

### SR-03. Storage operations still run inside group-deletion transactions

- Location: `packages/api/src/lib/deleteGroup.ts:22`; callers `packages/api/src/router/group/groupLifecycleRouter.ts:45`, `packages/api/src/router/group/groupMembershipRouter.ts:332`.
- Category: bug.
- Severity: medium.
- Launch: post-beta refactor; accepted carry-forward from beta-1 S3-05.
- Confidence: high from call paths. Slow-storage timing is not freshly reproduced.
- Failure scenario: storage deletes one image, then a later storage request stalls beyond the 15-second Prisma transaction deadline. The database rolls back, the group survives and its image points at a deleted object. The Group row remains locked while uploads, joins and mutations wait. Client-level timeouts now prevent an infinite socket stall, but retrying or serial calls can still outlast the transaction.
- Suggested fix: commit group deletion and durable image-cleanup keys in one database transaction, then let the cleanup job perform retryable storage work, reusing the account-deletion cleanup design. Test a partial storage failure and a transaction timeout.

### SR-04. Image storage identity depends on the current CDN origin

- Location: `packages/api/src/lib/storage.ts:162`; `packages/api/src/lib/deleteGroup.ts:30`; `packages/api/src/lib/account-deletion.ts:73`; `apps/scheduled-jobs/src/jobs/imageUploadCleanup.ts:103`.
- Category: design.
- Severity: medium.
- Launch: post-beta unless a CDN/bucket move is planned before launch. Carry-forward beta-1 S3-06.
- Confidence: high from predicates.
- Failure scenario: changing `S3_CDN_URL` leaves stored image URLs on the former domain. Group deletion and solo-group account deletion reject those images; the sweep refuses to run. These accounts and images need manual repair before deletion resumes.
- Suggested fix: store the bucket/object key as the storage identity and derive public URLs at read time. Preserve external OAuth images separately. Decide migration and supported old-server response behavior before changing database or API representation.

### SR-05. Public image uploads validate length but not image content or media type

- Location: `packages/api/src/lib/storage.ts:32`; `packages/api/src/lib/image-upload.ts:143`.
- Category: security.
- Severity: medium.
- Launch: recommended before beta if the public CDN serves uploaded content directly. Carry-forward beta-1 S3-04.
- Confidence: high for the absence of validation. Actual CDN response headers and browser behavior are deployment-dependent and were not tested in this pass.
- Failure scenario: a signed-in user requests a valid-sized `.webp` upload using the SHA256 of an HTML file. `content-type` is absent from the explicit signable headers and confirmation reads only ContentLength, so the server accepts arbitrary bytes as the avatar. At minimum every viewer sees an undecodable avatar; if the CDN honors an attacker-supplied HTML media type, its trusted domain hosts active HTML.
- Suggested fix: bind Content-Type in the upload signature, verify the stored ContentType and WebP header before committing, and configure CDN `nosniff`. Binding media type alone does not verify bytes. Decide whether uploaded files must pass a real decoder or just a strict header check, and use a separate upload origin where applicable.

### SR-06. Pending-device cleanup can repeatedly roll back the entire backlog

- Location: `apps/scheduled-jobs/src/jobs/pendingDeviceCleanup.ts:7`.
- Category: bug.
- Severity: low.
- Launch: post-beta. Carry-forward beta-1 S4-06.
- Confidence: high for unbounded transaction and dependency; backlog size needed to exceed the default timeout is unmeasured.
- Failure scenario: enough abandoned pending devices accumulate for the SELECT, session deletion and device deletion to exceed the default interactive-transaction timeout. Every hourly run rolls back. Expired links and challenges also remain because their deletes follow the failed transaction.
- Suggested fix: page by a bounded number of pending devices with SKIP LOCKED, and run links/challenges as independently guarded cleanup steps. Add a large-backlog integration check.

### SR-07. Group response projection is duplicated and one route returns raw storage rows

- Location: `packages/api/src/router/group/groupMembershipRouter.ts:46`, `packages/api/src/router/group/groupMembershipRouter.ts:63`, `packages/api/src/router/group/groupLifecycleRouter.ts:136`, `packages/api/src/router/group/groupInvitesRouter.ts:327`.
- Category: duplication.
- Severity: low.
- Launch: post-beta. Carry-forward beta-1 S3-09.
- Confidence: high from returned object shapes.
- Failure scenario: adding a group/member field updates one list/create/join projection but not the others, giving the UI different cached representations. `get` returns the raw Group and current GroupMember fields, so future sensitive storage fields become API fields by default.
- Suggested fix: one explicit group-list selection/projection shared across list/create/accept, and an explicit select for get. Keep distinct result shapes only where callers need them; do not add success-envelope boilerplate to every router.

### SR-08. Schema types omit invariants enforced in SQL and lack a nickname target index

- Location: `packages/database/prisma/schema.prisma:173`, `packages/database/prisma/schema.prisma:191`, `packages/database/prisma/schema.prisma:228`; migration `packages/database/prisma/migrations/20261112120000_init/migration.sql:621`.
- Category: design.
- Severity: low.
- Launch: post-beta. Consolidates beta-1 S4-07/S4-08; not a claim of a current authentication bypass.
- Confidence: high from schema/migration comparison.
- Failure scenario: generated types allow a null invite creator or alert member that SQL rejects, encouraging impossible branches or write-time failures in future changes. Deleting a member can require scanning all PersonalGroupNickname rows because the composite PK starts with ownerId and no index starts with targetId.
- Suggested fix: make required fields required in Prisma as well as SQL; retain the escrow-completeness CHECK which Prisma cannot represent. Add an index on targetId when changing the schema. Add a unique providerId/accountId constraint only after assessing better-auth's actual account lifecycle; absence alone is not proof of an exploitable race.

## Safety and behavior checks that held up

- Session headers cannot move a linked session to another device. A Session link proves the device private key; a device header alone does not activate it.
- Pending devices cannot use protected/group procedures. First-device registration counts formerly active, removed devices too.
- Recovery creation/reset and phrase change lock the account and enforce complete/current history-key versions; activation challenges are one-use and bound to the current version.
- Group mutation routes re-check current membership/role under the Group lock. Joining serializes against the User lock and enforces the account group cap.
- Member departure no longer persists an epoch chosen by the leaver. Poll/getLatest and wrap reads enforce joinedEpochNumber.
- Uploads take User, Group and Member SHARE locks in that order, validate sender-account ownership, epoch group ownership and sharing revision, sort insertion keys to reduce overlapping-batch lock contention, and bound per-minute/daily cost.
- Account/device mutations generally lock User then groups in sorted order. No reproducible indefinite database deadlock was identified. Statement/connection/interactive-transaction timeouts bound failures, which should not be described as infinite hangs.
- Redis now has a shared self-healing client and per-command timeout. Callers implement documented fail-open/closed policy; the password limiter reserves attempts before checks and refunds non-password failures/successes.
- Password reset tokens use hashed identifiers compatible with better-auth; custom email codes are purpose-bound, HMACed and one-use with per-code and daily guessing limits.
- Internal tRPC errors mask database details. Public feedback uses a global cost limit, validates inputs and sends only an ID/contact-present flag to its bounded Discord notification.
- Scheduled deletions re-check due state under User lock and sign-in rejects due accounts. The reproduced CLI issue above does not establish the previously rejected scheduled-deletion/sign-in race.
- No broad server rewrite is justified by this pass. The useful refactors are the deletion/media ownership boundary and shared group projections, with source behavior retained by regression tests.

## Limits and rejected hypotheses

- No production S3/CDN/Google credentials were used. Presigned URL/header behavior should be tested against the chosen storage provider and CDN before labelling SR-05 an XSS exploit.
- Read existing integration tests for device removal, activation/session linking, group permissions/departure/concurrency, account deletion and password attempts; parent runs full integration tests. Tests are not treated as proof that every race is absent.
- Device revocation cannot revoke previously copied History keys; ADR 0001 explicitly accepts this until OPE-167. Do not report it again as a new high finding.
- Sign-in brute-force defenses intentionally avoid IP limits. Do not reintroduce them as an unrequested review recommendation.
- Old-epoch offline uploads are necessary to drain captured history; accepting an old epoch is not by itself proof that a removed member can fetch new locations.
- Generated source, vendored dependencies and CI workflow design are outside the authored-code section pass. Parent owns dependency audits and tooling.
- No source-code edits or permanent tests were added. The deletion proof is temporary outside the repository and must be copied into a permanent regression during resolution.

## Production source coverage

All paths below were read in the section pass. Package manifests, schema/migration, backend/runner guides and relevant domain ADRs were also read. Test coverage is supplied separately by parent tooling logs, not implied by these checkboxes.

- [x] `apps/backend/src/app.ts`
- [x] `apps/backend/src/cache.ts`
- [x] `apps/backend/src/checkServices.ts`
- [x] `apps/backend/src/db.ts`
- [x] `apps/backend/src/env.ts`
- [x] `apps/backend/src/envSchema.ts`
- [x] `apps/backend/src/helpers/apiCompatibility.ts`
- [x] `apps/backend/src/helpers/clientIp.ts`
- [x] `apps/backend/src/helpers/db.ts`
- [x] `apps/backend/src/index.ts`
- [x] `apps/backend/src/routes/auth.ts`
- [x] `apps/backend/src/routes/health.ts`
- [x] `apps/backend/src/routes/trpc.ts`
- [x] `apps/backend/src/types/AppEnv.ts`
- [x] `apps/backend/src/types/DatabaseClient.ts`
- [x] `apps/backend/src/validateEnv.ts`
- [x] `apps/backend/src/validateServices.ts`
- [x] `apps/backend/src/version.ts`
- [x] `apps/scheduled-jobs/src/databaseTime.ts`
- [x] `apps/scheduled-jobs/src/deleteAccount.ts`
- [x] `apps/scheduled-jobs/src/env.ts`
- [x] `apps/scheduled-jobs/src/health.ts`
- [x] `apps/scheduled-jobs/src/index.ts`
- [x] `apps/scheduled-jobs/src/jobs/accountDeletion.ts`
- [x] `apps/scheduled-jobs/src/jobs/expiredRecordsCleanup.ts`
- [x] `apps/scheduled-jobs/src/jobs/imageUploadCleanup.ts`
- [x] `apps/scheduled-jobs/src/jobs/index.ts`
- [x] `apps/scheduled-jobs/src/jobs/locationHistoryCleanup.ts`
- [x] `apps/scheduled-jobs/src/jobs/pendingDeviceCleanup.ts`
- [x] `apps/scheduled-jobs/src/jobs/uploadGrowthReport.ts`
- [x] `apps/scheduled-jobs/src/scheduler.ts`
- [x] `apps/scheduled-jobs/src/services.ts`
- [x] `packages/api/src/checkStorage.ts`
- [x] `packages/api/src/env.ts`
- [x] `packages/api/src/envSchema.ts`
- [x] `packages/api/src/index.ts`
- [x] `packages/api/src/lib/account-deletion.ts`
- [x] `packages/api/src/lib/deleteGroup.ts`
- [x] `packages/api/src/lib/deletePayloadsInBatches.ts`
- [x] `packages/api/src/lib/deviceActivation.ts`
- [x] `packages/api/src/lib/deviceRemoved.ts`
- [x] `packages/api/src/lib/deviceUnverified.ts`
- [x] `packages/api/src/lib/emailInvites.ts`
- [x] `packages/api/src/lib/groupEpochs.ts`
- [x] `packages/api/src/lib/groupJoinAlerts.ts`
- [x] `packages/api/src/lib/groupLimit.ts`
- [x] `packages/api/src/lib/groupTracking.ts`
- [x] `packages/api/src/lib/image-upload.ts`
- [x] `packages/api/src/lib/locationSharing.ts`
- [x] `packages/api/src/lib/lockUserGroups.ts`
- [x] `packages/api/src/lib/pmtilesUrl.ts`
- [x] `packages/api/src/lib/reasonError.ts`
- [x] `packages/api/src/lib/removeDevice.ts`
- [x] `packages/api/src/lib/requestDevice.ts`
- [x] `packages/api/src/lib/storage.ts`
- [x] `packages/api/src/lib/trackingKeyState.ts`
- [x] `packages/api/src/middlewares/rateLimit.ts`
- [x] `packages/api/src/middlewares/rateLimitMiddleware.ts`
- [x] `packages/api/src/middlewares/timingMiddleware.ts`
- [x] `packages/api/src/procedures/auth/base.ts`
- [x] `packages/api/src/procedures/auth/group.ts`
- [x] `packages/api/src/procedures/auth/runtime.ts`
- [x] `packages/api/src/r2.ts`
- [x] `packages/api/src/root.ts`
- [x] `packages/api/src/router/accountHistoryRouter.ts`
- [x] `packages/api/src/router/accountRecoveryRouter.ts`
- [x] `packages/api/src/router/accountRouter.ts`
- [x] `packages/api/src/router/authRouter.ts`
- [x] `packages/api/src/router/deviceLinkRouter.ts`
- [x] `packages/api/src/router/deviceRouter.ts`
- [x] `packages/api/src/router/emailAlertsRouter.ts`
- [x] `packages/api/src/router/feedbackRouter.ts`
- [x] `packages/api/src/router/group/assertGroupMemberCanBeRemoved.ts`
- [x] `packages/api/src/router/group/groupEpochRouter.ts`
- [x] `packages/api/src/router/group/groupInvitesRouter.ts`
- [x] `packages/api/src/router/group/groupLifecycleRouter.ts`
- [x] `packages/api/src/router/group/groupMembershipRouter.ts`
- [x] `packages/api/src/router/group/groupSettingsRouter.ts`
- [x] `packages/api/src/router/group/groupTrackingRouter.ts`
- [x] `packages/api/src/router/mapsRouter.ts`
- [x] `packages/api/src/s3client.ts`
- [x] `packages/api/src/trpc.ts`
- [x] `packages/api/src/trpcRuntime.ts`
- [x] `packages/api/src/types/GroupListItem.ts`
- [x] `packages/auth/src/capabilities.ts`
- [x] `packages/auth/src/createAuth.ts`
- [x] `packages/auth/src/db.ts`
- [x] `packages/auth/src/emailCode.ts`
- [x] `packages/auth/src/emailCodePlugin.ts`
- [x] `packages/auth/src/env.ts`
- [x] `packages/auth/src/googleDeletion.ts`
- [x] `packages/auth/src/googleIdToken.ts`
- [x] `packages/auth/src/index.ts`
- [x] `packages/auth/src/passwordAttempts.ts`
- [x] `packages/auth/src/publicUrl.ts`
- [x] `packages/auth/src/securityAlerts.ts`
- [x] `packages/cache/src/alertsTurnedOff/alertsTurnedOff.ts`
- [x] `packages/cache/src/cache/OpenBeaconCache.ts`
- [x] `packages/cache/src/cache/redis.ts`
- [x] `packages/cache/src/cache/selfHealingRedis.ts`
- [x] `packages/cache/src/cache/sharedCache.ts`
- [x] `packages/cache/src/index.ts`
- [x] `packages/cache/src/pmtilesSignedUrls/index.ts`
- [x] `packages/cache/src/pmtilesSignedUrls/pmtilesSignedUrls.ts`
- [x] `packages/cache/src/pmtilesSignedUrls/schemas.ts`
- [x] `packages/cache/src/rateLimits/index.ts`
- [x] `packages/cache/src/rateLimits/rateLimits.ts`
- [x] `packages/cache/src/rateLimits/schemas.ts`
- [x] `packages/cache/src/rateLimits/types.ts`
- [x] `packages/database/src/client.ts`
- [x] `packages/database/src/databaseUrlSchema.ts`
- [x] `packages/database/src/index.ts`
