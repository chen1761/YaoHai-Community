# Task 6 Report

- Added Windows launcher scripts with Node 24 validation, local port selection, runtime directories, health polling, browser launch, and actionable failure pauses.
- Added community documentation, Apache-2.0 license and NOTICE, branding/security guidance, and explicit community/commercial separation.
- Added offline-safe GitHub Actions CI and `tools/release-check.mjs` with check/test, audit handling for zero dependencies, release artifact and secret scans, and clean-directory health smoke test.
- Added Task 6 contract tests and package scripts `start` and `release:check`.

Verification: `npm run check && npm test && npm run release:check` passed; 41 tests passed. `npm audit --omit=dev --offline` reports no lockfile, which is accepted because this package has no runtime dependencies.

## Fix Round 1

- Refactored release validation into readable check, tracked-file scan, artifact-copy, and smoke-test phases.
- Scans every Git-tracked text file with binary-safe handling, narrow policy/test-fixture exemptions, and expanded path denylist coverage. `.env.example`, `LICENSE`, and `data/.gitkeep` are explicit release-template exceptions.
- CI now runs directly on Node/npm without install or misleading offline flags.
- Hardened the PowerShell launcher with numeric Node major parsing, three startup attempts, exact health URL output, child-process cleanup/waiting, and exit-code reporting.
- Smoke testing copies the complete public release surface and boots the artifact without executing user batch files or copying runtime data.

Verification: `npm run check && npm test && npm run release:check` passed; 43 tests passed. Audit reports no lockfile and is accepted because the package has no runtime dependencies.

## Final Review Closure

- Implemented Windows DPAPI-first AI secret storage with an explicit `YH_COMMUNITY_SECRET_KEY` fallback and `configuration_required` responses for missing configuration.
- Enforced analyze-before-confirm, confirmation idempotency, persisted inquiry `customerId`, complete safe business backup roundtrips, malicious restore rejection, and AI-config preservation.
- Completed product/customer CRUD, CSV import/export, CSV error details, 404 reads, audit coverage, and single-path browser event handling.
- Added lockfile-backed full `npm audit`, release-artifact scans including untracked files, Git history secret scans, and the default-enforced `YH_SECRET_REVOCATION_EVIDENCE` gate. The gate validates supplied provider evidence and never fabricates revocation.
- Added end-to-end tests for unconfigured AI, no-analysis/duplicate confirmation, backup roundtrip, malicious restore, CRUD/export, untracked release artifacts, history scanning, audit events, and the mandatory old-key revocation evidence gate.

## SC-I9 Fix

- `npm run release:check` now requires `YH_SECRET_REVOCATION_EVIDENCE` by default and in CI. Before publishing, revoke every previously exposed old key in the provider console and provide real evidence JSON; do not fabricate evidence.
- `RELEASE_DEV_BYPASS=1` is accepted only for non-CI local development and is rejected in production and CI.
- Added tests for default missing-evidence failure, valid evidence success, and local-only bypass behavior.
