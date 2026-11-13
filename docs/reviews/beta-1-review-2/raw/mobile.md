# Mobile section review

Reviewed HEAD `caccd60e406204c52523910974eeea5811e2e36b`. Review only. No application code changed.

## Coverage and method

- [x] Auth screens and client transport, server switching, session cleanup and routing.
- [x] Device registration, session linking, setup, activation, removal and device links.
- [x] Recovery screens, escrow/History key callers, personal data, backfill and protection progress.
- [x] TrackingProvider, LocationPermissionProvider, tracking.ts, permissions, notifications, sharing and upload error policy.
- [x] Group list, invites, joins, group membership/roles, settings, colours and nicknames.
- [x] Live map session, polling/cursors, decryption, key resolution, membership, pause visibility and stale data.
- [x] Map rendering, cameras, marker clustering/edge chips, people tray and sheets.
- [x] Account/device screens, image processing/uploads, support and theme.
- [x] UI primitives, forms, dialogs/alerts, keyboard handling, accessibility labels, typography and loading/error states.
- [x] Small hooks, pure helpers, app declarations/entry point and map packaging script.
- [x] Read CONTEXT-MAP, Accounts/Encryption/Places context docs and ADRs 0001/0002; read first-review decisions and relevant raw section findings to identify carry-over debt.
- [x] Read relevant tests including googleAuth, groupKeyAccess and timeout/session tests. Root reviewer owns full CI results and dependency/dead-code tooling.

The file checklist below enumerates production TypeScript coverage. Native implementation belongs to the native/crypto reviewer. Test helpers are excluded as production findings targets. Source-level UI review cannot establish actual rendering, touch-target geometry, keyboard behaviour or TalkBack navigation on a device. No emulator was driven during this section pass.

## Must fix before beta

### MOB-01. Offline pause never reaches the local pause implementation and locks its dialog

- Location: `apps/mobile/components/LocationSharingCard.tsx:108`; related `apps/mobile/lib/networkStatus.ts:34`, `apps/mobile/lib/locationSharing.ts:279`, `apps/mobile/components/LocationSharingCard.tsx:253`.
- Category: bug.
- Severity: high.
- Confidence: high; independently reproduced by parent reviewer with installed query-core.
- Failure scenario: A phone is sharing, loses connectivity, and its owner taps Pause sharing. OfflineBanner has set `onlineManager` false. TanStack's default online mutation mode pauses the mutation before `changeLocationSharing` runs. No pending preference is saved and no native local pause is applied. The card stays pending, and hardware-back, backdrop and Cancel are disabled indefinitely. Capture continues while offline. Closing/restarting the app discards the unexecuted mutation, so reconnection can upload locations captured after the owner tried to pause.
- Evidence: Installed `@tanstack/query-core` probe with QueryClient + MutationObserver: offline `mutate()` yields `{ applied:false, status:"pending", isPaused:true }`; only setting online true runs the mutationFn. `api.ts` sets no mutation default; root layout always mounts OfflineBanner. `changeLocationSharing` writes local preference and calls native sharing only inside mutationFn. Parent retained an independent probe in `tooling/offline-mutation-probe.log`.
- Suggested fix: Run local sharing operations with `networkMode:"always"` so the local pause is persisted immediately and server replay remains owned by `locationSharing.ts`. Audit the resume banner and other local mutations for the same policy. Add an offline integration test through the actual mutation wrapper; a direct helper test misses this bug. Preserve a cancellable UI and explicit queued state.
- Compatibility: App patch; no API/format change is needed.

## Other beta work to prioritize

### MOB-02. Initial query failures still become empty groups or an endless map loader

