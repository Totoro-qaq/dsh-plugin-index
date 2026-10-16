import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../src/automation-cli.mjs');
const sha = 'a'.repeat(40);
const github = async () => { throw new Error('Unexpected network call'); };

test('automation CLI only accepts its three explicit modes', async () => {
  const { runAutomation } = await load();
  for (const args of [[], ['foreign'], ['propose', '--force']]) {
    await assert.rejects(runAutomation(args, { env: {} }), /Usage/);
  }
});

test('automation CLI delegates proposal without printing credentials', async () => {
  const { runAutomation } = await load();
  const output = [];
  const result = await runAutomation(['propose'], { github, env: { GH_TOKEN: 'never-log-this' }, log: value => output.push(value),
    operations: { proposeUpdate: async options => { assert.equal(options.github, github); return { changed: false }; } } });
  assert.deepEqual(result, { changed: false });
  assert.ok(output.length > 0);
  assert.ok(!output.join('').includes('never-log-this'));
});

test('automation CLI requires an exact positive PR number and SHA', async () => {
  const { runAutomation } = await load();
  const cases = [{}, { PR_NUMBER: '1x', HEAD_SHA: sha }, { PR_NUMBER: '0', HEAD_SHA: sha },
    { PR_NUMBER: '1', HEAD_SHA: 'main' }, { PR_NUMBER: '9007199254740992', HEAD_SHA: sha }];
  for (const env of cases) await assert.rejects(runAutomation(['verify'], { github, env }), /PR|SHA/);
  const result = await runAutomation(['verify'], { github, env: { PR_NUMBER: '12', HEAD_SHA: sha }, log() {},
    operations: { verifyPullRequest: async options => {
      assert.equal(options.number, 12); assert.equal(options.headSha, sha); return { verified: true };
    } } });
  assert.deepEqual(result, { verified: true });
});

test('automation CLI reads only a bounded workflow-run event for merge mode', async () => {
  const { runAutomation } = await load();
  await assert.rejects(runAutomation(['merge'], { github, env: {} }), /event/i);
  for (const event of ['{', '{}', JSON.stringify({ workflow_run: { id: -1 } }), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    await assert.rejects(runAutomation(['merge'], { github, env: { GITHUB_EVENT_PATH: '/event.json' }, readFile: async () => event }));
  }
  const result = await runAutomation(['merge'], { github, env: { GITHUB_EVENT_PATH: '/event.json' }, log() {},
    readFile: async path => { assert.equal(path, '/event.json'); return JSON.stringify({ workflow_run: { id: 123 } }); },
    operations: { mergeVerifiedRun: async options => { assert.equal(options.runId, 123); return { merged: true }; } } });
  assert.deepEqual(result, { merged: true });
});
