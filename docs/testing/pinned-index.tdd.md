# Pinned index verification

The journeys were derived for this repository: an author explicitly reviews two npm version pins; a DSH user receives format-1 entries with exact install targets; failed or unchanged generation must not damage or rewrite the existing index.

## RED and GREEN checkpoints

- `5a2c849`: callable empty stubs and the test specification. `npm test` executed 35 tests and failed all 35. The primary assertion compared the empty generated plugin list against the two reviewed name/version pairs; modules loaded successfully, so this was not a missing-module or syntax-only RED.
- `46b6a4b`: minimal implementation. The same `npm test` command passed 35/35, with no skipped tests.
- `npm run test:coverage`: 35/35 passed; production source coverage was 100% lines, 95.45% branches, and 92.86% functions. The command enforces 80% aggregate thresholds for all three metrics.

| Guarantee | Test |
| --- | --- |
| Only two explicit versions, never dist-tags/latest or registry history | `test/index.test.mjs`: exact pins and unreviewed-release cases |
| Official format parser and exact `marketInstallTarget` agree | `test/index.test.mjs`: official parser/install-target case |
| Registry overrides and unknown/foreign/duplicate inputs fail closed | `test/index.test.mjs`: pins validation cases |
| Name, version, bundle declaration, deprecation, publication time and DSH engine metadata are checked | `test/index.test.mjs`: manifest rejection cases |
| HTTP failures, redirects, invalid JSON, absent/oversized bodies and stalled requests are bounded | `test/index.test.mjs`: transport cases |
| Failed generation preserves the previous file; no-op generation preserves bytes and mtime | `test/index.test.mjs`: atomic/idempotent update cases |
| Offline checks reject changed pins/registry; online checks reject stale registry metadata | `test/index.test.mjs`: freshness cases |
| CLI update/check flags follow the documented contract | `test/cli.test.mjs` |

`npm run update` and `npm run check -- --online` also read the official npm packuments for the reviewed Jot 0.2.13 and Bridge 0.4.6 releases. Generation only reads registry JSON; it does not download or execute either plugin package. The patch declaration check is metadata-level, not an archive-content or installed-runtime audit.

The public URL and actual Discover add/install workflow are separate acceptance gates. Unit tests or successful local generation do not claim that hosting or UI installation has happened. CI runs tests and online freshness checks on push, pull request and manual dispatch, with read-only repository permissions; it never updates pins or writes an index automatically.
