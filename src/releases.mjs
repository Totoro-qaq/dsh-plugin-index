import { validatePins, fetchPackument } from './index.mjs';

const REPOSITORIES = Object.freeze({
  'dsh-jot': 'Totoro-qaq/dsh-jot',
  'dsh-plugin-bridge': 'Totoro-qaq/dsh-plugin-bridge',
});
const WORKFLOW = '.github/workflows/publish.yml';
const SHA = /^[a-f0-9]{40}$/;
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

function stableParts(version) {
  ensure(typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'A canonical stable npm version is required');
  return version.split('.').map(BigInt);
}

function notOlder(version, pin) {
  const left = stableParts(version);
  const right = stableParts(pin);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return true;
}

function npmIntegrity(value) {
  ensure(typeof value === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value), 'A canonical SHA-512 npm integrity value is required');
  const encoded = value.slice(7);
  const bytes = Buffer.from(encoded, 'base64');
  ensure(bytes.length === 64 && bytes.toString('base64') === encoded, 'Invalid npm integrity bytes');
  return value;
}

async function pages(github, endpoint, field) {
  const rows = [];
  for (let page = 1; page <= 5; page++) {
    const response = await github(`${endpoint}?per_page=100&page=${page}`);
    ensure(Array.isArray(response?.[field]) && response[field].length <= 100, 'Invalid GitHub paginated response');
    rows.push(...response[field]);
    if (response[field].length < 100) return rows;
  }
  throw new Error('GitHub pagination limit reached; refusing incomplete release evidence');
}

async function tagCommit(github, base, tag) {
  const ref = await github(`${base}/git/ref/tags/${tag}`);
  ensure(ref?.ref === 'refs/tags/' + tag, 'GitHub tag reference mismatch');
  let object = ref.object;
  for (let depth = 0; depth < 5; depth++) {
    ensure(object && SHA.test(object.sha), 'Invalid GitHub tag object SHA');
    if (object.type === 'commit') return object.sha;
    ensure(object.type === 'tag', 'GitHub tag must resolve to a commit');
    object = (await github(`${base}/git/tags/${object.sha}`))?.object;
  }
  throw new Error('GitHub annotated tag depth limit reached');
}

async function tagManifest(github, base, commit) {
  const file = await github(`${base}/contents/package.json?ref=${commit}`);
  ensure(file?.encoding === 'base64' && typeof file.content === 'string' && file.content.length <= 512 * 1024, 'Missing or oversized tag package.json');
  const encoded = file.content.replace(/[\r\n]/g, '');
  const bytes = Buffer.from(encoded, 'base64');
  ensure(bytes.toString('base64') === encoded, 'Invalid tag package.json encoding');
  return JSON.parse(bytes.toString('utf8'));
}

function eligibleRun(run, { name, repository, tag, commit, version }) {
  if (!positiveInteger(run?.id) || !positiveInteger(run.run_attempt) || !SHA.test(run.head_sha)) return false;
  if (run.status !== 'completed' || run.conclusion !== 'success' || run.path !== WORKFLOW) return false;
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) return false;
  if (run.html_url !== `https://github.com/${repository}/actions/runs/${run.id}` || !Number.isFinite(Date.parse(run.created_at))) return false;
  return (run.event === 'release' && run.head_branch === tag && run.head_sha === commit)
    || (run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.display_title === `Publish ${name} v${version}`);
}

async function publishEvidence(github, base, source) {
  const runs = await pages(github, `${base}/actions/workflows/publish.yml/runs`, 'workflow_runs');
  const eligible = runs.filter(run => eligibleRun(run, source));
  eligible.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || left.id - right.id);
  for (const run of eligible) {
    const jobs = await pages(github, `${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    const npm = jobs.filter(job => job?.name === 'npm');
    if (npm.length === 1 && npm[0].status === 'completed' && npm[0].conclusion === 'success' && npm[0].head_sha === run.head_sha) return run;
  }
  throw new Error(`No successful bound npm publisher for ${source.name}@${source.version}`);
}

// This function reads metadata only. The caller owns HTTP authentication,
// timeouts and mutation permissions; no package is installed or executed here.
export async function discoverPublishedReleases({ config, github, fetchImpl = fetch }) {
  validatePins(config);
  ensure(typeof github === 'function', 'A GitHub API reader is required');
  const updated = structuredClone(config);
  const receipts = { schema: 1, packages: {} };
  for (const pin of updated.plugins) {
    const name = pin.name;
    const repository = REPOSITORIES[name];
    const base = `repos/${repository}`;
    const packument = await fetchPackument(name, { fetchImpl });
    ensure(packument?.name === name, 'npm package name mismatch');
    const version = packument['dist-tags']?.latest;
    ensure(notOlder(version, pin.version), 'npm latest would downgrade the current index pin');
    const manifest = packument.versions?.[version];
    ensure(manifest?.name === name && manifest.version === version, 'Exact npm version manifest is unavailable');
    ensure(manifest.deprecated === undefined || manifest.deprecated === '', 'Latest npm version is deprecated');
    const integrity = npmIntegrity(manifest.dist?.integrity);
    const dsh = manifest.engines?.dsh;
    const patch = manifest.dsh?.bundle?.patch;
    ensure(typeof dsh === 'string' && dsh.trim() && typeof patch === 'string' && patch.trim(), 'npm host engines and bundle patch are required');
    const tag = 'v' + version;
    const release = await github(`${base}/releases/tags/${tag}`);
    ensure(release?.tag_name === tag && release.draft === false && release.prerelease === false && typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)), 'A published stable GitHub Release is required');
    const commit = await tagCommit(github, base, tag);
    const tagged = await tagManifest(github, base, commit);
    ensure(tagged?.name === name && tagged.version === version && tagged.engines?.dsh === dsh && tagged.dsh?.bundle?.patch === patch, 'GitHub tag manifest does not match npm release');
    const run = await publishEvidence(github, base, { name, repository, version, tag, commit });
    pin.version = version;
    receipts.packages[name] = {
      version, repository, tag, commit,
      publishRunId: run.id, publishRunUrl: run.html_url, integrity,
    };
  }
  return { config: updated, receipts };
}
