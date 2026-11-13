# OpenBeacon second beta review findings

Reviewed commit `caccd60e406204c52523910974eeea5811e2e36b`, 13 November 2026. Whole authored codebase review, including interactions between features. No application code, dependencies, schemas or tests were changed. Only review documents and evidence were added. No Linear issues were created.

There is one high-severity finding, independently confirmed by a second reviewer, and no new critical finding. The highest priority is offline sharing pause, followed by rejected operator deletion losing history. Focused fixes are warranted; the evidence does not justify a whole-app, backend or encryption rewrite.

The launch list below is a recommendation for the resolution discussion. Severity and release priority are separate. Conditional platform/storage risks explicitly say what was simulated and what has not been reproduced. Some medium/low issues carry forward from the first review and are marked as such; this report does not reset previous accepted decisions.

## Launch priorities

| Order | Finding | Severity / category | Required outcome                                                                                                                                       |
| ----- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | MOB-01  | high / bug          | Offline pause applies locally immediately and does not trap the user. Independently verified.                                                          |
| 2     | SR-01   | medium / bug        | Refused operator deletion preserves history, or withdraw the CLI from beta support. Independently reproduced by parent.                                |
| 3     | SR-02   | medium / security   | Removed/demoted admins lose unused shared-invite authority, or explicitly accept the five-minute bearer-code window.                                   |
| 4     | SR-05   | medium / security   | Agree and validate the upload/CDN contract; arbitrary content is accepted today, while script execution depends on deployment headers.                 |
| 5     | MOB-02  | medium / UX         | First-load outages show recoverable failure, not empty groups or an endless map spinner.                                                               |
| 6     | CN-06   | medium / security   | Secret writes cannot repopulate a completed destructive wipe. Fault injection reproduced ordering; device ordering remains unverified.                 |
| 7     | CN-01   | medium / bug        | A stalled key read cannot monopolize reconciliation and block later queue uploads. Conditional native-storage hang, not a demonstrated Android outage. |

Resolve the choices for shared invitations, media validation and the deletion CLI before implementing those fixes. CN-01 and CN-06 should share a storage-ownership design: a timeout alone does not cancel a late native write.

## Must fix before beta

### MOB-01. Offline pause never reaches the local pause implementation and locks its dialog

- Location: `apps/mobile/components/LocationSharingCard.tsx:108`; related `apps/mobile/lib/networkStatus.ts:34`, `apps/mobile/lib/locationSharing.ts:279`, `apps/mobile/components/LocationSharingCard.tsx:253`.
- Category: bug.
- Severity: high.
- Confidence: high; independently reproduced by parent reviewer with installed query-core.
- Failure scenario: A phone is sharing, loses connectivity, and its owner taps Pause sharing. OfflineBanner has set `onlineManager` false. TanStack's default online mutation mode pauses the mutation before `changeLocationSharing` runs. No pending preference is saved and no native local pause is applied. The card stays pending, and hardware-back, backdrop and Cancel are disabled indefinitely. Capture continues while offline. Closing/restarting the app discards the unexecuted mutation, so the requested pause is lost. Captured points remain eligible for later uploads; reconnect ordering was not reproduced.
- Evidence: Installed `@tanstack/query-core` probe with QueryClient + MutationObserver: offline `mutate()` yields `{ applied:false, status:"pending", isPaused:true }`; only setting online true runs the mutationFn. `api.ts` sets no mutation default; root layout always mounts OfflineBanner. `changeLocationSharing` writes local preference and calls native sharing only inside mutationFn. Parent retained an independent probe in `tooling/offline-mutation-probe.log`.
- Suggested fix: Run local sharing operations with `networkMode:"always"` so the local pause is persisted immediately and server replay remains owned by `locationSharing.ts`. Audit the resume banner and other local mutations for the same policy. Add an offline integration test through the actual mutation wrapper; a direct helper test misses this bug. Preserve a cancellable UI and explicit queued state.
- Compatibility: App patch; no API/format change is needed.

### SR-01. A refused operator deletion permanently erases location history

