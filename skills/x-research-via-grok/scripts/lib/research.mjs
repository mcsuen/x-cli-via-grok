import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readJson, saveJson, sleep, XgError } from './runtime.mjs';
import { BOT_NAME, BOT_MARKER, BOT_DESCRIPTION, isDedicatedBot, buildPrompt, postLinks } from './prompt.mjs';

export const configPath = dir => join(dir, 'config.json');
export const runPath = (dir, id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) throw new XgError('RUN_ID_INVALID', 'Use the UUID runId returned by query.');
  return join(dir, 'runs', `${id}.json`);
};
export async function loadConfig(dir) { return await readJson(configPath(dir), { version: 1, profiles: {} }); }
export async function ensureBot(client, dir, config, { botId, botName = BOT_NAME } = {}) {
  config.profiles ||= {};
  const profile = config.profiles[client.profileKey] ||= {};
  const bots = await client.listBots();
  let chosen;
  if (botId || profile.botId) {
    chosen = bots.find(b => b.id === (botId || profile.botId));
    if (!chosen) throw new XgError('BOT_NOT_FOUND', 'The selected dedicated bot is not in the current account. Check the active Grok account; this tool will not silently create another bot.');
    if (!isDedicatedBot(chosen)) throw new XgError('BOT_NOT_DEDICATED', 'The selected bot is not explicitly dedicated to Twitter/X research. Leave general-purpose bots unchanged.');
  } else {
    const candidates = bots.filter(isDedicatedBot);
    if (candidates.length > 1) throw new XgError('BOT_AMBIGUOUS', 'Several dedicated research bots exist. Select one with setup --bot-id ID.', { candidates: candidates.map(({ id, name }) => ({ id, name })) });
    chosen = candidates[0];
    if (!chosen && profile.pendingCreation) throw new XgError('BOT_CREATION_UNKNOWN', 'A previous creation has an uncertain outcome. Inspect the Grok bot list and select the resulting research bot with setup --bot-id ID; do not create duplicates.');
    if (!chosen) {
      const creationId = randomUUID();
      profile.pendingCreation = { id: creationId, createdAt: new Date().toISOString() };
      await saveJson(configPath(dir), config);
      chosen = await client.call(['bots', 'create', '--name', botName, '--description', `${BOT_DESCRIPTION}\n[creation=${creationId}]`]);
      if (!chosen?.id || !isDedicatedBot(chosen)) throw new XgError('BOT_CREATION_UNKNOWN', 'The creation reply does not identify a dedicated bot. Inspect the bot list before retrying.');
    }
  }
  profile.botId = chosen.id;
  profile.botName = chosen.name;
  delete profile.pendingCreation;
  await saveJson(configPath(dir), config);
  return { id: chosen.id, name: chosen.name };
}
export function sessionId(input, env = process.env) {
  if (input) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input)) throw new XgError('SESSION_ID_INVALID', 'Session names must be 1–80 letters, numbers, dots, underscores or hyphens.');
    return input;
  }
  const origin = env.CODEX_THREAD_ID || env.CLAUDE_SESSION_ID || randomUUID();
  return `s-${createHash('sha256').update(origin).digest('hex').slice(0, 20)}`;
}
function entryText(entry) { return typeof entry?.message?.content === 'string' ? entry.message.content : typeof entry?.content === 'string' ? entry.content : ''; }
function entriesOf(data, botId) {
  if (data?.target?.id !== botId) throw new XgError('TARGET_MISMATCH', 'The CLI returned a different bot. Refusing to read or route its content.');
  const entries = (data.transcript || data.thread)?.entries;
  if (!Array.isArray(entries)) throw new XgError('TRANSCRIPT_SCHEMA_CHANGED', 'Unexpected transcript schema. No unscoped transcript will be returned.');
  return entries;
}
export function correlateEntries(entries, run) {
  const roots = entries.filter(e => e.kind === 'message' && e.role === 'user' && entryText(e).includes(`[X Research | session=${run.sessionId} | run=${run.id}]`));
  if (roots.length > 1) throw new XgError('DUPLICATE_SUBMISSION', 'This request marker appears in multiple user messages. Inspect the bot before continuing.');
  if (!run.rootId && roots.length === 1) {
    if (typeof roots[0].requestId !== 'string' || !roots[0].requestId) throw new XgError('REQUEST_ID_MISSING', 'Cannot prove reply ownership without the gateway requestId.');
    run.rootId = roots[0].id;
    run.requestId = roots[0].requestId;
  }
  if (!run.requestId) return [];
  return entries.filter(e => e.requestId === run.requestId && e.role !== 'user' && (e.kind === 'send-message' || e.kind === 'message') && entryText(e));
}
export function resultOf(run) {
  return {
    status: run.status, runId: run.id, sessionId: run.sessionId, bot: run.bot,
    rootId: run.rootId || null, requestId: run.requestId || null,
    window: run.window, answer: run.answer || null, progress: run.messages || [],
    postLinks: run.answer ? postLinks(run.answer, run.window) : run.postLinks || [], delivery: run.delivery || null,
    isolation: { resultRouting: 'gateway-request-id', execution: 'one-active-local-run-per-account', serverMemory: 'shared-dedicated-bot' },
    next: run.status === 'complete' ? null : `x-cli-via-grok read ${run.id} --wait 40 --json`
  };
}
export async function beginResearch(client, dir, config, { goal, session, window, language, botId } = {}) {
  const profile = config.profiles?.[client.profileKey] || {};
  if (profile.activeRun) throw new XgError('RESEARCH_BUSY', 'A research request is still pending on the dedicated bot. Read that request before starting another; no extra bot will be created.', { runId: profile.activeRun });
  const id = randomUUID();
  const sid = sessionId(session);
  // Validate and render before any bot mutation or send.
  const prompt = buildPrompt({ goal, sessionId: sid, runId: id, window, language });
  const bot = await ensureBot(client, dir, config, { botId });
  const run = { version: 1, id, sessionId: sid, profileKey: client.profileKey, bot, goal, prompt, window, status: 'submitting', createdAt: new Date().toISOString(), messages: [] };
  await saveJson(runPath(dir, id), run);
  config.profiles[client.profileKey].activeRun = id;
  await saveJson(configPath(dir), config);
  try {
    const receipt = await client.call(['send', bot.id, prompt, '--reply-mode', 'manual', '--correlation-id', id, '--envelope', '--no-history']);
    if (receipt.id !== bot.id) throw new XgError('TARGET_MISMATCH', 'Send receipt identifies a different bot.');
    run.delivery = receipt.delivery || 'unknown';
    run.status = 'pending';
  } catch (e) {
    // Unknown is not rejection. Keep the durable run and never retry the send automatically.
    run.status = e.code === 'AUTH_REQUIRED' ? 'rejected' : 'delivery_unknown';
    run.error = { code: e.code || 'SEND_FAILED', message: e.message };
    if (run.status === 'rejected') {
      delete config.profiles[client.profileKey].activeRun;
      await saveJson(configPath(dir), config);
    }
    await saveJson(runPath(dir, id), run);
    throw new XgError(e.code || 'SEND_FAILED', e.message, { runId: id, delivery: run.status, next: `read ${id}` });
  }
  await saveJson(runPath(dir, id), run);
  return run;
}
export async function pollResearch(client, dir, config, run, { wait = 0 } = {}) {
  if (run.profileKey !== client.profileKey) throw new XgError('ACCOUNT_CHANGED', 'Switch back to the Grok account that owns this request before reading it.');
  if (run.status === 'complete' || run.status === 'released' || run.status === 'rejected') return resultOf(run);
  if (!Number.isFinite(wait) || wait < 0 || wait > 50) throw new XgError('WAIT_INVALID', 'wait must be between 0 and 50 seconds.');
  const deadline = Date.now() + wait * 1000;
  let interval = 2000;
  do {
    let entries, matched, tailLength = 0;
    try {
      const timeout = () => wait === 0 ? 25000 : Math.min(25000, Math.max(1000, deadline - Date.now()));
      const rooted = Boolean(run.rootId);
      const data = await client.call(['thread', run.bot.id, ...(rooted ? ['--root', run.rootId] : ['--limit', '200']), '--no-history'], { timeout: timeout() });
      entries = entriesOf(data, run.bot.id);
      tailLength = rooted ? 0 : entries.length;
      matched = correlateEntries(entries, run);
      // Observed upstream behavior: a rooted read can contain only the user root,
      // while send-message replies appear exclusively in the transcript tail.
      // Merge those bounded sources, but keep exact requestId ownership mandatory.
      const done = e => entryText(e).split(/\r?\n/).some(line => line.trim() === `XG_DONE ${run.id}`);
      if (rooted && !matched.some(done)) {
        const tail = entriesOf(await client.call(['thread', run.bot.id, '--limit', '200', '--no-history'], { timeout: timeout() }), run.bot.id);
        tailLength = tail.length;
        entries = [...new Map([...entries, ...tail].map(e => [e.id, e])).values()];
        matched = correlateEntries(entries, run);
      }
    } catch (e) {
      if (e.code === 'COMMAND_TIMEOUT' && wait > 0 && Date.now() >= deadline) break;
      throw e;
    }
    if ((!run.rootId || !matched.length) && tailLength >= 200) throw new XgError('TRANSCRIPT_COVERAGE_GAP', 'The request is outside the bounded transcript coverage. No other session content will be returned. Inspect the dedicated bot; do not resend.');
    run.messages = matched.map(e => ({ id: e.id, text: entryText(e), timestampMs: e.timestampMs || null }));
    const marker = `XG_DONE ${run.id}`;
    const completed = matched.filter(e => entryText(e).split(/\r?\n/).some(line => line.trim() === marker));
    if (completed.length) {
      run.answer = entryText(completed.at(-1)).split(/\r?\n/).filter(line => line.trim() !== marker).join('\n').trim();
      run.postLinks = postLinks(run.answer, run.window);
      run.status = 'complete';
      run.messages = run.messages.filter(e => !e.text.split(/\r?\n/).some(line => line.trim() === marker));
      run.completedAt = new Date().toISOString();
      if (config.profiles?.[client.profileKey]?.activeRun === run.id) {
        delete config.profiles[client.profileKey].activeRun;
        await saveJson(configPath(dir), config);
      }
    }
    await saveJson(runPath(dir, run.id), run);
    if (run.status === 'complete' || Date.now() >= deadline) break;
    await sleep(Math.min(interval, deadline - Date.now()));
    interval = Math.min(interval * 2, 15000);
  } while (Date.now() < deadline);
  return resultOf(run);
}
export async function releaseResearch(dir, config, id, confirmed) {
  if (!confirmed) throw new XgError('CONFIRM_FINISHED_REQUIRED', 'First verify in Grok that the request has finished. release --confirmed-finished only releases local bookkeeping; it does not cancel Grok work.');
  const run = await readJson(runPath(dir, id));
  if (!run) throw new XgError('RUN_NOT_FOUND', 'Unknown local request.');
  const profile = config.profiles?.[run.profileKey];
  if (profile?.activeRun === id) delete profile.activeRun;
  if (run.status !== 'complete') run.status = 'released';
  await saveJson(runPath(dir, id), run);
  await saveJson(configPath(dir), config);
  return { status: run.status, runId: id, note: 'Local bookkeeping released. This did not cancel, delete, or reset the Grok bot.' };
}
