#!/usr/bin/env node
import { readFile, readdir, cp, mkdir, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execute, stateDir, readJson, saveJson, withLock, recoverLock, exists, XgError, VERSION, redact } from './lib/runtime.mjs';
import { nodeCompatible, findCompatibleNode, connect, inspectEnvironment, installGrokCli, detectApp } from './lib/environment.mjs';
import { dateWindow, buildPrompt } from './lib/prompt.mjs';
import { loadConfig, configPath, ensureBot, beginResearch, pollResearch, runPath, releaseResearch, sessionId } from './lib/research.mjs';

const HELP = `x-cli-via-grok ${VERSION} — public Twitter/X research through Grok Bot

  doctor [--online]                         Check app, CLI and login; offline by default
  setup [--authorize-app-session]           Install missing CLI, verify login, reuse/create a dedicated bot
        [--install-cli] [--bot-id ID]        Private pinned CLI install; choose an existing dedicated bot
  plan --prompt-file FILE                   Preview the readable expanded prompt without sending
  query --prompt-file FILE                  Start one self-contained research request
        [--session ID] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
        [--timezone Asia/Shanghai] [--language zh-CN] [--wait 40]
  read RUN_ID [--wait 40]                    Read only the matching request's replies
  sessions                                 List local request metadata; no Grok sidebar objects
  release RUN_ID --confirmed-finished       Release local bookkeeping after verifying Grok has finished
  recover-lock                             Recover only a verified dead local process lock
  install-skill --host codex|claude|both     Install the self-contained skill for automatic discovery
                [--dir DIRECTORY]           Optional custom skills parent directory (one host)

Input can also use --query TEXT instead of --prompt-file. Output is JSON; --json is accepted.
Dates are inclusive; omitted dates default to the last 7 calendar days. No posting or DMs.
Node.js 22.19+ and the installed, signed-in Grok Bot desktop app are required.
`;
const optionsByCommand = {
  doctor: ['online'], setup: ['authorize-app-session', 'install-cli', 'bot-id'],
  plan: ['prompt-file', 'query', 'session', 'since', 'until', 'timezone', 'language'],
  query: ['prompt-file', 'query', 'session', 'since', 'until', 'timezone', 'language', 'wait'],
  read: ['wait'], sessions: [], release: ['confirmed-finished'], 'recover-lock': [],
  'install-skill': ['host', 'dir']
};
const booleans = new Set(['online', 'authorize-app-session', 'install-cli', 'confirmed-finished', 'json']);
export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  if (['help', '--help', '-h'].includes(command)) return { command: 'help', options: {}, positionals: [] };
  if (command === '--version') return { command: 'version', options: {}, positionals: [] };
  if (!(command in optionsByCommand)) throw new XgError('COMMAND_INVALID', 'Unknown command. Use --help.');
  const options = {}, positionals = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    const key = arg.slice(2);
    if (key !== 'json' && !optionsByCommand[command].includes(key)) throw new XgError('OPTION_INVALID', `Unsupported option: ${arg}`);
    if (key in options) throw new XgError('OPTION_DUPLICATE', `Duplicate option: ${arg}`);
    if (booleans.has(key)) options[key] = true;
    else {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new XgError('OPTION_VALUE_REQUIRED', `Missing value for ${arg}`);
      options[key] = rest[++i];
    }
  }
  const expected = ['read', 'release'].includes(command) ? 1 : 0;
  if (positionals.length !== expected) throw new XgError('ARGUMENT_INVALID', `${command} expects ${expected} positional argument(s).`);
  return { command, options, positionals };
}
async function requestInput(options) {
  if (Boolean(options.query) === Boolean(options['prompt-file'])) throw new XgError('INPUT_REQUIRED', 'Use exactly one of --prompt-file FILE and --query TEXT.');
  const goal = options.query ?? await readFile(resolve(options['prompt-file']), 'utf8');
  const window = dateWindow({ since: options.since, until: options.until, timezone: options.timezone });
  return { goal, window, session: options.session, language: options.language };
}
export async function installSkill({ host, dir }) {
  if (!['codex', 'claude', 'both'].includes(host) || (dir && host === 'both')) throw new XgError('HOST_REQUIRED', 'Use --host codex, claude or both. A custom --dir accepts one host only.');
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const targets = host === 'both' ? ['codex', 'claude'] : [host];
  const destinations = targets.map(target => join(dir ? resolve(dir) : target === 'codex' ? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills') : join(homedir(), '.claude', 'skills'), 'x-research-via-grok'));
  async function sameTree(from, to) {
    const [a, b] = await Promise.all([readdir(from, { withFileTypes: true }), readdir(to, { withFileTypes: true })]);
    if (a.length !== b.length) return false;
    for (const entry of a) {
      const other = b.find(x => x.name === entry.name);
      if (!other || entry.isDirectory() !== other.isDirectory() || entry.isSymbolicLink() || other.isSymbolicLink()) return false;
      if (entry.isDirectory()) { if (!await sameTree(join(from, entry.name), join(to, entry.name))) return false; }
      else if (!(await readFile(join(from, entry.name))).equals(await readFile(join(to, entry.name)))) return false;
    }
    return true;
  }
  // Preflight all destinations before copying anything. Existing identical installs are a no-op.
  for (const destination of destinations) if (await exists(destination)) {
    if (await realpath(destination) === await realpath(source) || await sameTree(source, destination)) continue;
    throw new XgError('SKILL_EXISTS', `A skill already exists at ${destination}. Review it before replacing it; this installer will not overwrite it.`);
  }
  for (const destination of destinations) {
    if (await exists(destination)) continue;
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
  }
  return { status: 'installed', paths: destinations, note: 'Reopen the agent session if needed for skill discovery. Automatic selection is decided by the host model; installation does not force a trigger.' };
}
export async function main(argv = process.argv.slice(2)) {
  const { command, options, positionals } = parseArgs(argv);
  if (command === 'help') { process.stdout.write(HELP); return; }
  if (command === 'version') { process.stdout.write(`${VERSION}\n`); return; }
  if (command === 'install-skill') return installSkill({ host: options.host, dir: options.dir });
  if (command === 'plan') {
    const input = await requestInput(options);
    const id = randomUUID(), sid = sessionId(input.session);
    return { status: 'preview', sessionId: sid, window: input.window, prompt: buildPrompt({ ...input, sessionId: sid, runId: id }) };
  }
  const dir = stateDir();
  if (command === 'doctor' && !options.online) {
    const config = await loadConfig(dir);
    return { ...await inspectEnvironment(dir, config), stateDirectory: dir, lock: await readJson(join(dir, 'operation.lock', 'owner.json')), note: 'Offline check. Run doctor --online to verify the login without creating a bot.' };
  }
  if (command === 'recover-lock') return recoverLock(dir);
  return withLock(dir, async () => {
    const config = await loadConfig(dir);
    if (command === 'sessions') {
      const runsDir = join(dir, 'runs');
      if (!await exists(runsDir)) return [];
      const out = [];
      for (const name of (await readdir(runsDir)).filter(n => /^[0-9a-f-]{36}\.json$/i.test(n))) {
        const run = await readJson(join(runsDir, name));
        out.push({ runId: run.id, sessionId: run.sessionId, status: run.status, createdAt: run.createdAt, botId: run.bot.id });
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (command === 'release') return releaseResearch(dir, config, positionals[0], options['confirmed-finished']);
    const input = command === 'query' ? await requestInput(options) : null;
    const wait = options.wait === undefined ? (command === 'query' ? 40 : 0) : Number(options.wait);
    if (!Number.isFinite(wait) || wait < 0 || wait > 50) throw new XgError('WAIT_INVALID', 'wait must be between 0 and 50 seconds.');
    if (options['install-cli']) {
      const app = await detectApp();
      if (!app.installed) throw new XgError('GROK_APP_REQUIRED', `Install and sign in to Grok Bot first: ${app.installUrl}`);
      await installGrokCli(dir);
    }
    const connected = await connect(dir, config, { install: command === 'setup' || command === 'query', authorize: options['authorize-app-session'] });
    const { client } = connected;
    if (command === 'doctor') {
      await client.listBots();
      return { ...connected.status, authentication: { ...connected.status.authentication, verified: true }, profileKey: client.profileKey, note: 'Login verified; no bot was created or changed.' };
    }
    if (command === 'setup') {
      const bot = await ensureBot(client, dir, config, { botId: options['bot-id'] });
      if (options['authorize-app-session']) { config.legacySessionAuthorized = true; await saveJson(configPath(dir), config); }
      return { status: 'ready', bot, profileKey: client.profileKey, cli: connected.status.cli, isolation: 'one dedicated bot; separate local sessions and gateway request IDs; shared server memory' };
    }
    if (command === 'query') {
      const run = await beginResearch(client, dir, config, input);
      return pollResearch(client, dir, config, run, { wait });
    }
    if (command === 'read') {
      const run = await readJson(runPath(dir, positionals[0]));
      if (!run) throw new XgError('RUN_NOT_FOUND', 'Unknown local request ID.');
      return pollResearch(client, dir, config, run, { wait });
    }
  });
}
export async function launch() {
  try {
    if (!nodeCompatible() && !['--help', '-h', 'help', '--version'].includes(process.argv[2])) {
      const node = await findCompatibleNode();
      const env = { ...process.env, XG_NODE_REEXEC: '1' };
      if (process.env.XG_NODE_REEXEC) throw new XgError('NODE_REQUIRED', 'Could not select a supported Node.js runtime.');
      const result = await execute(node, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { env, timeout: 240000 });
      process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.code ?? 1; return;
    }
    const result = await main();
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${JSON.stringify({ error: { code: e.code || 'FAILED', message: redact(e.message), ...(e.details || {}) } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) await launch();
