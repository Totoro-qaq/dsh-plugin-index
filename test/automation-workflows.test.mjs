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
  assert.match(source, /pull_request:\n\s+paths-ignore:/);
  for (const file of ['plugins.json', 'index.json', 'README.md', 'releases.json']) assert.ok(source.includes(`'${file}'`));
  assert.match(source, /pull_request:\n\s+description:/);
  assert.match(source, /head_sha:\n\s+description:/);
  assert.match(source, /ref: main/);
  assert.match(source, /node src\/automation-cli\.mjs verify/);
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /contents: write|pull-requests: write|pull_request_target/);
});

test('automatic merging requires a successful verification workflow and never checks out candidate code', async () => {
  const source = await workflow('merge-releases.yml');
  assert.match(source, /workflow_run:/);
  assert.match(source, /workflows: \['Verify reviewed index'\]/);
  assert.match(source, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(source, /github\.event\.workflow_run\.event == 'workflow_dispatch'/);
  assert.match(source, /ref: main/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /node src\/automation-cli\.mjs merge/);
  assert.doesNotMatch(source, /--admin|auto-approve|pull_request_target|secrets\.(?!GITHUB_TOKEN)/);
});
