# Second beta review plan and coverage

Baseline: `caccd60e406204c52523910974eeea5811e2e36b`. Scope is the entire repository at this commit, not a diff. The first review supplies decisions and regression targets, not evidence that current code is correct. No application code changes are authorized. Review artifacts only live here.

## Approach

1. Inventory all tracked files, domain docs, prior decisions and runtime entry points.
2. Run CI, full dependency audit, unused-file/export/dependency analysis. Distinguish tooling/environment limitations from product defects.
3. Complete independent per-section reviews below. Read production code and relevant tests; trace interactions and probe credible failure paths.
4. After section passes, perform a cross-cutting review of errors, validation, API shapes, UI states, cancellation/timeouts, locks, privacy boundaries and version skew.
5. Independently verify every high/critical candidate. Reject or downgrade candidates without a defensible concrete scenario. Group repeated style issues.
6. Assemble FINDINGS.md with must-fix-before-beta and post-beta buckets, explicit limitations, evidence, priorities and resolution prompt. No Linear writes.

The user's whole-project scope overrides the code-review skill's diff/spec workflow. No comparison ref or originating issue is needed.

## Coverage

- [x] Server: packages/api, auth, database, cache; apps/backend and scheduled-jobs. Owner: server_review; raw/server.md.
- [x] Mobile: routes, providers, hooks, UI kit, map/history, account/groups/device setup, sessions and networking. Owner: mobile_review; raw/mobile.md.
- [x] Encryption/native/contracts: packages/encryption, schemas, shared; Android module; mobile crypto; protocol and encrypted-format skew. Owner: crypto_native_review; raw/crypto-native.md.
- [x] Supporting packages: email, map-tiles; apps/map-tiles. Owner: root; raw/supporting.md.
- [x] Deployment, self-hosting, scripts and dependency graph. Owner: root; raw/supporting.md.
- [x] CI and audit evidence saved in tooling/.
- [x] Unused files/exports/dependencies checked and likely false positives investigated.
- [x] Cross-cutting pass after all section passes; raw/cross-cutting.md.
- [x] Independent high/critical verification; raw/verification.md.
- [x] Final findings and resolution prompt.

Each section report records exact files reviewed. These boxes mean completed coverage, not merely assigned work. Static inspection does not establish runtime UX or production behavior.

## Classification

Categories: security, bug, UX, design, duplication, style. Severity: critical, high, medium, low. Each finding must include file:line, concrete scenario, suggested fix and evidence. Critical means privacy/auth isolation failure or widespread destructive failure. High means realistic major data loss, exploitable privilege failure, core-flow indefinite stall or supported-version incompatibility. Medium means a bounded bug/workaround or meaningful maintainability risk. Low means polish/cleanup.

Launch priority is separate from severity: must-fix includes privacy/security boundary failures, core beta flow blockers, data loss/stalls and required contract decisions. Post-beta contains refactors and polish without a demonstrated beta blocker. Existing accepted product decisions must be identified rather than relitigated as defects.

## Run log

- Started whole-project review. Worktree initially clean.
- Initial CI reached lint but dependencies were absent (`biome: command not found`). Frozen install completed successfully; rerunning CI with installed dependencies. Initial full audit saved separately.

- Completed server, mobile and crypto/native section passes, with per-file checklists. Root completed supporting packages, deployment/scripts and dependency graph.
- Cross-cutting pass completed after section reports. One high finding independently confirmed by server reviewer; no critical finding.
- CI passed both cached and forced Turbo runs. Forced run has 14 successful tasks, zero Turbo cache hits; Android unit/Robolectric results 59 tests, zero failures/errors.
- Full audit and configured Knip/cycle checks retained. Default Knip Metro config-loader failure documented; build/plugin false positives filtered by source checks.
- Full integration run uses dedicated disposable PostgreSQL/Dragonfly services. First run failed on too-short placeholder S3 secrets; corrected run still in progress at this entry.
- Redis restart first failed due Docker changing ephemeral host port from 32771 to 32772. Fixed-port rerun in progress; no product finding inferred.
- FINDINGS.md drafted with 22 findings, seven recommended launch items and fifteen later fixes/refactors. Resolution starts with clarifications and explicit design choices.

- Final integration result: 337 pass, one skip, one five-second test timeout. Pending-device file rechecked: timeout at default, four pass at 30-second allowance. Random test-mode API delays explain cumulative deadline pressure; no production-deadlock finding. Full-suite failure is preserved.
- Independent fixed-port Redis outage check passed: one test, eight assertions, recovery after 35 seconds. Initial dynamic-port failure rejected as an environment artifact.
- Final formatting/lint checks pass for review artifacts. Only docs/reviews/beta-1-review-2 is changed; no tracked application changes.