- Location: `packages/api/src/lib/account-deletion.ts:27`, `packages/api/src/lib/account-deletion.ts:59`; CLI caller `apps/scheduled-jobs/src/deleteAccount.ts:26`.
- Category: bug.
- Severity: medium. The owner-only CLI is the demonstrated trigger; do not describe this as an unauthenticated API exploit.
- Launch: must fix before beta, with the conditions/decision in the launch table above.
- Confidence: high, reproduced against disposable PostgreSQL.
- Failure scenario: an operator runs `delete-account` for the only owner of a group that also has members. The CLI refuses with "Transfer ownership or delete your groups before deleting your account." The account and memberships survive, but the helper has already committed deletion of all that user's location rows outside the final transaction. The account loses history despite the rejected operation.
- Evidence: `/tmp/beta2-server-deletion-probe.ts`, run with `bun --env-file=/tmp/openbeacon-beta2-probes.env /tmp/beta2-server-deletion-probe.ts`, printed `{"before":1,"after":0,"userSurvives":true,"error":"Transfer ownership or delete your groups before deleting your account."}`. It seeds and removes random fixture IDs. The existing `account-deletion-cli.integration.test.ts` tests refusal preserves the User, but seeds no payloads and therefore misses this regression.
- Suggested fix: run ownership and image-key preflight before destructive batches. For the CLI, use the same durable deletion request/locking transition as the API before batching, so the account cannot change membership or create sessions during deletion. Keep the final guarded transaction. Add a regression asserting a rejected deletion preserves payloads and membership.
- Compatibility: server-only fix; no wire or encrypted-format change expected.

### SR-02. Shared invite authority survives removal or demotion

- Location: `packages/api/src/router/group/groupMembershipRouter.ts:418`; `packages/api/src/router/group/assertGroupMemberCanBeRemoved.ts:45`; `packages/api/src/router/group/groupInvitesRouter.ts:140`.
- Category: security.
- Severity: medium.
- Launch: must fix before beta, with the conditions/decision in the launch table above.
- Confidence: high from complete issuance, acceptance, removal and demotion paths; no fresh execution probe.
- Failure scenario: an admin creates a shared code, then the owner removes or demotes them. The code can still admit a new member for the remainder of five minutes. `acceptShared` checks code validity but never whether `creatorId` remains an admin; only email invites are revoked in the departure/demotion paths.
- Suggested fix: under the existing Group lock, require the creator to be a current OWNER or ADMIN, or atomically revoke unused shared codes whenever that authority is removed. Test removal and OWNER/ADMIN-to-MEMBER demotion.
- Compatibility: existing callers already handle refused/expired invitations. No encrypted-format change.

### SR-05. Public image uploads validate length but not image content or media type

- Location: `packages/api/src/lib/storage.ts:32`; `packages/api/src/lib/image-upload.ts:143`.
- Category: security.
- Severity: medium.
- Launch: must fix before beta, with the conditions/decision in the launch table above.
- Confidence: high for the absence of validation. Actual CDN response headers and browser behavior are deployment-dependent and were not tested in this pass.
- Failure scenario: a signed-in user requests a valid-sized `.webp` upload using the SHA256 of an HTML file. `content-type` is absent from the explicit signable headers and confirmation reads only ContentLength, so the server accepts arbitrary bytes as the avatar. At minimum every viewer sees an undecodable avatar; if the CDN honors an attacker-supplied HTML media type, its trusted domain hosts active HTML.
- Suggested fix: bind Content-Type in the upload signature, verify the stored ContentType and WebP header before committing, and configure CDN `nosniff`. Binding media type alone does not verify bytes. Decide whether uploaded files must pass a real decoder or just a strict header check, and use a separate upload origin where applicable.

### MOB-02. Initial query failures still become empty groups or an endless map loader

