# Encryption, native tracking, and compatibility review

Reviewed `caccd60e406204c52523910974eeea5811e2e36b`. No application changes.

## Scope and evidence

- Read both encryption ADRs and `docs/contexts/encryption/CONTEXT.md`; reviewed first-pass S1/S6/S10 and the resolution log in the first report.
- Read every production TypeScript file in `packages/encryption`, `packages/schemas`, and `packages/shared`, including algorithm constants, HPKE implementations, encoded-byte validation, sharing revisions and frozen compatibility headers.
- Read all native production Kotlin files, manifests, plugin setup and Gradle dependency declarations in `apps/mobile/modules/openbeacon-tracking`. Inspected native tests for capture generations, sharing resumes, queue ownership, interruption recovery and byte-identical TS/Kotlin encryption.
- Read mobile crypto libraries individually as listed below, plus the tracking reconciliation/upload chain, session cleanup, server URL normalization and compatibility handshake on both sides.
- `bun test --isolate packages/encryption packages/schemas packages/shared`: 184 pass, 0 fail.
- Targeted mobile crypto/compatibility tests: 255 pass, 0 fail across 16 files. See `tooling/mobile-crypto-tests.log`.
- `./gradlew test --no-daemon` from the native JVM fixture: 44 tests, 0 failures, 0 errors. Shared ciphertext/AAD interop vectors pass. See `tooling/native-jvm-tests.log`.
- Android SDK service/Room tests and real-device startup behavior were not executed in this pass. JVM tests intentionally exclude Android service/Room/Keystore classes. Do not treat the JVM result as validation of those platform behaviors.

## Findings

### CN-01. A stalled History-key read holds the tracking reconciliation promise and prevents later upload attempts

- Location: `apps/mobile/lib/historyKeys.ts:9`, `apps/mobile/lib/tracking.ts:127`, `apps/mobile/lib/tracking.ts:131`, `apps/mobile/lib/tracking.ts:491`, `apps/mobile/lib/tracking.ts:856`.
- Category: bug.
- Severity: medium.
- Launch: must fix before beta if stalled native storage is included in the launch reliability requirements.
- Confidence: high on the control-flow failure; no real-device SecureStore hang reproduced.
- Failure scenario: A native SecureStore read never settles while reconciliation checks the current History key or a previously missing version. `syncBackgroundTracking` awaits reconciliation before flushing the queue, and subsequent background invocations return the same pending `reconcilePromise`. The 60-second headless task timeout does not settle this JavaScript promise. While the JS process lives, further background upload invocations wait again; native capture can continue until queue eviction loses old points. Existing tests show session teardown detaches stalled reconciliation, so this is not a permanent lock across sign-out/restart.
- Evidence: Outside-repository fault-injection test holds `SecureStore.getItemAsync` pending and confirms the real helper remains pending. See `tooling/history-storage-probe.log`. Direct read of the await/single-flight chain. `deviceKeys.ts` already bounds the corresponding device-key storage operations at 10 seconds and tests stalled SecureStore reads. The History-key helper has no deadline, nor does the reconciliation work have an overall deadline. This is a conditional robustness bug, not a claim that normal SecureStore reads hang.
- Suggested fix: Bound History-key reads and writes through one storage adapter, preserving the underlying write ownership so timeout/retry cannot replace an identity being persisted. Also detach a timed-out reconciliation generation and prevent late work from installing keys or mutating another session. Add one test that never resolves the History-key read and proves later tracking uploads can proceed with already provisioned keys. Do not silently interpret a timeout as a missing key or create a replacement History key.

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

### CN-06. Key-storage writes are not coordinated with key wiping

- Location: `apps/mobile/lib/historyKeys.ts:21`, `apps/mobile/lib/historyKeys.ts:35`, `apps/mobile/lib/recovery.ts:250`, `apps/mobile/lib/deviceLink.ts:105`, `apps/mobile/lib/endSession.ts:128`.
- Category: security.
- Severity: medium.
- Launch: must fix before beta if phone removal is intended to guarantee local key erasure while asynchronous setup work is in progress.
- Confidence: high on a deterministic delayed-native-write reproduction; no claim that normal Android SecureStore scheduling necessarily produces this ordering.
- Failure scenario: Restore or device linking starts persisting a History key. Before that native write settles, a remote phone removal triggers `endSession` and its key wipe. The wipe completes and the phone reports itself removed. The earlier write then finishes and leaves the History private key in SecureStore again. These helpers have neither a key-owner generation check nor serialization with deletion. The device registration generation guards server registration and native provisioning, but does not govern History-key storage. A plain sign-out deliberately keeps keys and is not a failure scenario here.
- Evidence: A temporary test outside the repository mocks a blocked native `setItemAsync`, starts the real `storeHistoryKey`, runs the real `deleteStoredHistoryKeys` through completion, releases the write, and observes `encryption.history.review.1` present again. Both probe tests pass; log at `tooling/history-storage-probe.log`. No production files were modified. Real platform write/delete ordering remains a platform validation item.
- Suggested fix: Give per-account key writes and destructive deletion one owner. On removal, invalidate that owner's generation and ensure any already started persistence finishes before the final delete, or delete again when an invalidated write completes. Bound the caller's wait while preserving eventual cleanup. Apply the same rule to device keys and saved device-link secrets. Test wipe during each setup/storage stage, and late completion after timeout.

