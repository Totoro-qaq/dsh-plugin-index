import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../src/github.mjs');
const endpoint = 'repos/Totoro-qaq/dsh-plugin-index/git/ref/heads/main';

test('GitHub client binds authenticated requests to the three owned repositories', async () => {
  const { createGitHubClient } = await load();
  const calls = [];
  const github = createGitHubClient({ token: 'test-only-token', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response('{"sha":"abc"}');
  }});
  assert.deepEqual(await github(endpoint), { sha: 'abc' });
  assert.equal(calls[0].url, `https://api.github.com/${endpoint}`);
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-only-token');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.method, 'GET');
});

test('GitHub writes are JSON and restricted to the index repository', async () => {
  const { createGitHubClient } = await load();
  const calls = [];
  const github = createGitHubClient({ token: 'test-only-token', fetchImpl: async (url, options) => {
    calls.push(options);
    return new Response(null, { status: 204 });
  }});
  assert.equal(await github('repos/Totoro-qaq/dsh-plugin-index/actions/workflows/verify.yml/dispatches', {
    method: 'POST', body: { ref: 'index/releases/jot-0.2.13_bridge-0.4.6' },
  }), null);
  assert.deepEqual(JSON.parse(calls[0].body), { ref: 'index/releases/jot-0.2.13_bridge-0.4.6' });
  for (const repo of ['dsh-jot', 'dsh-plugin-bridge']) {
    await assert.rejects(github(`repos/Totoro-qaq/${repo}/pulls`, { method: 'POST', body: {} }), /write/i);
  }
  assert.equal(calls.length, 1);
});

test('GitHub rejects untrusted endpoints and unsupported methods before any network call', async () => {
  const { createGitHubClient } = await load();
  let calls = 0;
  const github = createGitHubClient({ token: 'test-only-token', fetchImpl: async () => { calls++; return new Response('{}'); }});
  for (const path of ['https://evil.invalid/', '//evil.invalid/', 'repos/foreign/project/pulls',
    'repos/Totoro-qaq/dsh-plugin-index/../foreign/pulls', 'repos/Totoro-qaq/dsh-plugin-index/pulls#fragment',
    'repos/Totoro-qaq/dsh-plugin-index/pulls\\foreign', 'repos/Totoro-qaq/dsh-plugin-index/%2e%2e/foreign']) {
    await assert.rejects(github(path), /endpoint/i);
  }
  await assert.rejects(github(endpoint, { method: 'DELETE-ALL' }), /method/i);
  await assert.rejects(github(endpoint, { method: 'GET', body: {} }), /body/i);
  assert.equal(calls, 0);
  assert.throws(() => createGitHubClient({ token: '' }), /token/i);
});

test('GitHub distinguishes optional 404, missing metadata and HTTP errors', async () => {
  const { createGitHubClient } = await load();
  for (const status of [404, 403, 429, 500]) {
    const github = createGitHubClient({ token: 'test-only-token', fetchImpl: async () => new Response('private error body', { status }) });
    if (status === 404) assert.equal(await github(endpoint, { allow404: true }), null);
    await assert.rejects(github(endpoint), error => error.status === status && !error.message.includes('private error body'));
  }
});

test('GitHub rejects redirects, wrong response URL, malformed JSON and oversized bodies', async () => {
  const { createGitHubClient } = await load();
  const redirected = new Response('{}');
  Object.defineProperty(redirected, 'redirected', { value: true });
  const wrongURL = new Response('{}');
  Object.defineProperty(wrongURL, 'url', { value: 'https://evil.invalid/' });
  for (const response of [redirected, wrongURL, new Response('{'), new Response('a'.repeat(200)),
    new Response('{}', { headers: { 'content-length': '200' } }), new Response(null)]) {
    const github = createGitHubClient({ token: 'test-only-token', maxBytes: 100, fetchImpl: async () => response });
    await assert.rejects(github(endpoint));
  }
});

test('GitHub bounds stalled fetches and response streams', async () => {
  const { createGitHubClient } = await load();
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const github = createGitHubClient({ token: 'test-only-token', timeoutMs: 10, fetchImpl });
    await assert.rejects(github(endpoint), /timeout/i);
  }
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 60001 }, { maxBytes: 0 }, { maxBytes: 17000000 }]) {
    assert.throws(() => createGitHubClient({ token: 'test-only-token', ...options }), /limit/i);
  }
});