- Location: `apps/mobile/app/(tabs)/groups/list.tsx:30`, `apps/mobile/app/(tabs)/groups/list.tsx:89`; `apps/mobile/components/map/NativeMap.tsx:337`; `apps/mobile/hooks/useSignedPmtilesUrl.ts:30`.
- Category: UX.
- Severity: medium.
- Launch: must fix before beta, with the conditions/decision in the launch table above.
- Confidence: high by source inspection; carry-over from first review S9-03 and S7-03.
- Failure scenario: The app has a valid session but the self-hosted server cannot return groups or map URLs. After retries, groups defaults undefined data to empty arrays and tells an existing group member they have no groups. The map retries indefinitely and renders only a spinner, without an actionable error or access to its people tray. A user cannot tell a temporary outage from an account/data problem.
- Evidence: Groups only checks isPending; isError is discarded. NativeMap's no-style branch renders ActivityIndicator alone, and signed URL retries every non-UNAUTHORIZED error indefinitely. The account Devices screen already has explicit loading/error/retry states, so this is inconsistent with the working UI pattern.
- Suggested fix: Handle first-load error before empty-state rendering. Keep stale data with an error banner on refetch failure. Give map URL/loading failures a bounded loading phase and Retry; keep the people/status list available without a base map. Shared query-state components should preserve different empty/failure meanings.
- Compatibility: App patch; unchanged API.

### CN-06. Key-storage writes are not coordinated with key wiping

- Location: `apps/mobile/lib/historyKeys.ts:21`, `apps/mobile/lib/historyKeys.ts:35`, `apps/mobile/lib/recovery.ts:250`, `apps/mobile/lib/deviceLink.ts:105`, `apps/mobile/lib/endSession.ts:128`.
- Category: security.
- Severity: medium.
- Launch: must fix before beta, with the conditions/decision in the launch table above.
- Confidence: high on a deterministic delayed-native-write reproduction; no claim that normal Android SecureStore scheduling necessarily produces this ordering.
- Failure scenario: Restore or device linking starts persisting a History key. Before that native write settles, a remote phone removal triggers `endSession` and its key wipe. The wipe completes and the phone reports itself removed. The earlier write then finishes and leaves the History private key in SecureStore again. These helpers have neither a key-owner generation check nor serialization with deletion. The device registration generation guards server registration and native provisioning, but does not govern History-key storage. A plain sign-out deliberately keeps keys and is not a failure scenario here.
- Evidence: A temporary test outside the repository mocks a blocked native `setItemAsync`, starts the real `storeHistoryKey`, runs the real `deleteStoredHistoryKeys` through completion, releases the write, and observes `encryption.history.review.1` present again. Both probe tests pass; log at `tooling/history-storage-probe.log`. No production files were modified. Real platform write/delete ordering remains a platform validation item.
- Suggested fix: Give per-account key writes and destructive deletion one owner. On removal, invalidate that owner's generation and ensure any already started persistence finishes before the final delete, or delete again when an invalidated write completes. Bound the caller's wait while preserving eventual cleanup. Apply the same rule to device keys and saved device-link secrets. Test wipe during each setup/storage stage, and late completion after timeout.

### CN-01. A stalled History-key read holds the tracking reconciliation promise and prevents later upload attempts

- Location: `apps/mobile/lib/historyKeys.ts:9`, `apps/mobile/lib/tracking.ts:127`, `apps/mobile/lib/tracking.ts:131`, `apps/mobile/lib/tracking.ts:491`, `apps/mobile/lib/tracking.ts:856`.
- Category: bug.
- Severity: medium.
- Launch: must fix before beta, with the conditions/decision in the launch table above.
- Confidence: high on the control-flow failure; no real-device SecureStore hang reproduced.
- Failure scenario: A native SecureStore read never settles while reconciliation checks the current History key or a previously missing version. `syncBackgroundTracking` awaits reconciliation before flushing the queue, and subsequent background invocations return the same pending `reconcilePromise`. The 60-second headless task timeout does not settle this JavaScript promise. While the JS process lives, further background upload invocations wait again; native capture can continue until queue eviction loses old points. Existing tests show session teardown detaches stalled reconciliation, so this is not a permanent lock across sign-out/restart.
- Evidence: Outside-repository fault-injection test holds `SecureStore.getItemAsync` pending and confirms the real helper remains pending. See `tooling/history-storage-probe.log`. Direct read of the await/single-flight chain. `deviceKeys.ts` already bounds the corresponding device-key storage operations at 10 seconds and tests stalled SecureStore reads. The History-key helper has no deadline, nor does the reconciliation work have an overall deadline. This is a conditional robustness bug, not a claim that normal SecureStore reads hang.
- Suggested fix: Bound History-key reads and writes through one storage adapter, preserving the underlying write ownership so timeout/retry cannot replace an identity being persisted. Also detach a timed-out reconciliation generation and prevent late work from installing keys or mutating another session. Add one test that never resolves the History-key read and proves later tracking uploads can proceed with already provisioned keys. Do not silently interpret a timeout as a missing key or create a replacement History key.