## Accepted security limitations, not new beta blockers

These remain in current code and in ADR 0001/0002. Do not rediscover them as critical vulnerabilities without changing the project's threat model:

- The server supplies Device/History recipient public keys and wrap sender keys. There is no independent identity verification until OPE-213, so a malicious server can substitute future recipients. HPKE authenticates against the provided key, not an independently verified identity.
- The app does not pin a monotonically increasing epoch number; hostile-server rollback resistance remains deferred.
- Group keys are shared symmetric keys; they do not provide per-sender signatures. A malicious group member can forge payloads or distribute inconsistent keys. The server cannot prove all wraps contain one key without an additional protocol.
- An offline phone can keep capturing under a superseded epoch until it learns of rotation. Revocation cannot erase keys or ciphertext already held by a removed member.
- Existing History keys persist on other enrolled devices after Recovery reset, as the ADR explicitly specifies. Re-sealing of personal data is separate.

## Cross-cutting observations

- The package uses domain-separated HPKE info and payload AAD consistently. Payload AAD agrees byte-for-byte between Kotlin and TypeScript; tests pin tampering and key mismatch behavior.
- The current v1 tracking reader tolerates unknown fields and nullable battery level. The Kotlin encoder now filters non-finite speed/coordinates. These first-review problems are resolved.
- Session and activation challenges bind user/device and distinct purposes. Device links use the QR PSK and recipient key, verify private/public History-key correspondence, and reject missing current keys.
- Key metadata is checked before native provisioning; revision/generation checks prevent post-pause queue insertion and detach session teardown from old reconciliation work. No cyclic lock order was found across captureLock, EpochKeyStore and Room operations.
- Native Room claims occur inside a transaction, IN_FLIGHT recovery uses a two-minute age, queue eviction is bounded by active SQLite pages, and deletion is owner/group scoped. Production native ownership and ciphertext-only storage were reviewed; Android Room migrations were inspected, not executed here.
- Frozen 426/404 handling, per-response level headers, sticky mismatch state, server-version reset, Play Store action and background compatibility gate are present. No unsupported encrypted format or level mismatch was found in the current baseline.
- `TrackingCaptureService` is a large lifecycle owner but its queue, cryptography, sampling policy and state objects are already separate. Further rewrite would add launch risk. Address concrete availability/startup issues with small changes and platform regression tests.
- First-review C10 remains a platform verification item: late stop/start commands and permission loss can still hit branches that stop after a foreground-service launch. There is no new claim of a device crash without reproducing it. The indefinite-pause foreground startup path now promotes before parking and has a Robolectric regression test.

## Mobile crypto file checklist

- [x] `apps/mobile/lib/deviceKeys.ts`
- [x] `apps/mobile/lib/historyKeys.ts`
- [x] `apps/mobile/lib/epochKeys.ts`
- [x] `apps/mobile/lib/groupEncryption.ts`
- [x] `apps/mobile/lib/groupKeyAccess.ts`
- [x] `apps/mobile/lib/currentHistoryKey.ts`
- [x] `apps/mobile/lib/createHistoryKey.ts`
- [x] `apps/mobile/lib/recovery.ts`
- [x] `apps/mobile/lib/deviceLink.ts`
- [x] `apps/mobile/lib/deviceActivation.ts`
- [x] `apps/mobile/lib/sessionLink.ts`
- [x] `apps/mobile/lib/savedDeviceLink.ts`
- [x] `apps/mobile/lib/personalData.ts`
- [x] `apps/mobile/lib/resealPersonalData.ts`
- [x] `apps/mobile/lib/protectHistory.ts`
- [x] `apps/mobile/lib/historyLossRisk.ts`
- [x] `apps/mobile/lib/secureStoreOptions.ts`
- [x] `apps/mobile/lib/apiCompatibility.ts`

## Package/native production file checklist

