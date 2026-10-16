import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const original = JSON.parse(await fs.readFile(new URL('../plugins.json', import.meta.url), 'utf8'));
const repositories = { 'dsh-jot': 'Totoro-qaq/dsh-jot', 'dsh-plugin-bridge': 'Totoro-qaq/dsh-plugin-bridge' };
const integrity = 'sha512-' + Buffer.alloc(64, 7).toString('base64');
const clone = value => structuredClone(value);
const load = async () => {
  const module = await import('../src/releases.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.discoverPublishedReleases, 'function', 'release eligibility implementation must exist');
  return module.discoverPublishedReleases;
};

function fixture(mutate = () => {}) {
  const states = Object.fromEntries(original.plugins.map((pin, index) => {
    const repository = repositories[pin.name];
    const version = index === 0 ? '0.3.0' : '0.5.0';
    const commit = String(index + 1).repeat(40);
    const manifest = { name: pin.name, version, engines: { dsh: '^0.2.1-alpha.1' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, dist: { integrity } };
    const run = {
      id: index + 100, run_attempt: 1, event: 'release', head_branch: 'v' + version,
      head_sha: commit, path: '.github/workflows/publish.yml', status: 'completed', conclusion: 'success',
      repository: { full_name: repository }, head_repository: { full_name: repository },
      created_at: '2026-10-16T03:00:00Z', html_url: `https://github.com/${repository}/actions/runs/${index + 100}`,
    };
    return [pin.name, {
      name: pin.name, repository, commit, version, manifest: clone(manifest),
      packument: { name: pin.name, 'dist-tags': { latest: version }, versions: { [version]: manifest } },
      release: { tag_name: 'v' + version, draft: false, prerelease: false, published_at: '2026-10-16T02:59:00Z' },
      ref: { ref: 'refs/tags/v' + version, object: { type: 'commit', sha: commit } },
      tags: {}, runs: [[run]], jobs: { [run.id]: [[{ name: 'npm', status: 'completed', conclusion: 'success', head_sha: commit }]] },
    }];
  }));
  mutate(states['dsh-jot'], states);
  const calls = [];
  const github = async (request, options = {}) => {
    calls.push(request);
    assert.equal(options.method ?? 'GET', 'GET');
    const url = new URL(request, 'https://api.github.com/');
    const state = Object.values(states).find(value => url.pathname.startsWith('/repos/' + value.repository + '/'));
    assert.ok(state, 'only allowlisted source repositories may be queried');
    const route = url.pathname.slice(('/repos/' + state.repository).length);
    const page = Number(url.searchParams.get('page') ?? '1') - 1;
    if (route.startsWith('/releases/tags/')) return clone(state.release);
    if (route.startsWith('/git/ref/tags/')) return clone(state.ref);
    if (route.startsWith('/git/tags/')) return clone(state.tags[route.split('/').at(-1)]);
    if (route === '/contents/package.json') {
      assert.equal(url.searchParams.get('ref'), state.commit, 'manifest must be read at the resolved commit');
      return { encoding: 'base64', content: Buffer.from(JSON.stringify(state.manifest)).toString('base64') };
    }
    if (route === '/actions/workflows/publish.yml/runs') return { workflow_runs: clone(state.runs[page] ?? []) };
    const jobs = route.match(/^\/actions\/runs\/(\d+)\/attempts\/\d+\/jobs$/);
    if (jobs) return { jobs: clone(state.jobs[jobs[1]]?.[page] ?? []) };
    throw new Error('unexpected GitHub endpoint: ' + request);
  };
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    const state = Object.values(states).find(value => url === 'https://registry.npmjs.org/' + value.name);
    assert.ok(state, 'only official npm package metadata may be fetched');
    return new Response(JSON.stringify(state.packument));
  };
  return { config: clone(original), github, fetchImpl, calls, states };
}

test('discovers only exact published stable versions without mutating input, with deterministic receipts', async () => {
  const discover = await load();
  const options = fixture();
  const before = clone(options.config);
  const result = await discover(options);
  assert.deepEqual(options.config, before);
  assert.deepEqual(result.config.plugins.map(pin => pin.version), ['0.3.0', '0.5.0']);
  assert.deepEqual(result.receipts, { schema: 1, packages: Object.fromEntries(Object.values(options.states).map(state => [state.name, {
    version: state.version, repository: state.repository, tag: 'v' + state.version, commit: state.commit,
    publishRunId: state.runs[0][0].id, publishRunUrl: state.runs[0][0].html_url, integrity,
  }])) });
  assert.deepEqual(await discover(fixture()), result);
});

test('accepts equal pins and resolves annotated tags without installing or executing packages', async () => {
  const options = fixture(state => {
    const tag = 'a'.repeat(40);
    state.ref.object = { type: 'tag', sha: tag };
    state.tags[tag] = { object: { type: 'commit', sha: state.commit } };
  });
  options.config.plugins.forEach(pin => { pin.version = options.states[pin.name].version; });
  const result = await (await load())(options);
  assert.deepEqual(result.config, options.config);
  assert.ok(options.calls.some(call => call.includes('/git/tags/')));
});

test('supports exact-named manual publisher retries from main', async () => {
  const options = fixture(state => {
    Object.assign(state.runs[0][0], { event: 'workflow_dispatch', head_branch: 'main', head_sha: 'f'.repeat(40), display_title: `Publish ${state.name} v${state.version}` });
    state.jobs[100][0][0].head_sha = 'f'.repeat(40);
  });
  assert.equal((await (await load())(options)).receipts.packages['dsh-jot'].publishRunId, 100);
});

test('chooses the earliest eligible successful publisher rather than a later retry', async () => {
  const options = fixture(state => {
    const first = state.runs[0][0];
    state.runs[0] = [{ ...first, id: 300, created_at: '2026-10-17T00:00:00Z', html_url: `https://github.com/${state.repository}/actions/runs/300` }, first];
    state.jobs[300] = clone(state.jobs[100]);
  });
  assert.equal((await (await load())(options)).receipts.packages['dsh-jot'].publishRunId, 100);
});

test('paginates publisher runs and jobs, ignoring unrelated or unsuccessful jobs', async () => {
  const options = fixture(state => {
    state.runs.unshift(Array.from({ length: 100 }, (_, index) => ({ ...state.runs[0][0], id: 1000 + index, conclusion: 'failure' })));
    state.jobs[100].unshift(Array.from({ length: 100 }, () => ({ name: 'not-npm', conclusion: 'success', status: 'completed' })));
  });
  assert.equal((await (await load())(options)).receipts.packages['dsh-jot'].publishRunId, 100);
  assert.ok(options.calls.some(call => call.includes('page=2')));
});

for (const [label, mutate] of [
  ['prerelease latest', state => { state.packument['dist-tags'].latest = '0.3.0-alpha.1'; }],
  ['noncanonical latest', state => { state.packument['dist-tags'].latest = '00.3.0'; }],
  ['missing latest', state => { delete state.packument['dist-tags']; }],
  ['downgrade latest', state => { state.packument['dist-tags'].latest = '0.1.0'; }],
  ['wrong registry package', state => { state.packument.name = 'foreign'; }],
  ['missing version manifest', state => { delete state.packument.versions[state.version]; }],
  ['deprecated version', state => { state.packument.versions[state.version].deprecated = 'retired'; }],
  ['wrong manifest package', state => { state.packument.versions[state.version].name = 'foreign'; }],
  ['wrong manifest version', state => { state.packument.versions[state.version].version = '9.0.0'; }],
  ['missing integrity', state => { delete state.packument.versions[state.version].dist; }],
  ['wrong integrity algorithm', state => { state.packument.versions[state.version].dist.integrity = 'sha1-' + Buffer.alloc(20).toString('base64'); }],
  ['truncated integrity', state => { state.packument.versions[state.version].dist.integrity = 'sha512-YQ=='; }],
  ['malformed integrity', state => { state.packument.versions[state.version].dist.integrity = integrity + ' garbage'; }],
  ['draft GitHub release', state => { state.release.draft = true; }],
  ['prerelease GitHub release', state => { state.release.prerelease = true; }],
  ['wrong release tag', state => { state.release.tag_name = 'v0.1.0'; }],
  ['unpublished release', state => { state.release.published_at = null; }],
  ['wrong ref', state => { state.ref.ref = 'refs/heads/main'; }],
  ['wrong ref object', state => { state.ref.object.type = 'tree'; }],
  ['invalid commit', state => { state.ref.object.sha = 'not-a-sha'; }],
  ['tag manifest package mismatch', state => { state.manifest.name = 'foreign'; }],
  ['tag manifest version mismatch', state => { state.manifest.version = '0.1.0'; }],
  ['tag engines mismatch', state => { state.manifest.engines.dsh = '^0.3.0'; }],
  ['tag bundle mismatch', state => { state.manifest.dsh.bundle.patch = './different.yml'; }],
  ['missing npm engines', state => { delete state.packument.versions[state.version].engines; }],
  ['missing npm bundle', state => { delete state.packument.versions[state.version].dsh; }],
  ['wrong run repository', state => { state.runs[0][0].repository.full_name = 'someone/fork'; }],
  ['wrong run head repository', state => { state.runs[0][0].head_repository.full_name = 'someone/fork'; }],
  ['wrong workflow', state => { state.runs[0][0].path = '.github/workflows/other.yml'; }],
  ['failed publish run', state => { state.runs[0][0].conclusion = 'failure'; }],
  ['skipped publish run', state => { state.runs[0][0].conclusion = 'skipped'; }],
  ['incomplete publish run', state => { state.runs[0][0].status = 'in_progress'; }],
  ['wrong run tag', state => { state.runs[0][0].head_branch = 'v0.1.0'; }],
  ['wrong run commit', state => { state.runs[0][0].head_sha = 'f'.repeat(40); }],
  ['unrelated run event', state => { state.runs[0][0].event = 'push'; }],
  ['unbound manual retry', state => { Object.assign(state.runs[0][0], { event: 'workflow_dispatch', head_branch: 'main', display_title: 'Publish npm' }); }],
  ['manual retry nonmain branch', state => { Object.assign(state.runs[0][0], { event: 'workflow_dispatch', head_branch: 'feature', display_title: `Publish ${state.name} v${state.version}` }); }],
  ['foreign run URL', state => { state.runs[0][0].html_url = 'https://evil.invalid/run'; }],
  ['failed npm job', state => { state.jobs[100][0][0].conclusion = 'failure'; }],
  ['skipped npm job', state => { state.jobs[100][0][0].conclusion = 'skipped'; }],
  ['missing npm job', state => { state.jobs[100][0] = []; }],
  ['npm job wrong commit', state => { state.jobs[100][0][0].head_sha = 'f'.repeat(40); }],
]) test('fails closed for ' + label, async () => {
  await assert.rejects((await load())(fixture(mutate)));
});

test('fails closed for incomplete GitHub responses or unavailable API, without changing pins', async () => {
  const discover = await load();
  const options = fixture();
  const before = clone(options.config);
  await assert.rejects(discover({ ...options, github: async () => { throw new Error('GitHub unavailable'); } }), /unavailable/);
  await assert.rejects(discover({ ...options, github: async () => ({}) }));
  assert.deepEqual(options.config, before);
});

test('bounds tag traversal and workflow pagination', async () => {
  const discover = await load();
  await assert.rejects(discover(fixture(state => {
    const tag = 'a'.repeat(40);
    state.ref.object = { type: 'tag', sha: tag };
    state.tags[tag] = { object: { type: 'tag', sha: tag } };
  })), /tag|limit/i);
  await assert.rejects(discover(fixture(state => {
    const rows = Array.from({ length: 100 }, () => ({ ...state.runs[0][0], conclusion: 'failure' }));
    state.runs = Array.from({ length: 5 }, () => rows);
  })), /limit|pages/i);
});
