import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dateWindow, BOT_DESCRIPTION, isDedicatedBot, buildPrompt, postLinks } from '../skills/x-research-via-grok/scripts/lib/prompt.mjs';
import { ensureBot, loadConfig, beginResearch, pollResearch, correlateEntries, runPath } from '../skills/x-research-via-grok/scripts/lib/research.mjs';
import { withLock, redact, execute } from '../skills/x-research-via-grok/scripts/lib/runtime.mjs';
import { parseArgs, installSkill } from '../skills/x-research-via-grok/scripts/xg.mjs';
import { nodeCompatible } from '../skills/x-research-via-grok/scripts/lib/environment.mjs';

const window = () => dateWindow({ since: '2024-08-25', until: '2024-11-02', timezone: 'UTC', now: new Date('2024-11-02T13:00:00Z') });
const syntheticPostId = timestamp => ((BigInt(Date.parse(timestamp)) - 1288834974657n) << 22n).toString();
const examplePostId = syntheticPostId('2024-10-01T12:00:00Z');
const examplePostUrl = `https://x.com/ExampleOrg/status/${examplePostId}`;
const temp = async t => { const dir = await mkdtemp(join(tmpdir(), 'xg-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
class FakeClient {
  profileKey = 'account-a'; bots = []; calls = []; entries = []; sends = 0; rootOnly = false;
  async listBots() { return structuredClone(this.bots); }
  async call(args) {
    this.calls.push(args);
    if (args[0] === 'bots' && args[1] === 'create') {
      const bot = { id: 'dedicated', name: args[args.indexOf('--name') + 1], description: args[args.indexOf('--description') + 1], kind: 'bot' };
      this.bots.push(bot); return structuredClone(bot);
    }
    if (args[0] === 'send') {
      this.sends++;
      this.entries.push({ id: 'root-a', kind: 'message', role: 'user', content: args[2], requestId: 'request-a' });
      return { id: args[1], delivery: 'unknown', result: { accepted: true } };
    }
    if (args[0] === 'thread') return { target: { id: args[1] }, [args.includes('--root') ? 'thread' : 'transcript']: { entries: structuredClone(args.includes('--root') && this.rootOnly ? this.entries.filter(e => e.role === 'user') : this.entries) } };
    throw new Error('Unexpected fake call');
  }
}
test('date windows preserve partial months and the user timezone', () => {
  assert.deepEqual(window().slices, [{ since: '2024-08-25', until: '2024-08-31' }, { since: '2024-09-01', until: '2024-09-30' }, { since: '2024-10-01', until: '2024-10-31' }, { since: '2024-11-01', until: '2024-11-02' }]);
  assert.equal(dateWindow({ now: new Date('2024-11-02T17:00:00Z'), timezone: 'Asia/Tokyo' }).until, '2024-11-03');
  assert.throws(() => dateWindow({ until: 'banana' }), { code: 'DATE_RANGE_INVALID' });
  assert.throws(() => dateWindow({ since: '2024-02-30' }), { code: 'DATE_RANGE_INVALID' });
  assert.throws(() => dateWindow({ until: '2099-01-01' }), { code: 'DATE_RANGE_INVALID' });
});
test('a general bot is preserved and only one dedicated bot is created and reused', async t => {
  const dir = await temp(t), client = new FakeClient(), config = await loadConfig(dir);
  client.bots = [{ id: 'personal', name: 'Grok Bot', description: 'My assistant', kind: 'bot' }];
  const first = await ensureBot(client, dir, config);
  const second = await ensureBot(client, dir, await loadConfig(dir));
  assert.equal(first.id, second.id);
  assert.equal(client.calls.filter(a => a[1] === 'create').length, 1);
  assert.deepEqual(client.bots[0], { id: 'personal', name: 'Grok Bot', description: 'My assistant', kind: 'bot' });
});
test('pre-existing purpose-specific bots are adopted; ambiguous choices do not create extras', async t => {
  const dir = await temp(t), client = new FakeClient();
  client.bots = [{ id: 'research', name: 'Twitter Research', description: 'Public Twitter search and analysis', kind: 'bot' }];
  assert.equal((await ensureBot(client, dir, await loadConfig(dir))).id, 'research');
  client.bots.push({ id: 'research-2', name: 'Other', description: BOT_DESCRIPTION });
  await assert.rejects(ensureBot(client, dir, { profiles: {} }), { code: 'BOT_AMBIGUOUS' });
  assert.equal(client.calls.length, 0);
});
test('an uncertain creation is not automatically retried', async t => {
  const dir = await temp(t), client = new FakeClient(), config = { profiles: { 'account-a': { pendingCreation: { id: 'uncertain' } } } };
  await assert.rejects(ensureBot(client, dir, config), { code: 'BOT_CREATION_UNKNOWN' });
  assert.equal(client.calls.length, 0);
});
test('missing or repurposed pinned bots fail closed', async t => {
  const dir = await temp(t), client = new FakeClient();
  const config = { profiles: { 'account-a': { botId: 'general' } } };
  await assert.rejects(ensureBot(client, dir, config), { code: 'BOT_NOT_FOUND' });
  client.bots = [{ id: 'general', name: 'Grok Bot', description: 'Everything' }];
  await assert.rejects(ensureBot(client, dir, config), { code: 'BOT_NOT_DEDICATED' });
  assert.equal(client.calls.length, 0);
});
test('only gateway request-owned replies are returned; stale and other-session replies are excluded', async t => {
  const dir = await temp(t), client = new FakeClient(), config = await loadConfig(dir);
  const run = await beginResearch(client, dir, config, { goal: 'Research Example Topic\nPreserve this newline and literal $() text', session: 'chat-one', window: window() });
  assert.match(client.calls.find(a => a[0] === 'send')[2], /Example Topic\nPreserve this newline and literal \$\(\)/);
  client.entries.push(
    { id: 'old', kind: 'send-message', requestId: 'old-request', message: { content: `PRIVATE OLD RESULT\nXG_DONE ${run.id}` } },
    { id: 'other', kind: 'send-message', requestId: 'other-request', message: { content: 'OTHER SESSION' } },
    { id: 'ack', kind: 'send-message', requestId: 'request-a', message: { content: 'Searching...' } }
  );
  const pending = await pollResearch(client, dir, config, run);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.progress.length, 1);
  await assert.rejects(beginResearch(client, dir, config, { goal: 'new', window: window() }), { code: 'RESEARCH_BUSY' });
  client.entries.push({ id: 'final', kind: 'send-message', requestId: 'request-a', message: { content: `Found one ${examplePostUrl}\nXG_DONE ${run.id}` } });
  const complete = await pollResearch(client, dir, config, run);
  assert.equal(complete.status, 'complete');
  assert.equal(complete.postLinks.length, 1);
  assert.doesNotMatch(JSON.stringify(complete), /PRIVATE OLD|OTHER SESSION/);
  assert.equal(client.sends, 1);
  assert.equal(config.profiles['account-a'].activeRun, undefined);
  assert.ok(client.calls.some(a => a.includes('--root')));
});
test('rooted reads that omit assistant messages are merged with a request-filtered tail', async t => {
  const dir = await temp(t), client = new FakeClient(), config = await loadConfig(dir);
  client.rootOnly = true;
  const run = await beginResearch(client, dir, config, { goal: 'one query', window: window() });
  await pollResearch(client, dir, config, run);
  client.entries.push({ id: 'foreign', kind: 'send-message', requestId: 'unrelated', message: { content: 'FOREIGN' } });
  client.entries.push({ id: 'done', kind: 'send-message', requestId: 'request-a', message: { content: `Only my result\nXG_DONE ${run.id}` } });
  const result = await pollResearch(client, dir, config, run);
  assert.equal(result.status, 'complete');
  assert.equal(result.answer, 'Only my result');
  assert.doesNotMatch(JSON.stringify(result), /FOREIGN/);
});
test('account switching prevents reading results through a different login', async t => {
  const dir = await temp(t), client = new FakeClient(), config = await loadConfig(dir);
  const run = await beginResearch(client, dir, config, { goal: 'public query', window: window() });
  client.profileKey = 'account-b';
  await assert.rejects(pollResearch(client, dir, config, run), { code: 'ACCOUNT_CHANGED' });
});
test('a lost send acknowledgement leaves a durable request and is never resent', async t => {
  const dir = await temp(t), client = new FakeClient(), config = await loadConfig(dir);
  const original = client.call.bind(client);
  client.call = async args => { if (args[0] === 'send') { client.sends++; throw Object.assign(new Error('network lost'), { code: 'COMMAND_TIMEOUT' }); } return original(args); };
  let id;
  try { await beginResearch(client, dir, config, { goal: 'public query', window: window() }); } catch (e) { id = e.details.runId; }
  assert.ok(id);
  assert.equal(JSON.parse(await readFile(runPath(dir, id), 'utf8')).status, 'delivery_unknown');
  await assert.rejects(beginResearch(client, dir, config, { goal: 'another query', window: window() }), { code: 'RESEARCH_BUSY' });
  assert.equal(client.sends, 1);
});
test('cannot correlate without a real gateway request ID or with duplicated submissions', () => {
  const run = { sessionId: 'one', id: 'run' };
  const root = { kind: 'message', role: 'user', id: 'r', content: '[X Research | session=one | run=run]' };
  assert.throws(() => correlateEntries([root], run), { code: 'REQUEST_ID_MISSING' });
  assert.throws(() => correlateEntries([root, root], run), { code: 'DUPLICATE_SUBMISSION' });
});
test('local operation locks prevent concurrent creation and release on error', async t => {
  const dir = await temp(t);
  await withLock(dir, async () => { await assert.rejects(withLock(dir, () => {}), { code: 'BUSY' }); });
  await assert.rejects(withLock(dir, () => { throw new Error('test error'); }));
  await withLock(dir, async () => {});
});
test('query strings are passed without a shell, and credentials are redacted', async () => {
  const literal = 'text\n$(echo SHOULD_NOT_RUN) `id` "quoted"';
  const r = await execute(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal]);
  assert.equal(r.stdout, literal);
  assert.equal(redact('Bearer secret; token=other my-secret', { CURSOR_ACCESS_TOKEN: 'my-secret' }).includes('my-secret'), false);
});
test('the skill installs independently with its executable runtime included', async t => {
  const dir = await temp(t);
  const result = await installSkill({ host: 'codex', dir });
  assert.ok((await readFile(join(result.paths[0], 'SKILL.md'), 'utf8')).includes('x-research-via-grok'));
  const help = await execute(process.execPath, [join(result.paths[0], 'scripts', 'xg.mjs'), '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /public Twitter\/X research/);
  await installSkill({ host: 'codex', dir });
  await appendFile(join(result.paths[0], 'SKILL.md'), '\nUser custom instructions\n');
  await assert.rejects(installSkill({ host: 'codex', dir }), { code: 'SKILL_EXISTS' });
});
test('CLI parsing rejects irrelevant capabilities and unsafe paths', () => {
  assert.throws(() => parseArgs(['send', '--target', 'personal']), { code: 'COMMAND_INVALID' });
  assert.throws(() => parseArgs(['query', '--delete']), { code: 'OPTION_INVALID' });
  assert.throws(() => runPath('/tmp', '../other'), { code: 'RUN_ID_INVALID' });
  assert.equal(isDedicatedBot({ name: 'Grok Bot', description: 'General assistant' }), false);
  assert.equal(nodeCompatible('22.18.0'), false);
  assert.equal(nodeCompatible('22.19.0'), true);
  assert.equal(nodeCompatible('24.0.0'), true);
});
test('post ID dates are diagnostic, URLs are deduplicated, and completion prompts are readable', () => {
  const links = postLinks(`https://twitter.com/ExampleOrg/status/${examplePostId} ${examplePostUrl}`, window());
  assert.equal(links.length, 1); assert.equal(links[0].dateUtc, '2024-10-01');
  const prompt = buildPrompt({ goal: 'Research objective\nAdditional context', sessionId: 'one', runId: 'two', window: window() });
  assert.match(prompt, /Research objective\nAdditional context/);
  assert.match(prompt, /2024-08-25 to 2024-08-31/);
  assert.throws(() => buildPrompt({ goal: ' ', sessionId: 'one', runId: 'two', window: window() }), { code: 'PROMPT_INVALID' });
});
test('post dates are checked in the user timezone rather than against UTC calendar dates', () => {
  const range = dateWindow({ since: '2024-11-02', until: '2024-11-03', timezone: 'Asia/Tokyo', now: new Date('2024-11-03T14:00:00Z') });
  const [post] = postLinks(`https://x.com/ExampleOrg/status/${syntheticPostId('2024-11-01T18:00:00Z')}`, range);
  assert.equal(post.dateUtc, '2024-11-01');
  assert.equal(post.dateInUserTimezone, '2024-11-02');
  assert.equal(post.withinDateWindow, true);
});
