import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workflow = async name => (await fs.readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')).replace(/^\s*#.*$/gm, '');

test('release synchronization is index-owned, bounded, scheduled and manually retryable', async () => {
  const source = await workflow('sync-releases.yml');
  assert.match(source, /cron: '7,22,37,52 \* \* \* \*'/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /github\.repository == 'Totoro-qaq\/dsh-plugin-index'/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /timeout-minutes: 5/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /node src\/automation-cli\.mjs propose/);
  assert.doesNotMatch(source, /secrets\.(?!GITHUB_TOKEN)/);
});

test('candidate checking is explicitly dispatched at the candidate SHA but executes trusted main code', async () => {
  const source = await workflow('verify.yml');
  assert.match(source, /\n  pull_request:/);
  assert.match(source, /pull_request:\n\s+description:/);
  assert.match(source, /head_sha:\n\s+description:/);
  assert.match(source, /ref: main/);
  assert.match(source, /node src\/automation-cli\.mjs verify/);
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /contents: write|pull-requests: write|pull_request_target/);
});

test('human and fork metadata-only PRs still receive the required verification check', async () => {
  const source = await workflow('verify.yml');
  assert.doesNotMatch(source, /paths-ignore:/);
});

test('successful bot candidate checks explicitly dispatch the main merge workflow', async () => {
  const source = await workflow('verify.yml');
  assert.match(source, /request-merge:\n\s+needs: verify/);
  assert.match(source, /actions: write/);
  assert.match(source, /startsWith\(github\.ref, 'refs\/heads\/index\/releases\/'\)/);
  assert.match(source, /gh workflow run merge-releases\.yml/);
  assert.match(source, /--ref main/);
  assert.match(source, /VERIFY_RUN_ID: \$\{\{ github\.run_id \}\}/);
  const merge = await workflow('merge-releases.yml');
  assert.match(merge, /workflow_dispatch:\n\s+inputs:\n\s+run_id:/);
  assert.match(merge, /github\.ref == 'refs\/heads\/main'/);
  assert.match(merge, /timeout 55s gh run watch/);
  assert.match(merge, /--exit-status/);
});

test('automatic merging requires a successful verification workflow and never checks out candidate code', async () => {
  const source = await workflow('merge-releases.yml');
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /workflow_run:/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /timeout 55s gh run watch/);
  assert.match(source, /--exit-status/);
  assert.match(source, /ref: main/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /node src\/automation-cli\.mjs merge/);
  assert.doesNotMatch(source, /--admin|auto-approve|pull_request_target|secrets\.(?!GITHUB_TOKEN)/);
});
