import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { createHash, pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { exists, executable, execute, readJson, XgError, redact } from './runtime.mjs';

export const GROK_CLI_VERSION = '0.12.4';
export const APP_INSTALL_URL = 'https://cursor.com/sand';
export function nodeCompatible(version = process.versions.node) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}
export async function findCompatibleNode() {
  if (nodeCompatible()) return process.execPath;
  const roots = [join(homedir(), '.nvm', 'versions', 'node'), join(homedir(), '.local', 'share', 'fnm', 'node-versions')];
  for (const root of roots) {
    let names = [];
    try { names = await readdir(root); } catch {}
    names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of names.filter(nodeCompatible)) {
      for (const candidate of [join(root, name, 'bin', 'node'), join(root, name, 'installation', 'bin', 'node')]) if (await exists(candidate)) return candidate;
    }
  }
  throw new XgError('NODE_REQUIRED', 'Node.js 22.19.0+ is required. Install a supported Node.js runtime; x-cli-via-grok does not change your Node installation.');
}
export function appDataDir(env = process.env) {
  if (env.XG_GROK_APP_DATA) return resolve(env.XG_GROK_APP_DATA);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Grok Bot');
  if (process.platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Grok Bot');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Grok Bot');
}
export async function detectApp(env = process.env) {
  const candidates = env.XG_GROK_APP_PATH ? [resolve(env.XG_GROK_APP_PATH)] : process.platform === 'darwin' ? [
    '/Applications/Grok Bot.app', join(homedir(), 'Applications', 'Grok Bot.app')
  ] : process.platform === 'win32' ? [
    join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Grok Bot', 'Grok Bot.exe'),
    join(env.ProgramFiles || 'C:\\Program Files', 'Grok Bot', 'Grok Bot.exe')
  ] : [
    '/opt/Grok Bot/grok-bot', '/opt/grok-bot/grok-bot', '/usr/bin/grok-bot-app',
    join(homedir(), 'Applications', 'Grok Bot.AppImage')
  ];
  const path = (await Promise.all(candidates.map(async p => await exists(p) ? p : null))).find(Boolean);
  let version = env.XG_GROK_CLIENT_VERSION || null;
  if (path && process.platform === 'darwin' && !version) {
    const r = await execute('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(path, 'Contents', 'Info.plist')]);
    if (r.code === 0 && /^\d+\.\d+\.\d+/.test(r.stdout.trim())) version = r.stdout.trim();
  }
  return { installed: Boolean(path), path: path || null, version, installUrl: APP_INSTALL_URL, dataPresent: await exists(appDataDir(env)) };
}
async function commandSpec(path) {
  // Windows .cmd shims cannot be executed safely with shell:false; locate their Node entrypoint instead.
  if (path.endsWith('.cmd')) {
    const script = join(dirname(path), 'node_modules', 'grok-bot-cli', 'dist', 'bin', 'gbot.mjs');
    if (!await exists(script)) throw new XgError('CLI_SHIM_UNSUPPORTED', 'Cannot locate the grok-bot-cli Node entrypoint beside the Windows shim. Use setup to install a private copy.');
    return { command: process.execPath, prefix: [script], path: script };
  }
  if (/\.(?:mjs|cjs|js)$/.test(path)) return { command: process.execPath, prefix: [path], path };
  return { command: path, prefix: [], path };
}
export async function findGrokCli(dir, env = process.env) {
  if (env.XG_GROK_CLI) {
    const path = await executable(env.XG_GROK_CLI, env);
    if (!path) throw new XgError('CLI_NOT_FOUND', 'XG_GROK_CLI does not point to an executable.');
    return commandSpec(path);
  }
  const privateEntry = join(dir, 'runtime', 'node_modules', 'grok-bot-cli', 'dist', 'bin', 'gbot.mjs');
  if (await exists(privateEntry)) return commandSpec(privateEntry);
  for (const name of ['grok-bot', 'gbot']) { const path = await executable(name, env); if (path) return commandSpec(path); }
  return null;
}
async function npmSpec(env) {
  for (const path of [join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
    if (await exists(path)) return { command: process.execPath, prefix: [path] };
  }
  const path = await executable('npm', env);
  if (path && !path.endsWith('.cmd')) return { command: path, prefix: [] };
  throw new XgError('NPM_REQUIRED', 'npm is required to install grok-bot-cli. Install Node.js with npm, then rerun setup.');
}
export async function installGrokCli(dir, env = process.env) {
  const npm = await npmSpec(env);
  process.stderr.write(`Installing grok-bot-cli@${GROK_CLI_VERSION} from the npm registry into the private tool directory.\n`);
  const result = await execute(npm.command, [...npm.prefix, 'install', '--prefix', join(dir, 'runtime'), '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `grok-bot-cli@${GROK_CLI_VERSION}`], { env, timeout: 180000 });
  if (result.code !== 0) throw new XgError('CLI_INSTALL_FAILED', redact(result.stderr || result.stdout, env).slice(0, 2000));
  return findGrokCli(dir, env);
}
export async function inspectEnvironment(dir, config = {}, env = process.env) {
  const app = await detectApp(env);
  const cli = await findGrokCli(dir, env);
  const descriptor = await exists(join(appDataDir(env), 'gateway-descriptor.json'));
  const secrets = await readJson(join(appDataDir(env), 'sand-secrets.json'), {});
  return {
    node: { version: process.versions.node, supported: nodeCompatible() }, app,
    cli: { installed: Boolean(cli), path: cli?.path || null, pinnedVersion: GROK_CLI_VERSION },
    authentication: {
      source: env.GROK_BOT_GATEWAY_URL && env.GROK_BOT_GATEWAY_TOKEN ? 'gateway-environment' : env.CURSOR_ACCESS_TOKEN ? 'access-token-environment' : descriptor ? 'native-app-session' : secrets['cursor-accounts'] ? 'legacy-app-session' : 'none',
      verified: false, legacySessionAuthorized: config.legacySessionAuthorized === true,
      notice: 'Saved files do not prove a valid login. Online verification may show an OS keychain prompt; the user must handle login and permission dialogs.'
    }
  };
}
async function legacyToken(dataDir) {
  if (process.platform !== 'darwin') throw new XgError('AUTH_ADAPTER_UNSUPPORTED', 'The legacy encrypted-session adapter supports macOS only. Update Grok Bot or use a supported native CLI session.');
  const secrets = await readJson(join(dataDir, 'sand-secrets.json'));
  let store;
  try { store = JSON.parse(secrets['cursor-accounts']); } catch { throw new XgError('AUTH_REQUIRED', 'Open Grok Bot and sign in, then retry setup.'); }
  const value = store.accounts?.[store.active]?.['cursor-access-token'];
  if (typeof value !== 'string') throw new XgError('AUTH_REQUIRED', 'The active app account has no saved access token. Sign in to Grok Bot.');
  const encrypted = Buffer.from(value, 'base64');
  if (encrypted.subarray(0, 3).toString() !== 'v10') throw new XgError('AUTH_FORMAT_UNSUPPORTED', 'The app session format changed. Update grok-bot-cli; do not guess how to decrypt credentials.');
  process.stderr.write('Authorization notice: using the existing Grok Bot login and macOS Keychain in memory. Handle any OS prompt yourself. No credentials are saved by this tool.\n');
  const keyResult = await execute('/usr/bin/security', ['find-generic-password', '-w', '-s', 'Grok Bot Safe Storage'], { timeout: 10000, maxBytes: 32768 });
  if (keyResult.code !== 0) throw new XgError('KEYCHAIN_REQUIRED', 'Approve access in the macOS keychain dialog yourself, or open/sign in to Grok Bot and retry.');
  const key = pbkdf2Sync(keyResult.stdout.trimEnd(), 'saltysalt', 1003, 16, 'sha1');
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
    return { token: Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString('utf8'), account: String(store.active) };
  } catch { throw new XgError('AUTH_DECRYPT_FAILED', 'Cannot read the saved app login. Reopen Grok Bot and sign in; do not alter keychain security settings.'); }
}
export class GrokClient {
  constructor(spec, env, profileKey) { this.spec = spec; this.env = env; this.profileKey = profileKey; }
  async call(args, { timeout = 25000 } = {}) {
    let result;
    try { result = await execute(this.spec.command, [...this.spec.prefix, ...args, '--json'], { env: this.env, timeout }); }
    catch (e) { throw new XgError(e.code || 'GROK_FAILED', redact(e.message, this.env)); }
    let data;
    try { data = JSON.parse(result.stdout.trim()); }
    catch { throw new XgError('GROK_RESPONSE_INVALID', redact(result.stderr || result.stdout || 'Grok CLI returned no JSON.', this.env).slice(0, 2000)); }
    if (result.code !== 0 || data?.error || data?.exitCode > 0) {
      const message = typeof data?.error === 'string' ? data.error : data?.error?.message || result.stderr || 'Grok CLI failed.';
      throw new XgError(/401|sign.?in|auth|session|credential/i.test(message) ? 'AUTH_REQUIRED' : 'GROK_FAILED', redact(message, this.env).slice(0, 2000));
    }
    return data;
  }
  async listBots() {
    const data = await this.call(['bots', 'list']);
    if (!Array.isArray(data) || data.some(b => typeof b?.id !== 'string')) throw new XgError('ROSTER_INVALID', 'Unexpected bot-list schema. Update this adapter before creating or routing bots.');
    return data;
  }
}
export async function connect(dir, config = {}, { install = false, authorize = false, env = process.env } = {}) {
  const status = await inspectEnvironment(dir, config, env);
  if (!status.app.installed) throw new XgError('GROK_APP_REQUIRED', `Install the Grok Bot desktop app from ${APP_INSTALL_URL}, open it and sign in. For a non-standard path set XG_GROK_APP_PATH. The grok.com web app is not sufficient.`, { app: status.app });
  const childEnv = { ...env, PATH: `${dirname(process.execPath)}${delimiter}${env.PATH || ''}` };
  if (!childEnv.SAND_CLIENT_VERSION && status.app.version) childEnv.SAND_CLIENT_VERSION = status.app.version;
  let spec = await findGrokCli(dir, childEnv);
  if (!spec && install) spec = await installGrokCli(dir, childEnv);
  if (!spec) throw new XgError('CLI_REQUIRED', 'Run setup to install the missing grok-bot-cli automatically.');
  const version = await execute(spec.command, [...spec.prefix, '--version'], { env: childEnv });
  const match = version.stdout.match(/\b(\d+\.\d+\.\d+)\b/);
  if (version.code !== 0 || !match || match[1].localeCompare(GROK_CLI_VERSION, undefined, { numeric: true }) < 0) throw new XgError('CLI_VERSION_UNSUPPORTED', `grok-bot-cli ${GROK_CLI_VERSION}+ is required. Use setup --install-cli to install the pinned version privately.`);
  let account = 'native-app';
  if (status.authentication.source === 'legacy-app-session') {
    if (!authorize && !config.legacySessionAuthorized) throw new XgError('AUTHORIZATION_REQUIRED', 'The saved login uses the legacy app format. Tell the user that keychain access is needed, then run setup --authorize-app-session. The user must handle any OS approval dialog.');
    const legacy = await legacyToken(appDataDir(env));
    childEnv.CURSOR_ACCESS_TOKEN = legacy.token;
    account = `app:${legacy.account}`;
  } else if (status.authentication.source === 'none') {
    throw new XgError('AUTH_REQUIRED', 'Open Grok Bot and sign in. The tool will not request passwords or refresh tokens.');
  } else {
    const secrets = await readJson(join(appDataDir(env), 'sand-secrets.json'), {});
    try { account = `app:${JSON.parse(secrets['cursor-accounts']).active}`; } catch {}
    if (status.authentication.source.endsWith('environment')) account = `environment:${env.GROK_BOT_GATEWAY_URL || 'cursor-access-token'}`;
  }
  const profileKey = createHash('sha256').update(account).digest('hex').slice(0, 24);
  return { client: new GrokClient(spec, childEnv, profileKey), status: { ...status, cli: { ...status.cli, installed: true, path: spec.path, version: match[1] } } };
}
