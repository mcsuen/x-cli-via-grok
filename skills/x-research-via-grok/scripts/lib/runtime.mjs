import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';

export const VERSION = '0.1.0';
export class XgError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
export async function exists(path) { try { await access(path); return true; } catch { return false; } }
export function stateDir(env = process.env) {
  if (env.XG_STATE_DIR) return env.XG_STATE_DIR;
  if (process.platform === 'win32') return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'x-cli-via-grok');
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'x-cli-via-grok');
}
export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new XgError('STATE_INVALID', `Cannot read JSON state: ${path}`); }
}
export async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
    await chmod(path, 0o600);
  } finally { await rm(temp, { force: true }); }
}
export function redact(text, env = process.env) {
  let out = String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  for (const name of ['CURSOR_ACCESS_TOKEN', 'GROK_BOT_GATEWAY_TOKEN', 'GROK_BOT_GATEWAY_HEADERS']) {
    if (env[name]) out = out.split(env[name]).join('[redacted]');
  }
  return out.replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:access_token|refresh_token|gatewayToken|authorization)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
}
export async function execute(command, args = [], { env = process.env, timeout = 25000, maxBytes = 4 * 1024 * 1024, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, tooLarge = false, size = 0;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), timeout + 1500);
    for (const [stream, target] of [[child.stdout, 'out'], [child.stderr, 'err']]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > maxBytes) { tooLarge = true; child.kill('SIGKILL'); return; }
        if (target === 'out') stdout += chunk.toString(); else stderr += chunk.toString();
      });
    }
    child.on('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(new XgError('EXEC_FAILED', `Cannot run ${command}: ${error.code || 'failed'}`)); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (timedOut || tooLarge) reject(new XgError(timedOut ? 'COMMAND_TIMEOUT' : 'OUTPUT_LIMIT', timedOut ? 'Command timed out; a mutation may already have been accepted. Do not blindly resend.' : 'Command output exceeded the limit.'));
      else resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
export async function executable(name, env = process.env) {
  if (name.includes('/') || name.includes('\\')) return await exists(name) ? name : null;
  const dirs = [...(env.PATH || '').split(delimiter), join(homedir(), '.local', 'bin')];
  const names = process.platform === 'win32' ? [name, `${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of dirs.filter(Boolean)) for (const item of names) {
    const path = join(dir, item);
    try { await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return path; } catch {}
  }
  return null;
}
export async function withLock(dir, fn) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'operation.lock');
  try { await mkdir(path, { mode: 0o700 }); }
  catch (e) { if (e.code === 'EEXIST') throw new XgError('BUSY', 'Another x-cli-via-grok command owns the local operation lock. Use doctor; recover-lock only after its process has stopped.'); throw e; }
  await saveJson(join(path, 'owner.json'), { pid: process.pid, host: hostname(), createdAt: new Date().toISOString() });
  try { return await fn(); }
  finally { await rm(path, { recursive: true, force: true }); }
}
export async function recoverLock(dir) {
  const path = join(dir, 'operation.lock');
  const owner = await readJson(join(path, 'owner.json'));
  if (!owner || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new XgError('LOCK_UNVERIFIED', 'Cannot prove the lock belongs to a stopped process on this machine.');
  try { process.kill(owner.pid, 0); throw new XgError('PROCESS_RUNNING', 'The lock owner is still running; leave it alone.'); }
  catch (e) { if (e.code !== 'ESRCH') throw e; }
  await rm(path, { recursive: true });
  return { status: 'recovered', note: 'Only the dead process lock was removed. Pending research remains pending.' };
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