- [x] `packages/encryption/package.json`
- [x] `packages/encryption/src/base64.ts`
- [x] `packages/encryption/src/constants.ts`
- [x] `packages/encryption/src/deviceActivation.ts`
- [x] `packages/encryption/src/deviceLink.ts`
- [x] `packages/encryption/src/hpke.ts`
- [x] `packages/encryption/src/index.ts`
- [x] `packages/encryption/src/personalData.ts`
- [x] `packages/encryption/src/recovery.ts`
- [x] `packages/encryption/src/sensitive.ts`
- [x] `packages/encryption/src/sessionLink.ts`
- [x] `packages/encryption/src/testVectors/device-challenges-v1.json`
- [x] `packages/encryption/src/testVectors/device-link-v1.json`
- [x] `packages/encryption/src/testVectors/group-payload-interop-v1.json`
- [x] `packages/encryption/src/testVectors/recovery-v1.json`
- [x] `packages/encryption/src/trackingPoint.ts`
- [x] `packages/encryption/src/types.ts`
- [x] `packages/encryption/tsconfig.json`
- [x] `packages/schemas/package.json`
- [x] `packages/schemas/src/env.ts`
- [x] `packages/schemas/src/index.ts`
- [x] `packages/schemas/src/schemas/account/changePassword.ts`
- [x] `packages/schemas/src/schemas/account/devices.ts`
- [x] `packages/schemas/src/schemas/account/emailAlerts.ts`
- [x] `packages/schemas/src/schemas/account/emailCode.ts`
- [x] `packages/schemas/src/schemas/account/fields.ts`
- [x] `packages/schemas/src/schemas/account/locationSharing.ts`
- [x] `packages/schemas/src/schemas/account/signIn.ts`
- [x] `packages/schemas/src/schemas/account/signUp.ts`
- [x] `packages/schemas/src/schemas/auth/accountRecovery.ts`
- [x] `packages/schemas/src/schemas/auth/registerDeviceKey.ts`
- [x] `packages/schemas/src/schemas/feedback/submitFeedback.ts`
- [x] `packages/schemas/src/schemas/group/create.ts`
- [x] `packages/schemas/src/schemas/group/inviteMember.ts`
- [x] `packages/schemas/src/schemas/group/removeMember.ts`
- [x] `packages/schemas/src/schemas/group/tracking.ts`
- [x] `packages/schemas/src/schemas/image/requestImageUpload.ts`
- [x] `packages/schemas/tsconfig.json`
- [x] `packages/shared/package.json`
- [x] `packages/shared/src/apiCompatibilityLevel.ts`
- [x] `packages/shared/src/deviceIdHeader.ts`
- [x] `packages/shared/src/deviceRemoved.ts`
- [x] `packages/shared/src/errorReason.ts`
- [x] `packages/shared/src/index.ts`
- [x] `packages/shared/src/locationSharing.ts`
- [x] `packages/shared/src/locationSharingTypes.ts`
- [x] `packages/shared/src/utils/checkServices.ts`
- [x] `packages/shared/src/utils/errorCode.ts`
- [x] `packages/shared/src/utils/logRateLimit.ts`
- [x] `packages/shared/src/utils/tryCatch.ts`
- [x] `packages/shared/src/utils/validateEnv.ts`
- [x] `packages/shared/tsconfig.json`
- [x] `apps/mobile/modules/openbeacon-tracking/android/build.gradle`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/AndroidManifest.xml`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/Notices.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/OpenBeaconTrackingModule.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/TrackingRuntime.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/BatteryReader.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/BatterySnapshot.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/BootRestartPolicy.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/CaptureCommandState.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/CapturePipeline.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/CaptureRefreshState.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/CaptureSamplingPolicy.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/SharingCaptureState.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/SharingResumeWorker.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingBootReceiver.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingCaptureService.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/capture/TrackingUploadService.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/crypto/Base64Codec.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/crypto/EncryptedGroupPayload.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/crypto/GroupPayloadEncrypt.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/keys/EpochKeyStore.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/keys/InMemoryEpochKeyStore.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/keys/ProvisionedEpochKey.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/keys/SecureEpochKeyStore.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/CiphertextQueue.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/CiphertextQueueDao.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/CiphertextQueueDatabase.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/CiphertextQueueEntity.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/CiphertextQueueEvictionEntity.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/CiphertextQueueRow.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/InMemoryCiphertextQueue.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/java/expo/modules/openbeacontracking/queue/RoomCiphertextQueue.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/res/drawable/openbeacon_notification_icon.xml`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/res/values/colors.xml`
- [x] `apps/mobile/modules/openbeacon-tracking/android/src/main/res/values/strings.xml`
- [x] `apps/mobile/modules/openbeacon-tracking/app.plugin.js`
- [x] `apps/mobile/modules/openbeacon-tracking/expo-module.config.json`
- [x] `apps/mobile/modules/openbeacon-tracking/index.ts`
- [x] `apps/mobile/modules/openbeacon-tracking/jvm/build.gradle.kts`
- [x] `apps/mobile/modules/openbeacon-tracking/jvm/settings.gradle.kts`
- [x] `apps/mobile/modules/openbeacon-tracking/jvm/src/main/kotlin/expo/modules/openbeacontracking/crypto/Base64Codec.kt`
- [x] `apps/mobile/modules/openbeacon-tracking/package.json`
- [x] `apps/mobile/modules/openbeacon-tracking/plugin/withOpenBeaconTracking.js`
- [x] `apps/mobile/modules/openbeacon-tracking/src/OpenBeaconTrackingModule.ts`
- [x] `apps/mobile/modules/openbeacon-tracking/src/index.ts`

## Parent validation supplement

After this section pass, the root reviewer ran uncached CI including the Android SDK unit/Robolectric tests. All 59 Android tests passed; see tooling/android-test-results.json and tooling/ci-uncached.log. Real-device startup/OEM behavior remains unverified.
