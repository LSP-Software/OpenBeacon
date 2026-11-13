# Supporting packages, operations and tooling

Reviewed at caccd60e. Review-only. Root reviewer.

## Coverage

- [x] packages/email: all production TS/TSX, templates, config, transports, sender, types, exports; relevant config/transport/timeouts/render tests.
- [x] packages/map-tiles: manifest model, conditional store, grace/rollback, bucket checks and tests.
- [x] apps/map-tiles: every src production file (client, commands, env, index, pmtiles, r2, server, source, status, transfer, upload) and relevant tests.
- [x] Dockerfile, .dockerignore, docker-compose.yml; backend entrypoint; map-tiles and scheduled-jobs Dockerfiles.
- [x] README, backend/runner/map-tiles guides, .env.example, bunfig, workspace manifests, shared tsconfig, mobile build configuration.
- [x] Root scripts inspected by purpose: integration discovery/migrate/run/warnings, version checker, native queue runner/benchmark, emulator developer tool. CI workflow design deliberately out of scope.
- [x] Full audit and Knip output checked against source references. No package changes.

## Supporting findings

### O1 Bandwidth-capped map uploads can never finish a full part

- Location: apps/map-tiles/src/r2.ts:26; apps/map-tiles/src/upload.ts:19 and :365; apps/map-tiles/src/transfer.ts:24.
- Category: bug. Severity: medium. Launch: post-beta unless a capped first map import is required for beta self-hosting.
- Scenario: configure MAP_TILES_MAX_MBPS=1. Each full 64 MiB upload takes at least 537 seconds even before sharing bandwidth across four workers. The SDK absolute request timeout is 120 seconds with throwOnRequestTimeout enabled. Every attempt aborts; five retries and later service retries cannot finish the part. First publication never creates a usable map.
- Evidence: configuration and throttle source; installed @smithy/node-http-handler setRequestTimeout uses a wall-clock timer, destroys request and rejects independently of upload progress. Budget even with a single worker is insufficient below about 4.48 Mbps, and four concurrent streams require more.
- Fix: use progress/inactivity deadlines for upload parts; account for rate limit and concurrency when choosing maximum duration or part size. Test successful deliberately slow streams as well as actual stalls.

### O2 Unused files, exports and dependencies remain after the feature work

- Location: apps/backend/src/helpers/db.ts:1; apps/mobile/hooks/useGroupLivePositions.ts:1; apps/mobile/components/ui/Accordion.tsx:1; apps/mobile/package.json:29,53,54.
- Category: design. Severity: low. Launch: post-beta.
- Scenario: maintainers patch an unused live-position hook expecting the shipped map to change, or preserve unused UI/dependencies through upgrades. All three files have no consumers outside their own definitions; expo-glass-effect and expo-image have no source/config imports, and accordion is only imported by the unused Accordion component.
- Evidence: tooling/knip-configured.log plus repo-wide rg consumer checks. Knip also reports 40 exported values and 4 exported types unused outside their files, often tested locally or intentionally reusable UI parts. These are candidates to unexport, not 44 deletion orders.
- Fix: remove the three unused modules and their exclusively used dependencies after confirming native autolinking intent; remove unused exports rather than tested implementations. Keep babel-preset-expo (babel.config.js), expo-build-properties (app.json), expo-dev-client (development builds), and @prisma/client (generated Prisma runtime) despite Knip flags.

### O3 Scheduled-job integration tests rely on a transitive AWS dependency

- Location: apps/scheduled-jobs/src/jobs/imageUploadCleanup.integration.test.ts:6; apps/scheduled-jobs/package.json:17.
- Category: design. Severity: low. Launch: post-beta.
- Scenario: isolate workspace dependencies or remove API's AWS dependency and image-cleanup integration tests fail to resolve their own direct AWS import.
- Evidence: default and configured Knip agree; direct import absent from workspace manifest. Current hoisted install resolves it.
- Fix: declare @aws-sdk/client-s3 directly in runner devDependencies when doing dependency cleanup.

## Dependency audit interpretation

