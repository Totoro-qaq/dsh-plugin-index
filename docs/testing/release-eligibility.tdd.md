# Published-release eligibility TDD evidence

Journeys were derived from the requested Jot/Bridge release-to-index automation.
Only an exact stable npm release, corroborated by its author-owned GitHub tag,
published Release and successful npm publisher, may advance an index pin.

## RED

`node --test test/releases.test.mjs` executed 49 tests: 0 passed, 49 failed.
The intended failure was `release eligibility implementation must exist`;
`src/releases.mjs` and its export did not exist yet. Test checkpoint: `8ef4ef0`.

## GREEN

The same command passed all 49 tests after implementing the metadata-only reader.
No plugins are installed or executed. The input pins remain unchanged on both
success and failure. Receipts contain no credentials and no current-time field.

| Guarantee | Tests | Result |
| --- | --- | --- |
| Exact stable npm latest, no downgrade, valid canonical SHA-512 integrity | stable success and invalid metadata cases | PASS |
| Published non-draft, non-prerelease GitHub Release and matching tag manifest | release, ref, manifest mismatch cases | PASS |
| Lightweight and annotated tags resolve to a bounded exact commit | annotated success and depth-limit case | PASS |
| Successful exact-tag publisher or precisely named manual retry on main | release and manual retry cases | PASS |
| Publisher run and npm job must both succeed in the allowlisted repository | foreign, skipped, failed and wrong-commit cases | PASS |
| Earliest eligible success gives deterministic evidence across retries | earliest-publisher case | PASS |
| Bounded pagination and failure on unavailable/incomplete API data | pagination, limits and unavailable API cases | PASS |

Coverage command:

```sh
node --experimental-test-coverage --test-coverage-include='src/releases.mjs' --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 --test test/releases.test.mjs
```

Result: 49 passed, 0 failed; lines 100%, branches 97.40%, functions 100%.

## API boundary and remaining integration gate

The caller supplies `github(path, options)` for authenticated, timeout-bounded
GitHub reads; this module does not handle credentials. It uses only the two
allowlisted author repositories and official npm metadata. GitHub reads are:

- `releases/tags/vVERSION`
- `git/ref/tags/vVERSION`, then at most five annotated `git/tags/SHA` reads
- `contents/package.json?ref=EXACT_COMMIT`
- `actions/workflows/publish.yml/runs`, at most five pages of 100
- `actions/runs/ID/attempts/ATTEMPT/jobs`, at most five pages of 100

The coordinator must still validate generated index bytes with the official DSH
parser, restrict PR data/file changes, and merge only the exact checked head SHA.
Unit-test evidence does not itself prove the scheduled GitHub Actions workflow.