## Post-beta refactors and bounded follow-ups

These do not compete with the launch list. O1 moves into launch scope if a capped initial map import is required; CN-02 deserves an explicit release-status acceptance check because it affects what the sending phone claims. MOB-03 is a small optional polish fix if Google sign-in is enabled.

### O1. Bandwidth-capped map uploads can never finish a full part

- Location: apps/map-tiles/src/r2.ts:26; apps/map-tiles/src/upload.ts:19 and :365; apps/map-tiles/src/transfer.ts:24.
- Category: bug. Severity: medium. Launch: post-beta unless a capped first map import is required for beta self-hosting.
- Scenario: configure MAP_TILES_MAX_MBPS=1. Each full 64 MiB upload takes at least 537 seconds even before sharing bandwidth across four workers. The SDK absolute request timeout is 120 seconds with throwOnRequestTimeout enabled. Every attempt aborts; five retries and later service retries cannot finish the part. First publication never creates a usable map.
- Evidence: configuration and throttle source; installed @smithy/node-http-handler setRequestTimeout uses a wall-clock timer, destroys request and rejects independently of upload progress. Budget even with a single worker is insufficient below about 4.48 Mbps, and four concurrent streams require more.
- Fix: use progress/inactivity deadlines for upload parts; account for rate limit and concurrency when choosing maximum duration or part size. Test successful deliberately slow streams as well as actual stalls.

### CN-02. The location service claims to share while Android supplies no locations

- Location: `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingCaptureService.kt:244` and `:480`.
- Category: UX.
- Severity: medium.
- Launch: post-beta refactor/robustness work under the first review's existing deferral; reconsider if accurate sharing status is a beta gate.
- Confidence: high on missing status handling; no device run in this pass.
- Failure scenario: The user switches off Location in Android quick settings, or the fused-location task fails. The service retains `isCaptureRunning`, handles neither task failure nor location availability, and builds its notification only from sharing-pause preferences. It continues to say "Sharing your location" even though no fixes arrive. Family members see old locations without a reason on the sending phone.
- Evidence: `LocationCallback` implements only `onLocationResult`; `requestLocationUpdates`' returned Task is ignored; notification selection depends only on `sharing.isPaused`. The TypeScript permission helpers do not inspect provider availability either.
- Suggested fix: Observe provider availability and the returned task's failure, record the last successful fix, and show a recoverable location-unavailable state with a settings action. Clear that state when fixes resume. Keep it distinct from a deliberate sharing pause.
- Prior review: S6-08, still present. This is one carried-forward finding, not a new duplicate.

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

### CN-05. Compatibility guidance incorrectly treats every optional input addition as safe

- Location: `docs/development/api-compatibility.md:21` and `:28`.
- Category: design.
- Severity: medium.
- Launch: post-beta documentation/refactor work; apply the correct interpretation to all beta fixes now.
- Confidence: high.
- Failure scenario: A future app relies on a new optional input to enforce pause ordering or another correctness condition. An older server with a loose `z.object` strips that field silently. Following the document's "new optional input" exception leaves the app talking to an older server that cannot perform the intended behavior, even though both compatibility levels appear supported.
- Evidence: The rule describes only new inputs to strict schemas as requiring a minimum-server bump. Most request schemas deliberately use loose objects. No current level-4 release mismatch is asserted: unsupported pre-beta builds are explicitly documented, including `requestedAt` and nullable battery changes.
- Suggested fix: Say that a minimum-server bump is required whenever the app relies on the server acting on a new field, regardless of strict versus loose parsing. Optional fields are additive only if ignoring them preserves supported behavior. Keep that decision in each fix's compatibility assessment.
- Prior review: S10-06, still present. No CI change requested.

