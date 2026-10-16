import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createGitHubClient } from './github.mjs';

const positiveInteger = value => /^\d+$/u.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

export async function runAutomation(args, {
  env = process.env, github, fetchImpl, operations, readFile = fs.readFile, log = console.log,
} = {}) {
  if (args.length !== 1 || !['propose', 'verify', 'merge'].includes(args[0])) {
    throw new Error('Usage: node src/automation-cli.mjs propose | verify | merge');
  }
  const [command] = args;
  let parameters = {};
  if (command === 'verify') {
    if (!positiveInteger(env.PR_NUMBER) || !/^[a-f0-9]{40}$/u.test(env.HEAD_SHA ?? '')) {
      throw new Error('Exact positive PR_NUMBER and 40-character HEAD_SHA are required');
    }
    parameters = { number: Number(env.PR_NUMBER), headSha: env.HEAD_SHA };
  }
  if (command === 'merge') {
    if (!env.GITHUB_EVENT_PATH) throw new Error('A workflow-run event file is required');
    const bytes = await readFile(env.GITHUB_EVENT_PATH, 'utf8');
    if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) throw new Error('Workflow event is too large');
    const event = JSON.parse(bytes);
    if (!positiveInteger(event.workflow_run?.id)) throw new Error('A workflow-run event ID is required');
    parameters = { runId: Number(event.workflow_run.id) };
  }
  const client = github ?? createGitHubClient({ token: env.GH_TOKEN });
  const handlers = operations ?? await import('./automation.mjs');
  const action = { propose: 'proposeUpdate', verify: 'verifyPullRequest', merge: 'mergeVerifiedRun' }[command];
  const result = await handlers[action]({ github: client, fetchImpl, ...parameters });
  log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAutomation(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
