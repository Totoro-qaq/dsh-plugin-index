import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { generateIndex } from '../src/index.mjs';

const config = JSON.parse(await fs.readFile(new URL('../plugins.json', import.meta.url), 'utf8'));
const repository = 'Totoro-qaq/dsh-plugin-index';
const base = `repos/${repository}`;
const sha = letter => letter.repeat(40);
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const clone = value => structuredClone(value);
const load = async () => {
  const module = await import('../src/automation.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.proposeUpdate, 'function', 'index update orchestration must exist');
  return module;
};

async function fixture() {
  const sources = Object.fromEntries(config.plugins.map((pin, i) => {
    const sourceRepository = `Totoro-qaq/${pin.name}`;
    const version = pin.version;
    const manifest = { name: pin.name, version, engines: { dsh: '^0.2.1-alpha.1' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, dist: { integrity: 'sha512-' + Buffer.alloc(64, i).toString('base64') } };
    return [pin.name, { repository: sourceRepository, commit: sha(String(i + 1)), manifest, packument: { name: pin.name, 'dist-tags': { latest: version }, time: { [version]: '2026-10-16T03:24:55.111Z' }, versions: { [version]: manifest } }, run: { id: 100 + i, run_attempt: 1, event: 'release', path: '.github/workflows/publish.yml', name: 'Publish npm', head_branch: 'v' + version, head_sha: sha(String(i + 1)), repository: { full_name: sourceRepository }, head_repository: { full_name: sourceRepository }, status: 'completed', conclusion: 'success', created_at: '2026-10-16T04:00:00Z', html_url: `https://github.com/${sourceRepository}/actions/runs/${100 + i}` } }];
  }));
  const fetchImpl = async url => {
    const source = sources[url.split('/').at(-1)];
    assert.ok(source, 'only allowlisted npm metadata is read');
    return new Response(JSON.stringify(source.packument));
  };
  const files = { 'plugins.json': serialize(config), 'index.json': serialize(await generateIndex(config, { fetchImpl })), 'README.md': 'prefix\n<!-- current-releases:start -->\nold table\n<!-- current-releases:end -->\nsuffix\n', 'releases.json': serialize({ schema: 1, packages: {} }) };
  const state = { main: sha('a'), tree: sha('b'), head: sha('c'), branch: null, pr: null, files, candidate: null, calls: [], compareFiles: null, commitAuthor: 'github-actions[bot]', extraTree: [], jobs: [{ name: 'verify', status: 'completed', conclusion: 'success', head_sha: sha('c') }], run: null, changedHead: false, changedMain: false };
  const tree = (candidate = false) => ({ truncated: false, tree: [...Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644', sha: candidate && state.candidate?.[path] !== files[path] ? sha('d') : sha('e') })), { path: 'src/index.mjs', mode: '100644', type: 'blob', sha: sha('f') }, ...(candidate ? state.extraTree : [])] });
  const github = async (request, options = {}) => {
    state.calls.push({ request, ...options });
    const method = options.method ?? 'GET';
    const url = new URL(request, 'https://api.github.com/');
    if (!request.startsWith(base + '/')) {
      assert.equal(method, 'GET', 'source repositories are read-only');
      const source = Object.values(sources).find(value => request.startsWith(`repos/${value.repository}/`));
      assert.ok(source, 'only author-owned source repositories may be read');
      if (url.pathname.includes('/releases/tags/')) return { tag_name: 'v' + source.manifest.version, draft: false, prerelease: false, published_at: '2026-10-16T03:00:00Z' };
      if (url.pathname.includes('/git/ref/tags/')) return { ref: 'refs/tags/v' + source.manifest.version, object: { type: 'commit', sha: source.commit } };
      if (url.pathname.includes('/contents/package.json')) return { encoding: 'base64', content: Buffer.from(serialize(source.manifest)).toString('base64') };
      if (url.pathname.includes('/actions/workflows/publish.yml/runs')) return { workflow_runs: [clone(source.run)] };
      if (url.pathname.includes('/jobs')) return { jobs: [{ name: 'npm', status: 'completed', conclusion: 'success', head_sha: source.commit }] };
      throw new Error('unexpected source route ' + request);
    }
    const route = url.pathname.slice(('/' + base).length);
    if (method === 'GET') {
      if (route === '/git/ref/heads/main') return { ref: 'refs/heads/main', object: { type: 'commit', sha: state.changedMain ? sha('9') : state.main } };
      if (route.startsWith('/git/ref/heads/')) return state.branch ? { ref: 'refs/heads/' + state.branch, object: { type: 'commit', sha: state.head } } : null;
      if (route.startsWith('/git/commits/')) return { sha: route.split('/').at(-1), tree: { sha: state.tree } };
      if (route.startsWith('/contents/')) {
        const source = url.searchParams.get('ref') === state.main ? state.files : state.candidate;
        const path = route.slice('/contents/'.length);
        assert.ok(source?.[path] !== undefined, 'candidate file must exist');
        return { type: 'file', encoding: 'base64', content: Buffer.from(source[path]).toString('base64'), size: Buffer.byteLength(source[path]) };
      }
      if (route === '/pulls') return state.pr ? [clone(state.pr)] : [];
      if (route === '/pulls/7') return { ...clone(state.pr), head: { ...state.pr.head, sha: state.changedHead ? sha('8') : state.head } };
      if (route === '/pulls/7/files') return state.compareFiles ?? Object.keys(files).filter(path => state.candidate?.[path] !== files[path]).map(filename => ({ filename, status: 'modified' }));
      if (route.startsWith('/commits/')) return { author: { login: state.commitAuthor } };
      if (route.startsWith('/git/trees/')) return tree(url.searchParams.get('recursive') === '1' && route.endsWith(state.head));
      if (route === '/actions/runs/900') return clone(state.run);
      if (route === '/actions/runs/900/jobs') return { jobs: clone(state.jobs) };
    }
    assert.ok(['POST', 'PATCH', 'PUT', 'DELETE'].includes(method));
    if (route === '/git/trees') { state.candidate = Object.fromEntries(options.body.tree.map(file => [file.path, file.content])); return { sha: state.tree }; }
    if (route === '/git/commits') return { sha: state.head };
    if (route === '/git/refs' && method === 'POST') { state.branch = options.body.ref.slice('refs/heads/'.length); return { object: { sha: state.head } }; }
    if (route.startsWith('/git/refs/heads/') && method === 'PATCH') return { object: { sha: state.head } };
    if (route === '/pulls' && method === 'POST') {
      state.pr = { number: 7, html_url: `https://github.com/${repository}/pull/7`, state: 'open', draft: false, user: { login: 'github-actions[bot]' }, base: { ref: 'main', sha: state.main, repo: { full_name: repository } }, head: { ref: state.branch, sha: state.head, repo: { full_name: repository } } };
      return clone(state.pr);
    }
    if (route === '/actions/workflows/verify.yml/dispatches') return null;
    if (route === '/pulls/7/merge') return { merged: true, sha: sha('7') };
    if (route.startsWith('/git/refs/heads/') && method === 'DELETE') return null;
    throw new Error('unexpected index route ' + method + ' ' + request);
  };
  return { state, sources, github, fetchImpl };
}
const mutations = state => state.calls.filter(call => call.method && call.method !== 'GET');
async function proposed() {
  const options = await fixture();
  const result = await (await load()).proposeUpdate(options);
  return { ...options, result };
}

test('creates only four deterministic metadata files and dispatches exact-head verification', async () => {
  const { state, result } = await proposed();
  assert.deepEqual(Object.keys(state.candidate).sort(), ['README.md', 'index.json', 'plugins.json', 'releases.json']);
  assert.match(state.candidate['README.md'], /^prefix\n<!-- current-releases:start -->\n/);
  assert.match(state.candidate['README.md'], /<!-- current-releases:end -->\nsuffix\n$/);
  assert.equal(result.branch, 'index/releases/jot-0.2.13_bridge-0.4.6');
  assert.equal(result.number, 7);
  assert.equal(result.headSha, state.head);
  assert.deepEqual(mutations(state).at(-1).body, { ref: result.branch, inputs: { pull_request: '7', head_sha: state.head } });
});

test('is a read-only no-op once all metadata and receipts match main', async () => {
  const options = await proposed();
  options.state.files = clone(options.state.candidate);
  options.state.calls = [];
  assert.deepEqual(await (await load()).proposeUpdate(options), { changed: false });
  assert.deepEqual(mutations(options.state), []);
});

test('reuses a matching bot PR without duplicate commits or PRs', async () => {
  const options = await proposed();
  options.state.calls = [];
  const result = await (await load()).proposeUpdate(options);
  assert.equal(result.number, 7);
  assert.deepEqual(mutations(options.state).map(call => call.request), [base + '/actions/workflows/verify.yml/dispatches']);
});

test('updates an owned bot branch with both existing head and current main parents', async () => {
  const options = await proposed();
  options.state.candidate['README.md'] = options.state.candidate['README.md'].replace('prefix', 'changed');
  options.state.calls = [];
  await (await load()).proposeUpdate(options);
  const commit = mutations(options.state).find(call => call.request === base + '/git/commits');
  assert.deepEqual(commit.body.parents, [options.state.head, options.state.main]);
});

test('verifies candidate bytes against trusted current main and successful publishers', async () => {
  const options = await proposed();
  options.state.calls = [];
  const evidence = await (await load()).verifyPullRequest({ ...options, number: 7, headSha: options.state.head });
  assert.equal(evidence.baseSha, options.state.main);
  assert.equal(evidence.headSha, options.state.head);
  assert.deepEqual(mutations(options.state), []);
});

for (const [label, mutate] of [
  ['human PR', state => { state.pr.user.login = 'human'; }],
  ['foreign head repository', state => { state.pr.head.repo.full_name = 'someone/fork'; }],
  ['wrong base', state => { state.pr.base.ref = 'other'; }],
  ['draft', state => { state.pr.draft = true; }],
  ['closed', state => { state.pr.state = 'closed'; }],
  ['unexpected branch', state => { state.pr.head.ref = 'index/releases/other'; }],
  ['changed head', state => { state.changedHead = true; }],
  ['code file', state => { state.compareFiles = [{ filename: 'src/index.mjs', status: 'modified' }]; }],
  ['removed file', state => { state.compareFiles = [{ filename: 'index.json', status: 'removed' }]; }],
  ['renamed file', state => { state.compareFiles = [{ filename: 'index.json', previous_filename: 'other', status: 'renamed' }]; }],
  ['tampered candidate', state => { state.candidate['index.json'] += ' '; }],
  ['hidden tree file', state => { state.extraTree.push({ path: '.github/workflows/evil.yml', mode: '100644', type: 'blob', sha: sha('6') }); }],
]) test('verification rejects ' + label, async () => {
  const options = await proposed();
  mutate(options.state);
  options.state.calls = [];
  await assert.rejects((await load()).verifyPullRequest({ ...options, number: 7, headSha: options.state.head }));
  assert.deepEqual(mutations(options.state), []);
});

test('rejects unsafe arguments and malformed or duplicated README markers', async () => {
  const options = await fixture();
  const module = await load();
  for (const number of [0, -1, '7', 1.2]) await assert.rejects(module.verifyPullRequest({ ...options, number, headSha: sha('c') }));
  for (const headSha of ['short', sha('A'), null]) await assert.rejects(module.verifyPullRequest({ ...options, number: 7, headSha }));
  options.state.files['README.md'] = 'no markers';
  await assert.rejects(module.proposeUpdate(options), /marker/i);
  assert.deepEqual(mutations(options.state), []);
});

test('refuses to overwrite human commits or an orphan existing branch', async () => {
  const options = await proposed();
  options.state.commitAuthor = 'human';
  options.state.calls = [];
  await assert.rejects((await load()).proposeUpdate(options), /bot|author/i);
  assert.deepEqual(mutations(options.state), []);
  options.state.commitAuthor = 'github-actions[bot]';
  options.state.pr = null;
  await assert.rejects((await load()).proposeUpdate(options), /existing|orphan|pull request/i);
});

async function readyRun() {
  const options = await proposed();
  options.state.calls = [];
  options.state.run = { id: 900, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', name: 'Verify reviewed index', path: '.github/workflows/verify.yml', repository: { full_name: repository }, head_repository: { full_name: repository }, head_branch: options.result.branch, head_sha: options.state.head };
  return options;
}

test('merges only a successful verified current head, then deletes that exact automation branch', async () => {
  const options = await readyRun();
  const result = await (await load()).mergeVerifiedRun({ ...options, runId: 900 });
  assert.equal(result.merged, true);
  const writes = mutations(options.state);
  assert.deepEqual(writes.map(call => call.method), ['PUT', 'DELETE']);
  assert.equal(writes[0].body.sha, options.state.head);
  assert.equal(writes[0].body.merge_method, 'squash');
  assert.equal(writes[1].request, `${base}/git/refs/heads/${options.result.branch}`);
});

for (const [label, mutate] of [
  ['failed run', state => { state.run.conclusion = 'failure'; }],
  ['incomplete run', state => { state.run.status = 'in_progress'; }],
  ['wrong event', state => { state.run.event = 'pull_request'; }],
  ['wrong workflow', state => { state.run.path = '.github/workflows/other.yml'; }],
  ['foreign repo', state => { state.run.repository.full_name = 'someone/fork'; }],
  ['wrong run name', state => { state.run.name = 'other'; }],
  ['stale run head', state => { state.run.head_sha = sha('8'); }],
  ['skipped verification', state => { state.jobs[0].conclusion = 'skipped'; }],
  ['duplicate verification jobs', state => { state.jobs.push(clone(state.jobs[0])); }],
  ['changed PR head', state => { state.changedHead = true; }],
]) test('merge refuses ' + label, async () => {
  const options = await readyRun();
  mutate(options.state);
  await assert.rejects((await load()).mergeVerifiedRun({ ...options, runId: 900 }));
  assert.deepEqual(mutations(options.state), []);
});
