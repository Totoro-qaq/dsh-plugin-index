# Release-index workflow and entrypoint evidence

The requested journey is: a successful stable Jot/Bridge npm release becomes an
index-update PR, whose exact candidate is checked before automatic merging.
No personal credential is copied into Actions and no test npm release is needed.

## RED and GREEN checkpoints

- `d91e947`: 9 transport/workflow tests failed for the missing scoped GitHub
  transport and missing synchronization/verification/merge wiring.
- `53fe043`: the same 9 tests passed after implementation. The static workflow
  reader ignores YAML comment lines rather than testing comment formatting.
- `704385c`: 4 CLI tests failed because the new guarded entrypoint was absent.
- `251e46a`: the same 4 tests passed after implementation.

Commands actually run:

```sh
node --test test/github.test.mjs test/automation-workflows.test.mjs
node --test test/automation-cli.test.mjs
```

The transport tests cover repository and write allowlists, JSON requests, 404
versus failures, redirect rejection, malformed/oversized responses and bounded
network/stream timeouts. CLI tests cover explicit modes, exact PR/SHA values,
bounded workflow-run events and credential-free result logging.

The workflow tests verify the 15-minute schedule, manual retry, read-only
candidate checks against trusted main, exact-candidate dispatch inputs and a
successful verification event before a privileged merge job can run.

Independent review identified that a blanket metadata `paths-ignore` would
leave fork README/pin-only PRs without the required check. A new regression
first failed (3/4 workflow tests passed), then the filter was removed and the
same target passed 4/4. Bot candidates still receive an explicit dispatch;
ordinary human/fork PR verification remains enabled for every path.

## Live-trigger regression

The first real coordinator run `38858463469` created bot PR #2. The explicit
candidate check `38858486372` passed, but no successor `workflow_run` merge
appeared. This confirms that a bot-dispatched workflow cannot rely on that
implicit continuation. No manual merge or workflow approval was used.

Two new regression tests failed (8/10 entrypoint/workflow tests passed), then
passed after adding an explicit, actions-only `request-merge` job. It dispatches
the trusted-main merge workflow and immediately returns. The merge workflow
waits at most 55 seconds for its parent verification to finish successfully,
then the existing independent exact-SHA merge checks still run. It never waits
in the notifying parent job, and does not use a PAT or bypass branch protection.
The implicit `workflow_run` trigger is removed rather than kept as a fallback,
so a human retry cannot accidentally request two competing merge continuations.
Its removal was also checked RED (4/5 workflow tests) then GREEN (5/5).

The next real attempt reached merge run `38859032500`, but GitHub returned HTTP
405 under the unchanged strict `verify` protection. Exact-head check runs were
successful while the PR rollup was empty and combined commit status was pending
with no statuses. The merge coordinator now reports the already independently
validated successful run to the same exact commit using a fixed `verify` status
and actual run URL, checks the response, and only then requests the existing
SHA-bound merge. Only that merge job gains `statuses: write`; candidate checking
stays read-only. The permission regression first failed (5/6 workflow tests),
then passed (6/6). Failed or stale checks do not produce a success status.
This reports real evidence to GitHub; it does not weaken branch protection or
replace tests with a synthetic pass. Final acceptance still requires the bot PR
to merge automatically under those original protection settings.

Independent runtime regeneration and mutation-guard tests live in
`release-eligibility.tdd.md` and `index-automation.tdd.md`. Unit/static checks do
not claim that GitHub Actions has already created or merged a PR; deployment
acceptance must separately record that real chain.
