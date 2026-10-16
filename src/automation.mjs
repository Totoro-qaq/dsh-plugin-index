import { generateIndex, validatePins } from './index.mjs';
import { discoverPublishedReleases } from './releases.mjs';

const REPOSITORY = 'Totoro-qaq/dsh-plugin-index';
const BASE = `repos/${REPOSITORY}`;
const FILES = ['plugins.json', 'index.json', 'README.md', 'releases.json'];
const BOT = 'github-actions[bot]';
const SHA = /^[a-f0-9]{40}$/;
const START = '<!-- current-releases:start -->';
const END = '<!-- current-releases:end -->';
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

export function branchFor(config) {
  validatePins(config);
  const versions = Object.fromEntries(config.plugins.map(pin => [pin.name, pin.version]));
  for (const version of Object.values(versions)) ensure(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'Only stable versions may enter an automated branch');
  return `index/releases/jot-${versions['dsh-jot']}_bridge-${versions['dsh-plugin-bridge']}`;
}

export function renderCurrentReleases(readme, config) {
  ensure(typeof readme === 'string' && readme.split(START).length === 2 && readme.split(END).length === 2, 'Exactly one pair of current-release README markers is required');
  const start = readme.indexOf(START) + START.length;
  const end = readme.indexOf(END);
  ensure(start <= end, 'README release markers are reversed');
  const versions = Object.fromEntries(config.plugins.map(pin => [pin.name, pin.version]));
  const jot = versions['dsh-jot'];
  const bridge = versions['dsh-plugin-bridge'];
  const content = [
    '', '',
    '| 插件 | 版本 | 用途 |',
    '| --- | --- | --- |',
    `| [随记 Jot](https://github.com/Totoro-qaq/dsh-jot) | \`${jot}\` | 对话旁边的备忘录，支持文本、待办、表格、搜索、附件和导出。AI 协作默认关闭。 |`,
    `| [Bridge](https://github.com/Totoro-qaq/dsh-plugin-bridge) | \`${bridge}\` | 预览、编辑交接摘要，再切换模式开启新会话；保留原会话，不搬运旧工具历史。 |`,
    '',
    `安装目标固定为 \`dsh-jot@${jot}\` 和 \`dsh-plugin-bridge@${bridge}\`，registry 为 \`https://registry.npmjs.org/\`。宿主兼容范围和发布时间从这两个确切版本的 npm 元数据读取，DSH 在安装时会再次检查兼容性。`,
    '', '',
  ].join('\n');
  return readme.slice(0, start) + content + readme.slice(end);
}

async function fileAt(github, path, commit) {
  const file = await github(`${BASE}/contents/${path}?ref=${commit}`);
  ensure(file?.encoding === 'base64' && typeof file.content === 'string' && file.content.length <= 2 * 1024 * 1024 && (!file.type || file.type === 'file'), 'Missing or oversized index metadata file: ' + path);
  const encoded = file.content.replace(/[\r\n]/g, '');
  const bytes = Buffer.from(encoded, 'base64');
  ensure(bytes.toString('base64') === encoded && bytes.length <= 1024 * 1024, 'Invalid index metadata encoding or size: ' + path);
  ensure(!bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes), 'Index metadata must be valid UTF-8 text: ' + path);
  return bytes.toString('utf8');
}

async function filesAt(github, commit) {
  const entries = await Promise.all(FILES.map(async path => [path, await fileAt(github, path, commit)]));
  return Object.fromEntries(entries);
}

async function mainSnapshot(github) {
  const ref = await github(`${BASE}/git/ref/heads/main`);
  ensure(ref?.ref === 'refs/heads/main' && ref.object?.type === 'commit' && SHA.test(ref.object.sha), 'Invalid trusted main reference');
  const sha = ref.object.sha;
  const commit = await github(`${BASE}/git/commits/${sha}`);
  ensure(commit?.sha === sha && SHA.test(commit.tree?.sha), 'Invalid trusted main commit tree');
  const files = await filesAt(github, sha);
  const config = JSON.parse(files['plugins.json']);
  validatePins(config);
  return { sha, treeSha: commit.tree.sha, files, config };
}

async function expectedUpdate(snapshot, { github, fetchImpl }) {
  const release = await discoverPublishedReleases({ config: snapshot.config, github, fetchImpl });
  const index = await generateIndex(release.config, { fetchImpl });
  return {
    branch: branchFor(release.config), config: release.config,
    files: {
      'plugins.json': serialize(release.config),
      'index.json': serialize(index),
      'README.md': renderCurrentReleases(snapshot.files['README.md'], release.config),
      'releases.json': serialize(release.receipts),
    },
  };
}