Full bun audit reports 13 advisories, 4 high / 7 moderate / 2 low. Normal audit deliberately ignores four highs, and that configured audit passed. Existing docs/security/dependency-audit-ignores.md records the exceptions. Image-size is Metro asset processing and vulnerable Zod 3 belongs to Expo CLI, while runtime project Zod 4 is fixed. The runtime decode-uri-component advisory can freeze the device opening a sufficiently large malformed deep link; it is an accepted documented dependency risk, not a newly discovered cross-account exploit. Revisit at the Expo/router upgrade, and retain the explicit risk acceptance for beta.

New node-forge advisories are absent from the existing exception inventory but resolve only through Expo CLI. No use of forge's Ed25519 verifier or TLS client by production app/backend was found; OpenBeacon's crypto uses its own reviewed encryption package. Treat this as maintenance inventory, not a beta privacy vulnerability. Primary advisory sources: https://github.com/advisories/GHSA-qr28-fpjm-wq7f, https://github.com/advisories/GHSA-6889-vf6x-f3g5, https://github.com/advisories/GHSA-w4xr-hqv8-ch44. No bulk audit-fix or incompatible ESM override is justified by the count alone.

Default Knip hits the existing Metro config-loader failure. A temporary explicit-workspace config with Metro/Expo discovery disabled completes; retain both outputs, and explicitly account for resulting build-plugin false positives. No conclusion depends on Knip alone.

## Limits and checked behaviors

No live R2/S3/SMTP account was available; map import/rollback and mail-delivery conclusions use source and unit tests, not external-provider executions. Manifest ETag writes, standby grace period, update/rollback single process serialization, SMTP TLS defaults, escaped React email content, Resend tracking checks, and local-only admin binding are present. Multiple map updater instances are not documented as supported. Generic CAS races requiring unsupported concurrent writers were not elevated to findings.

## Supporting production file checklist

- [x] `apps/map-tiles/shell-banner.sh`
- [x] `apps/map-tiles/src/client.ts`
- [x] `apps/map-tiles/src/commands.ts`
- [x] `apps/map-tiles/src/env.ts`
- [x] `apps/map-tiles/src/index.ts`
- [x] `apps/map-tiles/src/pmtiles.ts`
- [x] `apps/map-tiles/src/r2.ts`
- [x] `apps/map-tiles/src/server.ts`
- [x] `apps/map-tiles/src/source.ts`
- [x] `apps/map-tiles/src/status.ts`
- [x] `apps/map-tiles/src/transfer.ts`
- [x] `apps/map-tiles/src/upload.ts`
- [x] `packages/email/src/accountExistsEmail.tsx`
- [x] `packages/email/src/alertsTurnedOffEmail.tsx`
- [x] `packages/email/src/codeEmail.tsx`
- [x] `packages/email/src/config.ts`
- [x] `packages/email/src/googleSignInEmail.tsx`
- [x] `packages/email/src/index.ts`
- [x] `packages/email/src/layout.tsx`
- [x] `packages/email/src/securityAlertEmail.tsx`
- [x] `packages/email/src/sender.ts`
- [x] `packages/email/src/transport.ts`
- [x] `packages/email/src/types.ts`
- [x] `packages/map-tiles/src/index.ts`
- [x] `packages/map-tiles/src/manifest.ts`
- [x] `packages/map-tiles/src/manifestStore.ts`
- [x] `packages/map-tiles/src/r2.ts`
- [x] `scripts/benchmark-offline-queue-storage.sh`
- [x] `scripts/check-version-bump.ts`
- [x] `scripts/derby-emulators.py`
- [x] `scripts/integration-tests.ts`
- [x] `scripts/migrate-integration-database.ts`
- [x] `scripts/run-integration-tests.ts`
- [x] `scripts/test-offline-tracking-queue.sh`
- [x] `scripts/warn-skipped-integration-tests.ts`
- [x] `packages/database/prisma.config.ts`

Root also inspected SQL lock test utilities and integration cache fixtures to interpret the tooling; these and `nativeMapTestHarness.tsx` are test infrastructure, not runtime entry points.
