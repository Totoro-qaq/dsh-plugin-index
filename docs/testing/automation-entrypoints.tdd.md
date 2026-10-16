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

Independent runtime regeneration and mutation-guard tests live in
`release-eligibility.tdd.md` and `index-automation.tdd.md`. Unit/static checks do
not claim that GitHub Actions has already created or merged a PR; deployment
acceptance must separately record that real chain.