### CN-03. Device-wrap serialization lacks a pinned interoperability vector

- Location: `packages/encryption/src/index.ts:64` and `:233`.
- Category: design.
- Severity: low.
- Launch: post-beta; adding the vector before beta is cheap protection for already stored wraps.
- Confidence: high.
- Failure scenario: A readability refactor reorders keys in `getWrapInfo`'s object. Sealing and opening both change, so round-trip tests pass, but previously stored Device wraps fail authentication. Devices without a usable History wrap cannot read those epochs.
- Evidence: Device-wrap `info` is `JSON.stringify` of an object whose insertion order is cryptographically significant. Shared vectors pin payload AAD, History wraps, escrows, device links and challenges, but no vector pins the Device-wrap `info` or ciphertext.
- Suggested fix: Add a frozen Device-wrap vector with literal expected info bytes and ciphertext; no format change is necessary. Document serialized order as part of the format. Any future intentional byte change needs a new context version and compatible reader strategy.
- Prior review: S1-06, still present.

### MOB-03. Google account-picker cancellation continues into device setup

- Location: `apps/mobile/lib/googleAuth.ts:18`; `apps/mobile/lib/auth.ts:144`.
- Category: UX.
- Severity: low.
- Launch recommendation: small beta polish fix if Google sign-in is enabled.
- Confidence: high; executable mocked-boundary probe.
- Failure scenario: A signed-out user opens the Google account picker and cancels. `signInWithGoogle` returns `{}`, which `performGoogleAuth` interprets as success because there is no error. It calls authenticated device setup, receives UNAUTHORIZED and shows "Google sign in failed" after an intentional cancel. ConfirmIdentity already recognizes this cancellation shape; the sign-in/sign-up wrapper does not.
- Evidence: Probe importing the real wrapper with a cancellation result produced `["loading true", "setup called after cancellation", "Google sign in failed: UNAUTHORIZED", "loading false"]`. Existing wrapper tests cover failures/success/device removal but no cancellation.
- Suggested fix: Give Google auth an explicit cancelled/success/error result and return without setup or an alert on cancel. Reset loading in a finally block. Add the missing cancellation case.
- Compatibility: App patch; unchanged API.

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

### MOB-04. Tracking coordination still combines provisioning, replay, upload policy and session teardown in one module

- Location: `apps/mobile/lib/tracking.ts:50`; `apps/mobile/lib/tracking.ts:584`; `apps/mobile/lib/tracking.ts:882`.
- Category: design.
- Severity: low.
- Launch recommendation: post-beta, unless touching the same state to repair a verified blocker.
- Confidence: high for maintainability scope; no new failure asserted.
- Concrete maintenance scenario: Changing upload-rejection handling requires understanding `uploadRejectedKeys`, key-check state, reconciliation cancellation, foreground/native queue ownership, and unauthorized teardown across a 1,039-line module. The upload loop may invoke teardown while reconciliation is also active, so a local change can alter a distant promise lifecycle. There are useful tests and cancellation generations; a wholesale rewrite would risk those protections.
- Suggested fix: Preserve current behaviour and tests. Extract a typed queue-upload policy/runner with injected queue and API dependencies, leaving one coordinator to own stop/resume and reconciliation generations. Document the state transitions in tests. The map has already extracted camera/selection/grouping hooks; use that scale of focused extraction, not a pre-beta UI rewrite.

### CN-04. Old personal-data and unscoped device-key migration paths remain in the beta runtime

