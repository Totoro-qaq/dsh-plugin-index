# Published index automation: TDD evidence

Journeys were derived from the requested release-to-index workflow: published
Jot and Bridge releases should create a metadata-only PR, and only independently
regenerated, successful exact-head verification may merge that PR.

## RED and GREEN checkpoints

- RED: `node --test test/automation.test.mjs` executed 30 new tests and failed all
  30 with `index update orchestration must exist`, before the implementation
  existed. Checkpoint: `3b79b66`.
- GREEN: the same target passed all tests after implementation. The fixture uses
  public npm metadata and GitHub API responses; no package is installed or run.

| Guarantee | Evidence |
| --- | --- |
| Proposals can modify only four data files, preserving README bytes outside markers | Deterministic generated-content test and full Git tree comparison |
| A matching current index is read-only; retries reuse one bot PR | No-op and retry tests inspect every mock write |
| Existing human commits and orphan branches are never overwritten | Bot-author and branch ownership negative tests |
| Verification cannot execute candidate code | Candidate files are read at exact SHA and compared to trusted-main regeneration |
| Foreign/draft/closed PRs, altered files, renamed/deleted paths, extra tree content, executable metadata and changed heads are rejected | Parameterized verification negative tests |
| Only a successful dispatch workflow and an actually successful exact-head verify job can merge | Parameterized run/job negative tests |
| A changed base or head blocks merge; a rejected merge cannot delete its branch | Race and failed-merge tests |

Coverage command:

```sh
node --experimental-test-coverage --test-coverage-include=src/automation.mjs --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 --test test/automation.test.mjs
```

The first GREEN coverage run reported 99.52% lines, 99.03% branches and 100%
functions. API pagination fails closed at its bounded limit. Live GitHub workflow
execution, branch protection and source release notification configuration are
separate deployment checks, not claimed by these mocked integration tests.
