import { readFile, readdir, lstat, mkdir, cp, rename, rm } from 'node:fs/promises';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { XgError, VERSION, saveJson, readJson, redact } from './runtime.mjs';

const RECEIPT = '.x-cli-via-grok.json';
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
async function present(path) {
  try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
async function fingerprints(root) {
  const files = {};
  async function visit(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new XgError('SKILL_UNSAFE', 'Skill installation requires regular files and directories. Review symbolic links or special files manually.');
    if (info.isDirectory()) {
      if (path !== root) files[`${relative(root, path).split(sep).join('/')}/`] = 'directory';
      for (const name of (await readdir(path)).sort()) {
        if (path === root && name === RECEIPT) continue;
        await visit(join(path, name));
      }
    } else files[relative(root, path).split(sep).join('/')] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  await visit(root);
  return files;
}
const sameFiles = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function skillDestinations({ host, dir, home = homedir() }) {
  if (!['codex', 'claude', 'both'].includes(host) || (dir && host === 'both')) throw new XgError('HOST_REQUIRED', 'Use --host codex, claude or both. A custom --dir accepts one host only.');
  return (host === 'both' ? ['codex', 'claude'] : [host]).map(target => join(dir ? resolve(dir) : join(home, target === 'codex' ? '.agents' : '.claude', 'skills'), 'x-research-via-grok'));
}

export async function installSkill(options, { source = SOURCE } = {}) {
  const destinations = skillDestinations(options);
  const files = await fingerprints(source);
  const changes = [];
  // Check every target before changing any installation.
  for (const destination of destinations) {
    const installed = await present(destination);
    const current = installed ? await fingerprints(destination) : null;
    const receiptPath = join(destination, RECEIPT);
    if (installed && await present(receiptPath) && !(await lstat(receiptPath)).isFile()) throw new XgError('SKILL_UNSAFE', 'The installation receipt must be a regular file.');
    if (current && !sameFiles(current, files)) {
      const receipt = await readJson(receiptPath);
      if (receipt?.package !== 'x-cli-via-grok' || receipt.schema !== 1 || !sameFiles(current, receipt.files)) throw new XgError('SKILL_EXISTS', `A custom or unmanaged skill exists at ${destination}. Preserve and review it before replacing it.`, { destination });
    }
    changes.push({ destination, current, changed: !current || !sameFiles(current, files) });
  }
  for (const { destination, current, changed } of changes) {
    if (!changed) {
      await saveJson(join(destination, RECEIPT), { schema: 1, package: 'x-cli-via-grok', version: VERSION, files });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    const stage = `${destination}.${randomUUID()}.stage`, backup = `${destination}.${randomUUID()}.backup`;
    let moved = false;
    try {
      await cp(source, stage, { recursive: true, force: false, errorOnExist: true, filter: path => path !== join(source, RECEIPT) });
      await saveJson(join(stage, RECEIPT), { schema: 1, package: 'x-cli-via-grok', version: VERSION, files });
      if (current) {
        if (!sameFiles(current, await fingerprints(destination))) throw new XgError('SKILL_CHANGED', 'The installed skill changed during installation. Retry after local edits have finished.');
        await rename(destination, backup); moved = true;
      } else if (await present(destination)) throw new XgError('SKILL_CHANGED', 'Another installation appeared at the destination. Review it before retrying.');
      await rename(stage, destination);
      if (moved) { await rm(backup, { recursive: true }); moved = false; }
    } finally {
      await rm(stage, { recursive: true, force: true });
      if (moved && !await present(destination)) await rename(backup, destination);
    }
  }
  return {
    status: 'installed', paths: destinations,
    runtimes: destinations.map(path => join(path, 'scripts', 'xg.mjs')),
    note: 'The self-contained skill is installed. Reload skills or reopen the host session if it is not discovered. Automatic selection remains controlled by the host.'
  };
}

function nextAction(error) {
  const actions = {
    GROK_APP_REQUIRED: ['install_grok_app', 'Install Grok Bot from https://cursor.com/sand, open it, and sign in; then rerun install.'],
    AUTH_REQUIRED: ['sign_in', 'Open Grok Bot and sign in to the intended account, then rerun install.'],
    AUTHORIZATION_REQUIRED: ['authorize_app_session', 'Notify the user about existing-login and Keychain access. Within their authorization, rerun install with --authorize-app-session; the user handles OS prompts.'],
    KEYCHAIN_REQUIRED: ['approve_keychain', 'The user must handle the macOS Keychain prompt, then rerun install.'],
    BOT_AMBIGUOUS: ['select_bot', 'Ask the user to choose one eligible dedicated bot, then rerun install with --bot-id ID.'],
    BOT_NOT_FOUND: ['check_account', 'Verify the active Grok account and selected dedicated bot before rerunning install.'],
    BOT_NOT_DEDICATED: ['select_bot', 'Select an existing bot dedicated to public X research; preserve general-purpose bots.'],
    BOT_CREATION_UNKNOWN: ['reconcile_bot', 'Inspect the live bot roster before another creation; select the resulting dedicated bot with --bot-id ID.'],
    SKILL_EXISTS: ['review_skill', 'Preserve and review the existing custom or unmanaged skill before replacing it, then rerun install.'],
    SKILL_UNSAFE: ['review_skill', 'Review symbolic links or special files in the destination before installing.'],
    CLI_VERSION_UNSUPPORTED: ['select_cli', 'Remove an obsolete explicit XG_GROK_CLI override or select a supported CLI, then rerun install.']
  };
  const action = actions[error.code];
  return action ? { type: action[0], instruction: action[1] } : null;
}

export async function installCapability(options, { install = installSkill, prepare }) {
  let skill, stage = 'skill';
  try {
    skill = await install(options);
    stage = 'initialization';
    const research = await prepare();
    return { status: 'ready', skill, research, note: 'Installation and initialization are complete. No research query was submitted.' };
  } catch (error) {
    const action = nextAction(error);
    if (!action) throw error;
    return {
      status: 'needs_user_action', stage, skill: skill || null,
      error: { code: error.code, message: redact(error.message), ...(error.details || {}) }, nextAction: action,
      note: 'Initialization is incomplete. Keep the installed files and rerun the same install command after the required action.'
    };
  }
}