- Location: `packages/encryption/src/personalData.ts:29`, `apps/mobile/lib/personalData.ts:63`, `apps/mobile/lib/deviceKeys.ts:124`, `packages/encryption/src/index.ts:364`, `packages/encryption/src/index.ts:427`.
- Category: design.
- Severity: low.
- Launch: post-beta unless the owner chooses to reset all development installs before the first beta.
- Confidence: high on unused writer/exports and retained branches. Data-migration policy requires an owner choice.
- Failure scenario: Maintaining an obsolete personal-data writer and reader requires every future format/key-lifecycle change to consider a format current application code never writes. The unscoped device-key migration attributes any old device key to the first account that signs in, which can produce a server registration conflict for that account. Unused exports imply a larger supported interface than actual callers require.
- Evidence: Current application writer uses `sealPersonalDataForHistoryKey`; `sealPersonalData` is referenced only by encryption tests. `decodeUtf8Payload` and `getRecordEpochId` have no application callers. Migration branches still execute in `getStoredDeviceKeyContext`. Native in-memory stores are also test/benchmark-only main sources.
- Suggested fix: Decide explicitly whether pre-beta development data must survive. If not, remove the legacy writer/readers and migration together; otherwise retain a small bounded migration with ownership validation. Remove unused exports, move test doubles out of native production sources, and retain vector helpers needed by tests. This needs no module rewrite.
- Prior review: S1-05/S6-16, grouped and narrowed.

### O2. Unused files, exports and dependencies remain after the feature work

- Location: apps/backend/src/helpers/db.ts:1; apps/mobile/hooks/useGroupLivePositions.ts:1; apps/mobile/components/ui/Accordion.tsx:1; apps/mobile/package.json:29,53,54.
- Category: design. Severity: low. Launch: post-beta.
- Scenario: maintainers patch an unused live-position hook expecting the shipped map to change, or preserve unused UI/dependencies through upgrades. All three files have no consumers outside their own definitions; expo-glass-effect and expo-image have no source/config imports, and accordion is only imported by the unused Accordion component.
- Evidence: tooling/knip-configured.log plus repo-wide rg consumer checks. Knip also reports 40 exported values and 4 exported types unused outside their files, often tested locally or intentionally reusable UI parts. These are candidates to unexport, not 44 deletion orders.
- Fix: remove the three unused modules and their exclusively used dependencies after confirming native autolinking intent; remove unused exports rather than tested implementations. Keep babel-preset-expo (babel.config.js), expo-build-properties (app.json), expo-dev-client (development builds), and @prisma/client (generated Prisma runtime) despite Knip flags.

### O3. Scheduled-job integration tests rely on a transitive AWS dependency

- Location: apps/scheduled-jobs/src/jobs/imageUploadCleanup.integration.test.ts:6; apps/scheduled-jobs/package.json:17.
- Category: design. Severity: low. Launch: post-beta.
- Scenario: isolate workspace dependencies or remove API's AWS dependency and image-cleanup integration tests fail to resolve their own direct AWS import.
- Evidence: default and configured Knip agree; direct import absent from workspace manifest. Current hoisted install resolves it.
- Fix: declare @aws-sdk/client-s3 directly in runner devDependencies when doing dependency cleanup.

### MOB-05. Generated UI scaffolding still exposes unused options and violates local function/type conventions

- Location: `apps/mobile/components/ui/Input.tsx:39`, `apps/mobile/components/ui/Select.tsx:144`, `apps/mobile/components/ui/Icon.tsx:31`, `apps/mobile/components/dialogs/CreateGroupDialog.tsx:32`.
- Category: style.
- Severity: low.
- Launch recommendation: post-beta; one grouped cleanup.
- Confidence: high by source inspection; first-review carry-over.
- Concrete maintenance scenario: `hideError` and `descriptionPosition` appear supported on Input but are discarded, `SelectItem` accepts/destructures children without rendering them, and component boilerplate retains function declarations, single-use Props aliases and tutorial comments contrary to AGENTS.md. A caller relying on the prop contract gets behaviour different from its type signature, and a maintainer must distinguish real extension points from copied scaffolding.
- Suggested fix: Remove unsupported options or implement only those actually needed, remove unused children plumbing/tutorial comments, and apply local const/inline-type conventions when editing each primitive. Let dead-code tooling confirm removals and keep test-only public helpers that support behavioural tests.