async function pages(github, endpoint, field) {
  const rows = [];
  for (let page = 1; page <= 5; page++) {
    const response = await github(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const values = field ? response?.[field] : response;
    ensure(Array.isArray(values) && values.length <= 100, 'Invalid GitHub paginated response');
    rows.push(...values);
    if (values.length < 100) return rows;
  }
  throw new Error('GitHub pagination limit reached');
}

function validatePr(pr, { number, headSha, branch } = {}) {
  ensure(positiveInteger(pr?.number) && (number === undefined || pr.number === number), 'Pull request number mismatch');
  ensure(pr.user?.login === BOT && pr.state === 'open' && pr.draft === false, 'An open, non-draft bot pull request is required');
  ensure(pr.base?.repo?.full_name === REPOSITORY && pr.head?.repo?.full_name === REPOSITORY && pr.base.ref === 'main', 'Pull request repositories or base mismatch');
  ensure(SHA.test(pr.head.sha) && (headSha === undefined || pr.head.sha === headSha), 'Pull request head SHA changed');
  ensure(typeof pr.head.ref === 'string' && pr.head.ref.startsWith('index/releases/') && (branch === undefined || pr.head.ref === branch), 'Unexpected automation branch');
  ensure(pr.html_url === `https://github.com/${REPOSITORY}/pull/${pr.number}`, 'Pull request URL mismatch');
  return pr;
}

async function openPr(github, branch) {
  const pulls = await pages(github, `${BASE}/pulls?state=open&base=main&head=Totoro-qaq:${encodeURIComponent(branch)}`);
  ensure(pulls.length <= 1, 'Multiple open automation pull requests for one branch');
  return pulls.length ? validatePr(pulls[0], { branch }) : null;
}

async function inspectChanges(github, snapshot, pr) {
  const files = await pages(github, `${BASE}/pulls/${pr.number}/files`);
  ensure(files.length > 0 && files.length <= FILES.length && new Set(files.map(file => file.filename)).size === files.length, 'Unexpected pull request file count');
  for (const file of files) ensure(FILES.includes(file.filename) && ['added', 'modified'].includes(file.status) && !file.previous_filename, 'Only metadata additions or modifications may be automated');
  const comparison = await github(`${BASE}/compare/${snapshot.sha}...${pr.head.sha}`);
  const mergeBase = comparison?.merge_base_commit?.sha;
  ensure(SHA.test(mergeBase), 'A valid actual pull request merge base is required');
  const [original, candidate] = await Promise.all([
    github(`${BASE}/git/trees/${mergeBase}?recursive=1`),
    github(`${BASE}/git/trees/${pr.head.sha}?recursive=1`),
  ]);
  const map = response => {
    ensure(response?.truncated === false && Array.isArray(response.tree) && response.tree.length <= 10000, 'Incomplete repository tree');
    const result = new Map();
    for (const entry of response.tree) {
      ensure(typeof entry.path === 'string' && !result.has(entry.path) && SHA.test(entry.sha), 'Invalid or duplicate tree entry');
      result.set(entry.path, entry);
    }
    return result;
  };
  const before = map(original);
  const after = map(candidate);
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(path);
    const right = after.get(path);
    if (FILES.includes(path)) ensure(right?.type === 'blob' && right.mode === '100644', 'Metadata files must be regular non-executable files');
    else ensure(left && right && left.sha === right.sha && left.mode === right.mode && left.type === right.type, 'Unexpected non-metadata tree change: ' + path);
  }
  return { mergeBase };
}

async function dispatchVerification(github, pr) {
  await github(`${BASE}/actions/workflows/verify.yml/dispatches`, {
    method: 'POST', body: { ref: pr.head.ref, inputs: { pull_request: String(pr.number), head_sha: pr.head.sha } },
  });
  return { changed: true, number: pr.number, headSha: pr.head.sha, branch: pr.head.ref, url: pr.html_url };
}