- Location: `apps/mobile/app/(tabs)/groups/list.tsx:30`, `apps/mobile/app/(tabs)/groups/list.tsx:89`; `apps/mobile/components/map/NativeMap.tsx:337`; `apps/mobile/hooks/useSignedPmtilesUrl.ts:30`.
- Category: UX.
- Severity: medium.
- Launch recommendation: fix before beta, after security/data blockers.
- Confidence: high by source inspection; carry-over from first review S9-03 and S7-03.
- Failure scenario: The app has a valid session but the self-hosted server cannot return groups or map URLs. After retries, groups defaults undefined data to empty arrays and tells an existing group member they have no groups. The map retries indefinitely and renders only a spinner, without an actionable error or access to its people tray. A user cannot tell a temporary outage from an account/data problem.
- Evidence: Groups only checks isPending; isError is discarded. NativeMap's no-style branch renders ActivityIndicator alone, and signed URL retries every non-UNAUTHORIZED error indefinitely. The account Devices screen already has explicit loading/error/retry states, so this is inconsistent with the working UI pattern.
- Suggested fix: Handle first-load error before empty-state rendering. Keep stale data with an error banner on refetch failure. Give map URL/loading failures a bounded loading phase and Retry; keep the people/status list available without a base map. Shared query-state components should preserve different empty/failure meanings.
- Compatibility: App patch; unchanged API.

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

## Post-beta refactor

### MOB-04. Tracking coordination still combines provisioning, replay, upload policy and session teardown in one module

- Location: `apps/mobile/lib/tracking.ts:50`; `apps/mobile/lib/tracking.ts:584`; `apps/mobile/lib/tracking.ts:882`.
- Category: design.
- Severity: low.
- Launch recommendation: post-beta, unless touching the same state to repair a verified blocker.
- Confidence: high for maintainability scope; no new failure asserted.
- Concrete maintenance scenario: Changing upload-rejection handling requires understanding `uploadRejectedKeys`, key-check state, reconciliation cancellation, foreground/native queue ownership, and unauthorized teardown across a 1,039-line module. The upload loop may invoke teardown while reconciliation is also active, so a local change can alter a distant promise lifecycle. There are useful tests and cancellation generations; a wholesale rewrite would risk those protections.
- Suggested fix: Preserve current behaviour and tests. Extract a typed queue-upload policy/runner with injected queue and API dependencies, leaving one coordinator to own stop/resume and reconciliation generations. Document the state transitions in tests. The map has already extracted camera/selection/grouping hooks; use that scale of focused extraction, not a pre-beta UI rewrite.

### MOB-05. Generated UI scaffolding still exposes unused options and violates local function/type conventions

- Location: `apps/mobile/components/ui/Input.tsx:39`, `apps/mobile/components/ui/Select.tsx:144`, `apps/mobile/components/ui/Icon.tsx:31`, `apps/mobile/components/dialogs/CreateGroupDialog.tsx:32`.
- Category: style.
- Severity: low.
- Launch recommendation: post-beta; one grouped cleanup.
- Confidence: high by source inspection; first-review carry-over.
- Concrete maintenance scenario: `hideError` and `descriptionPosition` appear supported on Input but are discarded, `SelectItem` accepts/destructures children without rendering them, and component boilerplate retains function declarations, single-use Props aliases and tutorial comments contrary to AGENTS.md. A caller relying on the prop contract gets behaviour different from its type signature, and a maintainer must distinguish real extension points from copied scaffolding.
- Suggested fix: Remove unsupported options or implement only those actually needed, remove unused children plumbing/tutorial comments, and apply local const/inline-type conventions when editing each primitive. Let dead-code tooling confirm removals and keep test-only public helpers that support behavioural tests.

## Rejected or constrained candidates

- `checkGroupKeyAccess` appeared to treat unreadable current data as readable history. Existing tests intentionally separate current access from older history and pin the newest contiguous-run semantics, so no bug was reported without a different product requirement.
- No confirmed deadlock found in reconciliation/teardown: generation invalidation and cancellation races release public waits. Individual transport requests have tRPC/auth limits; upload PUT has a 60-second abort. Native storage/bridge indefinite waits remain owned by the native reviewer.
- Malicious-server key substitution and non-per-device History keys are explicit ADR trust limits, not new findings. The final report should retain those launch decisions separately from accidental implementation bugs.
- General offline mutation suspension also affects group/account forms and local dismissal operations. Treat it as the same cross-cutting network-mode policy as MOB-01 unless a separate destructive scenario is proven.
- No claim of visual consistency based on source alone. Headers/padding/error-copy patterns were inspected, but device layout and accessibility need a release-device acceptance pass.

## File coverage