## Cross-cutting conclusions

The cross-cutting pass followed the section passes. It compared error handling, response shapes, validation, UI states, offline execution, deadlines, lock order, session cleanup and supported-version behavior. The detailed matrix is in [raw/cross-cutting.md](raw/cross-cutting.md).

- Structured `ErrorReason` and device causes now cover actionable tRPC failures. Keep useful distinctions between auth, application and local-admin responses. Differing success envelopes alone are not a defect. Group projections need one explicit shared selection, as SR-07 describes.
- Local-first actions and server-only mutations require different offline policies. TanStack's default online mode conflicts with sharing's own durable local queue. Audit local side effects when fixing MOB-01, without globally enabling every mutation offline.
- Network deadlines, database statement/transaction limits and the shared Redis timeout/reconnect policy are present. No reproducible cyclic database/native deadlock was found. Remaining stalls are key-storage ownership, rate-limit/timeout conflict and provider I/O under a transaction; they are not evidence every request can hang.
- Five import cycles are recorded in `tooling/cycles.json`, including dynamic imports between sessionLink/signOut/endSession/deviceKeys. They support MOB-04's focused ownership refactor. No initialization failure was reproduced, so there is no separate high-severity cycle finding.
- Loading, empty, stale and failed states need consistent meanings. Devices already has a useful error/retry pattern; map/groups are the exceptions. UI scaffolding/style debt is grouped once in MOB-05.
- Prefer small refactors around secret persistence, durable media cleanup, tracking queue upload policy and group projections. Preserve the tested cancellation and cryptographic boundaries. No evidence warrants rewriting the native capture service or replacing HPKE.

## Version skew and encrypted formats

Current app/server compatibility level 4 is the beta baseline. Reviewed health/header/426/404 frozen shapes, sticky mismatch handling, background upload gating and current Kotlin/TypeScript encrypted payload formats. Shared vectors and compatibility tests pass. No current supported-version wire or ciphertext mismatch was identified. The documentation explicitly excludes older unshipped level-4 development builds; do not turn that development history into a supported-release bug.

Each resolution still needs a compatibility assessment. Optional input additions are not safe when an old server silently ignores behavior the new app relies on, as CN-05 explains. Keep Device-wrap serialized bytes stable and add the missing vector in CN-03. A schema or encrypted-format rewrite needs an explicit migration/reader plan and the required app/server level and minor-version changes. Most launch fixes appear possible without changing wire formats; that is a proposal to verify during resolution, not authorization to skip the check.

## Accepted privacy limits that must remain visible

The current beta threat model trusts the backend's public-key directory and wrap sender identities. An actively malicious backend can substitute keys and undermine confidentiality of future data. Group symmetric keys also do not prove per-sender authorship. Device removal cannot erase keys or locations already learned; retained History keys are an explicit ADR decision. Profile/group images are public and not end-to-end encrypted. The server sees account/group relationships and traffic metadata.

These are existing accepted architectural limits in `docs/security/beta-1-privacy-draft.md` and ADRs 0001/0002, not newly discovered high/critical bugs. The user-facing claim that the hosted operator can know nothing about activity exceeds this beta design. Confirm launch wording against these limits; changing the threat model is a separate explicit design decision, not an incidental cleanup task.

## Tooling evidence and limits