export async function proposeUpdate({ github, fetchImpl = fetch }) {
  const snapshot = await mainSnapshot(github);
  const expected = await expectedUpdate(snapshot, { github, fetchImpl });
  if (FILES.every(path => expected.files[path] === snapshot.files[path])) return { changed: false };
  const ref = await github(`${BASE}/git/ref/heads/${expected.branch}`, { allow404: true });
  let pr = await openPr(github, expected.branch);
  let parents = [snapshot.sha];
  if (ref) {
    ensure(pr && ref.ref === 'refs/heads/' + expected.branch && ref.object?.type === 'commit' && ref.object.sha === pr.head.sha, 'Existing branch must belong to its exact automation pull request');
    const commit = await github(`${BASE}/commits/${pr.head.sha}`);
    ensure(commit?.author?.login === BOT, 'Existing branch head author must be the bot');
    const inspection = await inspectChanges(github, snapshot, pr);
    const current = await filesAt(github, pr.head.sha);
    if (inspection.mergeBase === snapshot.sha && FILES.every(path => current[path] === expected.files[path])) return dispatchVerification(github, pr);
    parents = [...new Set([pr.head.sha, snapshot.sha])];
  } else ensure(pr === null, 'Existing pull request has no matching branch');
  const tree = await github(`${BASE}/git/trees`, { method: 'POST', body: { base_tree: snapshot.treeSha, tree: FILES.map(path => ({ path, mode: '100644', type: 'blob', content: expected.files[path] })) } });
  ensure(SHA.test(tree?.sha), 'GitHub did not create a valid metadata tree');
  const versions = expected.config.plugins.map(pin => `${pin.name}@${pin.version}`).join(', ');
  const commit = await github(`${BASE}/git/commits`, { method: 'POST', body: { message: 'chore: index published ' + versions, tree: tree.sha, parents } });
  ensure(SHA.test(commit?.sha), 'GitHub did not create a valid metadata commit');
  if (ref) {
    await github(`${BASE}/git/refs/heads/${expected.branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
    pr = { ...pr, head: { ...pr.head, sha: commit.sha } };
  } else {
    await github(`${BASE}/git/refs`, { method: 'POST', body: { ref: 'refs/heads/' + expected.branch, sha: commit.sha } });
    pr = await github(`${BASE}/pulls`, { method: 'POST', body: { title: 'chore: index published ' + versions, head: expected.branch, base: 'main', body: 'Updates only the two author-owned npm release pins, generated index, current-version README section and publisher receipts. A separate read-only verification checks the exact head against successful npm publishers before merge.' } });
  }
  validatePr(pr, { headSha: commit.sha, branch: expected.branch });
  return dispatchVerification(github, pr);
}

export async function verifyPullRequest({ github, fetchImpl = fetch, number, headSha }) {
  ensure(positiveInteger(number) && SHA.test(headSha), 'A positive pull request number and exact lowercase commit SHA are required');
  const pr = validatePr(await github(`${BASE}/pulls/${number}`), { number, headSha });
  const snapshot = await mainSnapshot(github);
  await inspectChanges(github, snapshot, pr);
  const files = await filesAt(github, headSha);
  const candidate = JSON.parse(files['plugins.json']);
  validatePins(candidate);
  ensure(pr.head.ref === branchFor(candidate), 'Candidate versions do not match the automation branch');
  const expected = await expectedUpdate(snapshot, { github, fetchImpl });
  ensure(expected.branch === pr.head.ref && FILES.every(path => files[path] === expected.files[path]), 'Candidate metadata differs from trusted release regeneration');
  return { number, headSha, baseSha: snapshot.sha, branch: pr.head.ref, url: pr.html_url };
}

export async function mergeVerifiedRun({ github, fetchImpl = fetch, runId }) {
  ensure(positiveInteger(runId), 'A positive verification run ID is required');
  const run = await github(`${BASE}/actions/runs/${runId}`);
  ensure(run?.id === runId && run.status === 'completed' && run.conclusion === 'success' && run.event === 'workflow_dispatch' && run.name === 'Verify reviewed index' && run.path === '.github/workflows/verify.yml', 'A successful exact verification workflow run is required');
  ensure(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY && SHA.test(run.head_sha) && typeof run.head_branch === 'string' && run.head_branch.startsWith('index/releases/'), 'Verification run repository, branch or head mismatch');
  const pr = await openPr(github, run.head_branch);
  ensure(pr && pr.head.sha === run.head_sha, 'Verification run no longer matches an open pull request head');
  const jobs = await pages(github, `${BASE}/actions/runs/${runId}/jobs`, 'jobs');
  const verify = jobs.filter(job => job?.name === 'verify');
  ensure(verify.length === 1 && verify[0].status === 'completed' && verify[0].conclusion === 'success' && verify[0].head_sha === run.head_sha, 'Verification job must have actually succeeded for the exact head');
  const evidence = await verifyPullRequest({ github, fetchImpl, number: pr.number, headSha: run.head_sha });
  const current = await github(`${BASE}/git/ref/heads/main`);
  ensure(current?.object?.sha === evidence.baseSha, 'Trusted main changed during verification; retry on the fresh base');
  validatePr(await github(`${BASE}/pulls/${pr.number}`), { number: pr.number, headSha: evidence.headSha, branch: evidence.branch });
  const result = await github(`${BASE}/pulls/${pr.number}/merge`, { method: 'PUT', body: { merge_method: 'squash', sha: evidence.headSha, commit_title: 'chore: update verified published plugin index' } });
  ensure(result?.merged === true && SHA.test(result.sha), 'GitHub did not confirm the verified merge');
  const ref = await github(`${BASE}/git/ref/heads/${evidence.branch}`, { allow404: true });
  const unchanged = ref?.ref === 'refs/heads/' + evidence.branch && ref.object?.type === 'commit' && ref.object.sha === evidence.headSha;
  if (unchanged) await github(`${BASE}/git/refs/heads/${evidence.branch}`, { method: 'DELETE' });
  return { merged: true, number: pr.number, sha: result.sha, url: pr.html_url, branchDeleted: unchanged };
}
