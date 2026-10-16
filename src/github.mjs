const API = 'https://api.github.com/';
const OWNED = /^repos\/Totoro-qaq\/(?:dsh-plugin-index|dsh-jot|dsh-plugin-bridge)\//;
const INDEX = 'repos/Totoro-qaq/dsh-plugin-index/';
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

// A job-scoped token is passed by Actions; no credential is stored or logged.
export function createGitHubClient({ token, fetchImpl = fetch, timeoutMs = 10000, maxBytes = 4 * 1024 * 1024 }) {
  ensure(typeof token === 'string' && token.trim() !== '', 'A job-scoped GitHub token is required');
  ensure(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'Invalid timeout limit');
  ensure(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 16 * 1024 * 1024, 'Invalid response size limit');

  return async (endpoint, { method = 'GET', body, allow404 = false } = {}) => {
    ensure(typeof endpoint === 'string' && OWNED.test(endpoint) && !/[\\#\u0000-\u0020]/u.test(endpoint)
      && !/(?:^|\/)\.\.(?:\/|$)|%2e/iu.test(endpoint), 'Untrusted GitHub endpoint');
    ensure(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method), 'Unsupported GitHub method');
    ensure(method !== 'GET' || body === undefined, 'GET must not have a request body');
    ensure(method === 'GET' || endpoint.startsWith(INDEX), 'GitHub writes are restricted to the index repository');
    const url = new URL(endpoint, API);
    ensure(url.origin === 'https://api.github.com' && OWNED.test(url.pathname.slice(1)), 'Untrusted GitHub endpoint');
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('GitHub request timeout')); }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(url.href, {
          method, redirect: 'error', signal: controller.signal,
          headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
            'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        ensure(!response.redirected && (!response.url || response.url === url.href), 'GitHub redirect or unexpected response URL');
        if (response.status === 404 && allow404) return null;
        if (response.status < 200 || response.status >= 300) {
          const error = new Error(`GitHub HTTP ${response.status}: ${method} ${url.pathname}`);
          error.status = response.status;
          throw error;
        }
        if (response.status === 204) return null;
        ensure(Number(response.headers.get('content-length') ?? 0) <= maxBytes, 'GitHub response size is too large');
        ensure(response.body, 'GitHub response body is absent');
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            ensure(bytes <= maxBytes, 'GitHub response size is too large');
            chunks.push(value);
          }
        } catch (error) {
          reader.cancel().catch(() => {});
          throw error;
        } finally { reader.releaseLock(); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      })()]);
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
