# Task 3 Report

## Implementation

- Added encrypted provider configuration storage in `server/secret-store.js`.
- Added public configuration projection with masked key only.
- Added `GET` and `PUT /api/settings/ai`, both protected by the existing local session cookie.
- Added backend-only `analyzeInquiry()` proxy with provider URL validation, upstream error redaction, and required JSON-field validation.
- Added SSRF protections for default provider URLs and private, loopback, link-local, multicast, unspecified, non-HTTPS, and IPv6 targets.
- Kept provider credentials out of business backup exports.

## Security Notes

- The cross-platform secure storage path requires `YH_COMMUNITY_SECRET_KEY` and stores AES-256-GCM ciphertext, IV, and authentication tag in SQLite. Saving fails when the key is unavailable; plaintext fallback is not used.
- API responses and upstream errors do not return the API key or Authorization header.
- Model calls are made only by the server. Tests use injected local fetch mocks and do not contact real providers.

## Verification

- `npm run check`: passed.
- `npm test`: passed, 27 tests.
- Existing Task 1/2 tests remain passing.

## Remaining Attention

- Windows DPAPI is not wired in this minimal cross-platform implementation; production Windows deployment should add a native DPAPI-backed key provider while retaining the current fail-closed behavior.

## Fix Round 1

- Custom HTTPS hosts are resolved with all IPv4/IPv6 results checked for loopback, link-local, private, multicast, and unspecified ranges. Requests use `redirect: manual`.
- Provider URLs reject credentials, query strings, and fragments, and are normalized before persistence and public return.
- Analysis output now requires exact top-level keys and strict scalar/array/object shapes for all eight fields.
- Added fail-closed missing-key, atomic failed-save, AES-GCM tamper, private DNS, URL credential/query, normalization, and redirect tests.

Verification: `npm run check` and `npm test` passed; 30 tests passed.

## Fix Round 2

- Closed the DNS check/use resolution drift by removing the unsupported custom-host path entirely.
- Only normalized HTTPS paths on the explicit `api.deepseek.com` and `api.openai.com` origins are accepted; custom HTTPS settings fail closed with an actionable error.
- Kept manual redirect handling, so provider responses cannot silently redirect to another host.
- Added regression coverage for custom-host rejection and retained the I-2/I-3 URL and exact-schema tests.

Verification: `npm run check` and `npm test` passed; 30 tests passed.