- [x] `apps/mobile/app/(tabs)/_layout.tsx`
- [x] `apps/mobile/app/(tabs)/account/overview.tsx`
- [x] `apps/mobile/app/(tabs)/account/profile.tsx`
- [x] `apps/mobile/app/(tabs)/groups/[groupId]/HistoryTab.tsx`
- [x] `apps/mobile/app/(tabs)/groups/[groupId]/MembersTab.tsx`
- [x] `apps/mobile/app/(tabs)/groups/[groupId]/SettingsTab.tsx`
- [x] `apps/mobile/app/(tabs)/groups/[groupId]/index.tsx`
- [x] `apps/mobile/app/(tabs)/groups/list.tsx`
- [x] `apps/mobile/app/(tabs)/map/index.tsx`
- [x] `apps/mobile/app/+native-intent.tsx`
- [x] `apps/mobile/app/_layout.tsx`
- [x] `apps/mobile/app/account/about.tsx`
- [x] `apps/mobile/app/account/add-device.tsx`
- [x] `apps/mobile/app/account/contact-us.tsx`
- [x] `apps/mobile/app/account/delete.tsx`
- [x] `apps/mobile/app/account/devices.tsx`
- [x] `apps/mobile/app/account/email-alerts.tsx`
- [x] `apps/mobile/app/account/notifications.tsx`
- [x] `apps/mobile/app/account/password.tsx`
- [x] `apps/mobile/app/account/recovery-change.tsx`
- [x] `apps/mobile/app/account/recovery-reset.tsx`
- [x] `apps/mobile/app/account/recovery-restore.tsx`
- [x] `apps/mobile/app/account/recovery-setup.tsx`
- [x] `apps/mobile/app/account/recovery.tsx`
- [x] `apps/mobile/app/account/remove-device.tsx`
- [x] `apps/mobile/app/account/sign-out-others.tsx`
- [x] `apps/mobile/app/account/theme.tsx`
- [x] `apps/mobile/app/device-removed.tsx`
- [x] `apps/mobile/app/forgotPassword.tsx`
- [x] `apps/mobile/app/index.tsx`
- [x] `apps/mobile/app/join.tsx`
- [x] `apps/mobile/app/serverUrl.tsx`
- [x] `apps/mobile/app/setup/index.tsx`
- [x] `apps/mobile/app/setup/link.tsx`
- [x] `apps/mobile/app/setup/name.tsx`
- [x] `apps/mobile/app/setup/remove-devices.tsx`
- [x] `apps/mobile/app/setup/waiting.tsx`
- [x] `apps/mobile/app/signIn.tsx`
- [x] `apps/mobile/app/signUp.tsx`
- [x] `apps/mobile/components/ApiCompatibilityGate.tsx`
- [x] `apps/mobile/components/BeaconIcon.tsx`
- [x] `apps/mobile/components/BrandedQrCode.tsx`
- [x] `apps/mobile/components/ConfirmIdentity.tsx`
- [x] `apps/mobile/components/EmailCodeEntry.tsx`
- [x] `apps/mobile/components/KeyboardFormScrollView.tsx`
- [x] `apps/mobile/components/LoadingIndicator.tsx`
- [x] `apps/mobile/components/LocationSharingCard.tsx`
- [x] `apps/mobile/components/NewRecoveryPhrase.tsx`
- [x] `apps/mobile/components/NewSignInBanner.tsx`
- [x] `apps/mobile/components/OfflineBanner.tsx`
- [x] `apps/mobile/components/RecoveryCoverage.tsx`
- [x] `apps/mobile/components/RecoveryPhraseGrid.tsx`
- [x] `apps/mobile/components/RefreshablePage.tsx`
- [x] `apps/mobile/components/TabBar.tsx`
- [x] `apps/mobile/components/containers/settingsContainer.tsx`
- [x] `apps/mobile/components/dialogs/CreateGroupDialog.tsx`
- [x] `apps/mobile/components/dialogs/InviteMemberToGroupDialog.tsx`
- [x] `apps/mobile/components/dialogs/SharedInvite.tsx`
- [x] `apps/mobile/components/formInputs/FormSelectInput.tsx`
- [x] `apps/mobile/components/headers/BackButton.tsx`
- [x] `apps/mobile/components/headers/ReturnToHomeHeader.tsx`
- [x] `apps/mobile/components/image/EditableImage.tsx`
- [x] `apps/mobile/components/image/GroupImage.tsx`
- [x] `apps/mobile/components/image/ProfileImage.tsx`
- [x] `apps/mobile/components/map/GroupMapColorPicker.tsx`
- [x] `apps/mobile/components/map/LiveMapBottomSheet.tsx`
- [x] `apps/mobile/components/map/LiveMapEdgeChip.tsx`
- [x] `apps/mobile/components/map/LiveMapGroupVisibility.tsx`
- [x] `apps/mobile/components/map/LiveMapMarkerPin.tsx`
- [x] `apps/mobile/components/map/LiveMapMissingPersonSheet.tsx`
- [x] `apps/mobile/components/map/LiveMapPeopleTray.tsx`
- [x] `apps/mobile/components/map/LiveMapPersonSheet.tsx`
- [x] `apps/mobile/components/map/LiveMapPinMotion.tsx`
- [x] `apps/mobile/components/map/LiveMapPointAnnotation.tsx`
- [x] `apps/mobile/components/map/LiveMapStackAnnotation.tsx`
- [x] `apps/mobile/components/map/LiveMapStackPin.tsx`
- [x] `apps/mobile/components/map/LiveMapStackSheet.tsx`
- [x] `apps/mobile/components/map/LocationSharingPausedBanner.tsx`
- [x] `apps/mobile/components/map/NativeMap.tsx`
- [x] `apps/mobile/components/map/useLiveMapCamera.ts`
- [x] `apps/mobile/components/map/useLiveMapCameraCommands.ts`
- [x] `apps/mobile/components/map/useLiveMapEdgeMarkers.ts`
- [x] `apps/mobile/components/map/useLiveMapPinGroups.ts`
- [x] `apps/mobile/components/map/useLiveMapSelection.ts`
- [x] `apps/mobile/components/map/useNativeMapStyle.ts`
- [x] `apps/mobile/components/ui/Accordion.tsx`
- [x] `apps/mobile/components/ui/Alert.tsx`
- [x] `apps/mobile/components/ui/AnimatedView.tsx`
- [x] `apps/mobile/components/ui/Avatar.tsx`
- [x] `apps/mobile/components/ui/Button.tsx`
- [x] `apps/mobile/components/ui/Card.tsx`
- [x] `apps/mobile/components/ui/Dialog.tsx`
- [x] `apps/mobile/components/ui/Field.tsx`
- [x] `apps/mobile/components/ui/Icon.tsx`
- [x] `apps/mobile/components/ui/Input.tsx`
- [x] `apps/mobile/components/ui/Label.tsx`
- [x] `apps/mobile/components/ui/RadioCardGroup.tsx`
- [x] `apps/mobile/components/ui/Select.tsx`
- [x] `apps/mobile/components/ui/Separator.tsx`
- [x] `apps/mobile/components/ui/SwipeTabs.tsx`
- [x] `apps/mobile/components/ui/Switch.tsx`
- [x] `apps/mobile/components/ui/Tabs.tsx`
- [x] `apps/mobile/components/ui/Text.tsx`
- [x] `apps/mobile/components/ui/swipeTabs.ts`
- [x] `apps/mobile/env.d.ts`
- [x] `apps/mobile/hooks/useCachedGroup.ts`
- [x] `apps/mobile/hooks/useFullBrightness.ts`
- [x] `apps/mobile/hooks/useGroupColorRevision.ts`
- [x] `apps/mobile/hooks/useGroupKeyAccess.ts`
- [x] `apps/mobile/hooks/useGroupLivePositions.ts`
- [x] `apps/mobile/hooks/useHeldHistoryKeyVersions.ts`
- [x] `apps/mobile/hooks/useHiddenMapGroupIds.ts`
- [x] `apps/mobile/hooks/useIdentityGate.ts`
- [x] `apps/mobile/hooks/useLiveTrackingPositions.ts`
- [x] `apps/mobile/hooks/useMapLivePositions.ts`
- [x] `apps/mobile/hooks/useMapVersion.ts`
- [x] `apps/mobile/hooks/useMembershipSnapshot.ts`
- [x] `apps/mobile/hooks/useRefetchWhileFocused.ts`
- [x] `apps/mobile/hooks/useSelfDeviceHeading.ts`
- [x] `apps/mobile/hooks/useSelfDeviceLocation.ts`
- [x] `apps/mobile/hooks/useSignedPmtilesUrl.ts`
- [x] `apps/mobile/hooks/useTimeSince.ts`
- [x] `apps/mobile/hooks/useTrackingUploadTime.ts`
- [x] `apps/mobile/index.ts`
- [x] `apps/mobile/lib/alert.ts`
- [x] `apps/mobile/lib/api.ts`
- [x] `apps/mobile/lib/apiCompatibility.ts`
- [x] `apps/mobile/lib/applySelfDeviceLocation.ts`
- [x] `apps/mobile/lib/auth-client.ts`
- [x] `apps/mobile/lib/auth.ts`
- [x] `apps/mobile/lib/batteryVisual.ts`
- [x] `apps/mobile/lib/buildLiveMapMarkers.ts`
- [x] `apps/mobile/lib/buildMemberLiveStatuses.ts`
- [x] `apps/mobile/lib/changePasswordSchema.ts`
- [x] `apps/mobile/lib/changeServer.ts`
- [x] `apps/mobile/lib/classifyMapPeople.ts`
- [x] `apps/mobile/lib/cn.ts`
- [x] `apps/mobile/lib/createDefaultMapTrackingDeps.ts`
- [x] `apps/mobile/lib/createHistoryKey.ts`
- [x] `apps/mobile/lib/createSecureId.ts`
- [x] `apps/mobile/lib/currentHistoryKey.ts`
- [x] `apps/mobile/lib/currentServer.ts`
- [x] `apps/mobile/lib/deviceActivation.ts`
- [x] `apps/mobile/lib/deviceIcons.ts`
- [x] `apps/mobile/lib/deviceKeys.ts`
- [x] `apps/mobile/lib/deviceLink.ts`
- [x] `apps/mobile/lib/deviceRemoved.ts`
- [x] `apps/mobile/lib/deviceRemovedError.ts`
- [x] `apps/mobile/lib/emailCodes.ts`
- [x] `apps/mobile/lib/endSession.ts`
- [x] `apps/mobile/lib/epochKeys.ts`
- [x] `apps/mobile/lib/errorReason.ts`
- [x] `apps/mobile/lib/fillRecoveryWords.ts`
- [x] `apps/mobile/lib/finishAuthentication.ts`
- [x] `apps/mobile/lib/fitLiveMapMarkers.ts`
- [x] `apps/mobile/lib/formatResumeTime.ts`
- [x] `apps/mobile/lib/googleAuth.ts`
- [x] `apps/mobile/lib/groupColor.ts`
- [x] `apps/mobile/lib/groupColorSync.ts`
- [x] `apps/mobile/lib/groupEncryption.ts`
- [x] `apps/mobile/lib/groupKeyAccess.ts`
- [x] `apps/mobile/lib/groupLimitAlert.ts`
- [x] `apps/mobile/lib/hiddenMapGroups.ts`
- [x] `apps/mobile/lib/historyKeys.ts`
- [x] `apps/mobile/lib/historyLossRisk.ts`
- [x] `apps/mobile/lib/identityGateDecision.ts`
- [x] `apps/mobile/lib/image-upload.ts`
- [x] `apps/mobile/lib/installCrypto.ts`
- [x] `apps/mobile/lib/isResetConfirmed.ts`
- [x] `apps/mobile/lib/keyboardRevealOffset.ts`
- [x] `apps/mobile/lib/launchRetry.ts`
- [x] `apps/mobile/lib/liveMapInitialFit.ts`
- [x] `apps/mobile/lib/liveMapPinGroups.ts`
- [x] `apps/mobile/lib/liveMapReducer.ts`
- [x] `apps/mobile/lib/liveMapTrackingCamera.ts`
- [x] `apps/mobile/lib/locationPermissions.ts`
- [x] `apps/mobile/lib/locationSharing.ts`
- [x] `apps/mobile/lib/locationSharingVisibility.ts`
- [x] `apps/mobile/lib/locationStaleAt.ts`
- [x] `apps/mobile/lib/mapEdgePoint.ts`
- [x] `apps/mobile/lib/mapGroupVisibility.ts`
- [x] `apps/mobile/lib/mapMarkerSelection.ts`
- [x] `apps/mobile/lib/mapPeopleTypes.ts`
- [x] `apps/mobile/lib/mapPmtilesCameraState.ts`
- [x] `apps/mobile/lib/mapPmtilesLoadFailure.ts`
- [x] `apps/mobile/lib/mapTracking.ts`
- [x] `apps/mobile/lib/mapTrackingDecrypt.ts`
- [x] `apps/mobile/lib/mapTrackingTypes.ts`
- [x] `apps/mobile/lib/mapViewportPoint.ts`
- [x] `apps/mobile/lib/mergeClosestPairs.ts`
- [x] `apps/mobile/lib/mergeMapEdgePoints.ts`
- [x] `apps/mobile/lib/needsFreshSignIn.ts`
- [x] `apps/mobile/lib/networkStatus.ts`
- [x] `apps/mobile/lib/nextMembershipSnapshot.ts`
- [x] `apps/mobile/lib/notifications.ts`
- [x] `apps/mobile/lib/openPlayStore.ts`
- [x] `apps/mobile/lib/passwordErrorMessage.ts`
- [x] `apps/mobile/lib/pendingJoinCode.ts`
- [x] `apps/mobile/lib/personalData.ts`
- [x] `apps/mobile/lib/personalNicknames.ts`
- [x] `apps/mobile/lib/pmtilesUrl.ts`
- [x] `apps/mobile/lib/protectHistory.ts`
- [x] `apps/mobile/lib/protomaps-style.ts`
- [x] `apps/mobile/lib/qrCodeShape.ts`
- [x] `apps/mobile/lib/recovery.ts`
- [x] `apps/mobile/lib/registeredDevice.ts`
- [x] `apps/mobile/lib/resealPersonalData.ts`
- [x] `apps/mobile/lib/resolveSelfDeviceLocationFallback.ts`
- [x] `apps/mobile/lib/resolveUsableDeviceHeading.ts`
- [x] `apps/mobile/lib/restoreReminders.ts`
- [x] `apps/mobile/lib/runForegroundPermissionedWatch.ts`
- [x] `apps/mobile/lib/runForegroundPermissionedWatchCore.ts`
- [x] `apps/mobile/lib/savedDeviceLink.ts`
- [x] `apps/mobile/lib/secureStoreOptions.ts`
- [x] `apps/mobile/lib/selfDeviceLocation.ts`
- [x] `apps/mobile/lib/serverUnreachable.ts`
- [x] `apps/mobile/lib/sessionLink.ts`
- [x] `apps/mobile/lib/signOut.ts`
- [x] `apps/mobile/lib/signUpSchema.ts`
- [x] `apps/mobile/lib/smoothDeviceHeading.ts`
- [x] `apps/mobile/lib/spaceMapEdgePoints.ts`
- [x] `apps/mobile/lib/storage.ts`
- [x] `apps/mobile/lib/tabBarLayout.ts`
- [x] `apps/mobile/lib/theme.ts`
- [x] `apps/mobile/lib/themePreferences.ts`
- [x] `apps/mobile/lib/thisDeviceNoun.ts`
- [x] `apps/mobile/lib/timeSince.ts`
- [x] `apps/mobile/lib/timeoutLink.ts`
- [x] `apps/mobile/lib/tracking.ts`
- [x] `apps/mobile/lib/trackingEvents.ts`
- [x] `apps/mobile/lib/trackingKeyCheck.ts`
- [x] `apps/mobile/lib/trackingModule.ts`
- [x] `apps/mobile/lib/trackingUploadTime.ts`
- [x] `apps/mobile/lib/useSingleFlight.ts`
- [x] `apps/mobile/lib/versions.ts`
- [x] `apps/mobile/nativewind-env.d.ts`
- [x] `apps/mobile/providers/DeletionCancellationNotice.tsx`
- [x] `apps/mobile/providers/LocationPermissionProvider.tsx`
- [x] `apps/mobile/providers/SessionDataCleanup.tsx`
- [x] `apps/mobile/providers/ThemeProvider.tsx`
- [x] `apps/mobile/providers/TrackingProvider.tsx`
- [x] `apps/mobile/scripts/check-map-assets-package.ts`

Total: 242 production/declaration/script TypeScript files. Test-only map harness and test support files were classified separately.