- Frozen Bun install succeeded. Initial CI stopped because dependencies were absent; after installation `bun run ci` passed. Its first successful run replayed all 14 Turbo tasks. `TURBO_FORCE=true bun run ci` then passed with 14 successful tasks and zero Turbo cache hits. A short intermediate rerun caught only formatting of this review's Knip JSON artifact; it was formatted and rerun successfully. CI implementation itself was not reviewed.
- CI skips database integration tests. A separate run uses disposable PostgreSQL 16.15 and Dragonfly containers, existing migrations and placeholder provider credentials. The full run recorded 337 pass, one skip and one failure: the pending-device setup scenario exceeded its five-second test deadline. The same file again timed out at the default deadline, then passed all four tests with `--timeout=30000`. The timing middleware deliberately adds 100-499 ms per API call whenever tRPC is in test/development mode; the failed scenario chains many calls. This establishes a test deadline limitation, not a demonstrated production deadlock. Keep the failed full-suite result visible; no clean full-suite pass is claimed. See `tooling/integration.log` and both pending-device recheck logs. The first attempt used too-short placeholder S3 credentials and failed environment validation; that setup failure is retained separately, not classified as a product defect.
- The initially skipped Redis outage case was run separately. Its first failure came from Docker moving the dynamic host port on restart. An independent reviewer repeated it with a fixed port; it passed all eight assertions, including recovery of the same cache instance after a 35-second outage. See `raw/redis-verification.md` and `tooling/redis-restart-fixed-port.log`.
- Native JVM and Android unit/Robolectric suites passed. Android results have 59 tests across Notices, offline queue, capture service and sharing-resume fixtures, zero failures/errors; see `tooling/android-test-results.json`. Turbo was bypassed but Gradle may reuse up-to-date tasks. No physical-device/emulator UI walkthrough or OEM background-runtime acceptance was performed.
- Independent probes reproduce the offline mutation scheduler and rejected-deletion data loss. Fault injection demonstrates stalled reads and delayed-write cleanup ordering; it does not prove a normal platform hang. Logs and portable text copies of probes are retained under `tooling/` and `raw/probes/`. Replace the captured absolute checkout prefix when rerunning probes elsewhere.
- Full `bun audit` reports 13 advisories: four high, seven moderate, two low. The configured CI audit passes with its four documented high exceptions. Source/import checks support the documented Metro/Expo CLI-only reachability for image-size and Zod 3; runtime project Zod 4 is patched. Runtime decode-uri-component remains an accepted crafted-deep-link denial-of-service risk. The [reviewed advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) supports retaining that risk, not claiming the dependency graph is vulnerability-free.
- New [node-forge signature](https://github.com/advisories/GHSA-6889-vf6x-f3g5) and [TLS](https://github.com/advisories/GHSA-w4xr-hqv8-ch44) advisories resolve through Expo CLI. No production use of those Forge APIs was found. Update the maintenance inventory on the next tooling upgrade. Full results are in `tooling/audit-all.log`; exception rationale remains `docs/security/dependency-audit-ignores.md`.
- Default Knip encounters an existing Metro loader failure. Explicit workspaces with Expo/Metro discovery disabled complete successfully; both outputs and the config are retained. Three unused modules and unused runtime dependencies were checked with source searches. Forty unused value exports, four unused exported types and two duplicate-export groups are candidates, not automatic removal instructions. Babel/Expo plugins, dev-client and generated Prisma runtime false positives were excluded.
- No real S3/R2/CDN/SMTP/Google provider credentials were exercised. Arbitrary-content acceptance is established by code, while CDN execution, real provider timeout behavior and end-to-end mail delivery require deployment checks. Source review cannot prove final visual, keyboard or TalkBack behavior.

## Coverage and resumption

All section passes and the later cross-cutting pass are complete. Per-file checklists are in `raw/server.md`, `raw/mobile.md` and `raw/crypto-native.md`; supporting/deployment coverage is in `raw/supporting.md`. `tooling/tracked-files.txt` captures the baseline inventory. Production modules, relevant tests, manifests, scripts, deployment docs, domain contexts and ADRs were reviewed. Generated Prisma source, vendored dependencies and binary assets were not line-reviewed; dependency/format/packaging tests provide narrower checks. CI workflow design was explicitly out of scope.

The prior review is reference material, not an additional unapproved resolution backlog. Each carried-forward finding above is rechecked against this commit. Resolved first-review problems such as server cookie scoping, leaver-chosen epochs, startup sharing permission state, Redis recovery, upload budgets, Google linking, tolerant tracking payloads and the update action were not re-reported as open defects. Rejected hypotheses and uncertainty are recorded in each raw report.

The resolution work begins with scope clarification and design choices, then moves to ordered implementation, regression tests, version/format assessment and a local resolution checklist. This report authorizes identification and planning only.
