import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSkill, installCapability, skillDestinations } from '../skills/x-research-via-grok/scripts/lib/installation.mjs';
import { execute, XgError } from '../skills/x-research-via-grok/scripts/lib/runtime.mjs';

const entry = fileURLToPath(new URL('../bin/x-cli-via-grok.mjs', import.meta.url));
const temp = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'xg-install-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
async function fixture(t) {
  const dir = await temp(t), source = join(dir, 'source');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '# Example skill\n');
  return { dir, source, options: { host: 'codex', dir: join(dir, 'skills') } };
}

test('installation targets the selected host user directory', () => {
  const home = join(tmpdir(), 'example-profile');
  assert.deepEqual(skillDestinations({ host: 'both', home }), [
    join(home, '.agents', 'skills', 'x-research-via-grok'),
    join(home, '.claude', 'skills', 'x-research-via-grok')
  ]);
  assert.throws(() => skillDestinations({ host: 'both', dir: home }), { code: 'HOST_REQUIRED' });
});

test('managed installs update unchanged content and preserve user edits', async t => {
  const { source, options } = await fixture(t);
  const first = await installSkill(options, { source });
  await writeFile(join(source, 'SKILL.md'), '# Updated example skill\n');
  await installSkill(options, { source });
  const installed = join(first.paths[0], 'SKILL.md');
  assert.equal(await readFile(installed, 'utf8'), '# Updated example skill\n');
  await appendFile(installed, 'Custom instructions\n');
  await writeFile(join(source, 'SKILL.md'), '# Another version\n');
  await assert.rejects(installSkill(options, { source }), { code: 'SKILL_EXISTS' });
  assert.match(await readFile(installed, 'utf8'), /Custom instructions/);
});

test('all requested hosts are checked before an existing installation is updated', async t => {
  const { dir, source } = await fixture(t), options = { host: 'both', home: join(dir, 'profile') };
  const first = await installSkill(options, { source });
  await appendFile(join(first.paths[1], 'SKILL.md'), 'Custom instructions\n');
  await writeFile(join(source, 'SKILL.md'), '# Updated example skill\n');
  await assert.rejects(installSkill(options, { source }), { code: 'SKILL_EXISTS' });
  assert.equal(await readFile(join(first.paths[0], 'SKILL.md'), 'utf8'), '# Example skill\n');
});

test('initialization is required for readiness and user action remains resumable', async t => {
  const { source, options } = await fixture(t);
  let prepared = 0;
  const dependencies = {
    install: opts => installSkill(opts, { source }),
    prepare: async () => { prepared++; throw new XgError('AUTHORIZATION_REQUIRED', 'Existing app session requires authorization.'); }
  };
  const pending = await installCapability(options, dependencies);
  assert.equal(pending.status, 'needs_user_action');
  assert.equal(pending.stage, 'initialization');
  assert.equal(pending.skill.status, 'installed');
  assert.equal(pending.nextAction.type, 'authorize_app_session');
  dependencies.prepare = async () => { prepared++; return { status: 'ready', bot: { id: 'example-bot' } }; };
  const ready = await installCapability(options, dependencies);
  assert.equal(ready.status, 'ready');
  assert.equal(prepared, 2);
  await appendFile(join(ready.skill.paths[0], 'SKILL.md'), 'Custom instructions\n');
  const conflict = await installCapability(options, dependencies);
  assert.equal(conflict.nextAction.type, 'review_skill');
  assert.equal(prepared, 2);
});

async function environment(t) {
  const dir = await temp(t), app = join(dir, 'ExampleApp'), data = join(dir, 'app-data'), cli = join(dir, 'fake-grok.mjs');
  await mkdir(app); await mkdir(data);
  await writeFile(cli, `import { readFile, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
let state; try { state = JSON.parse(await readFile(process.env.EXAMPLE_BOT_STATE, 'utf8')); } catch { state = { bots: [], creates: 0 }; }
if (args[0] === '--version') console.log('0.12.4');
else if (args[0] === 'bots' && args[1] === 'list') console.log(JSON.stringify(state.bots));
else if (args[0] === 'bots' && args[1] === 'create') {
  const bot = { id: 'example-research-bot', name: args[args.indexOf('--name') + 1], description: args[args.indexOf('--description') + 1] };
  state.bots.push(bot); state.creates++; await writeFile(process.env.EXAMPLE_BOT_STATE, JSON.stringify(state)); console.log(JSON.stringify(bot));
} else { console.error('Unexpected operation'); process.exitCode = 1; }
`);
  const env = {
    ...process.env, XG_GROK_APP_PATH: app, XG_GROK_APP_DATA: data,
    XG_GROK_CLIENT_VERSION: '1.0.0', XG_GROK_CLI: cli, XG_STATE_DIR: join(dir, 'state'),
    CURSOR_ACCESS_TOKEN: '', GROK_BOT_GATEWAY_HEADERS: '',
    GROK_BOT_GATEWAY_URL: 'https://example.invalid', GROK_BOT_GATEWAY_TOKEN: 'synthetic-token',
    EXAMPLE_BOT_STATE: join(dir, 'example-bots.json')
  };
  return { dir, data, env, args: [entry, 'install', '--host', 'codex', '--dir', join(dir, 'skills'), '--json'] };
}

test('one install command initializes once and the copied runtime remains independent', async t => {
  const { dir, env, args } = await environment(t);
  const first = await execute(process.execPath, args, { env });
  assert.equal(first.code, 0, first.stderr);
  const ready = JSON.parse(first.stdout);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.research.bot.id, 'example-research-bot');
  assert.equal((await execute(process.execPath, args, { env })).code, 0);
  const state = JSON.parse(await readFile(env.EXAMPLE_BOT_STATE, 'utf8'));
  assert.equal(state.creates, 1);
  assert.deepEqual((await readdir(join(dir, 'state'))).sort(), ['config.json']);
  const installed = await execute(process.execPath, [ready.skill.runtimes[0], 'install', '--host', 'codex', '--dir', join(dir, 'skills'), '--json'], { env });
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).status, 'ready');
});

test('missing desktop app keeps the skill installed and returns an actionable nonzero result', async t => {
  const { dir, env, args } = await environment(t);
  env.XG_GROK_APP_PATH = join(dir, 'missing-app');
  const result = await execute(process.execPath, args, { env });
  assert.equal(result.code, 1);
  const pending = JSON.parse(result.stdout);
  assert.equal(pending.status, 'needs_user_action');
  assert.equal(pending.nextAction.type, 'install_grok_app');
  assert.ok(await readFile(join(pending.skill.paths[0], 'SKILL.md'), 'utf8'));
});

test('legacy login requires explicit authorization without accessing the real keychain', async t => {
  const { data, env, args } = await environment(t);
  env.GROK_BOT_GATEWAY_URL = ''; env.GROK_BOT_GATEWAY_TOKEN = '';
  await writeFile(join(data, 'sand-secrets.json'), JSON.stringify({ 'cursor-accounts': '{}' }));
  const result = await execute(process.execPath, args, { env });
  assert.equal(result.code, 1);
  const pending = JSON.parse(result.stdout);
  assert.equal(pending.error.code, 'AUTHORIZATION_REQUIRED');
  assert.equal(pending.nextAction.type, 'authorize_app_session');
});
