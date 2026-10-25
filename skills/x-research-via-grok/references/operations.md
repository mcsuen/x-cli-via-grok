# Operations

## Environment and installation

`install --host codex|claude|both` installs the skill and completes initialization in one invocation. Defaults are `~/.agents/skills` for Codex and `~/.claude/skills` for Claude Code; `--dir` selects an existing custom discovery directory for one host. Install for both hosts only when requested. A local content-hash receipt supports updates of unmodified managed skills while preserving custom content. The skill runtime remains usable after the source checkout is removed.

`ready` confirms live account access and a prepared dedicated bot. `needs_user_action` returns exit code 1 and a concrete `nextAction`; keep installed files and rerun installation after the required action. The installer sends no research query. Announce authentication and bot preparation before invoking it.

`doctor` checks app installation, Node compatibility, CLI availability, saved-session presence, and local lock metadata. Saved files do not establish a valid login. `doctor --online` verifies access to the live bot roster without creating a bot.

`setup` installs a missing `grok-bot-cli@0.12.4` through npm into the private `runtime/` directory. Installation uses `--ignore-scripts`, requires no sudo, and leaves global PATH unchanged. `setup --install-cli` installs the pinned version privately even when another version exists globally.

Node.js 22.19 or later is required. The launcher can select a compatible local NVM or fnm runtime. If none is available, ask the user to install a supported Node.js version. Grok Bot installation and sign-in remain user actions.

App discovery uses standard platform paths. Set `XG_GROK_APP_PATH` for a custom installation. Native authentication is handled by the upstream CLI; the optional legacy encrypted-session adapter supports macOS only.

## Authentication

Use the upstream encrypted app session or credentials already supplied in the user's environment. All bot and research operations go through grok-bot-cli. Do not print credentials.

For a legacy macOS app session, the opt-in adapter reads the known `sand-secrets.json` active-account access-token entry and the existing `Grok Bot Safe Storage` keychain item. It decrypts the supported storage format in memory and passes the access token to the Grok CLI child process. It does not read refresh tokens, persist plaintext credentials, or approve keychain permissions. Unsupported formats fail explicitly.

`setup --authorize-app-session` saves a non-secret authorization preference. Notify the user before invoking it and obtain consent if access is not already authorized. Operating-system prompts require the user's action. Removing `legacySessionAuthorized` from local configuration revokes this adapter preference without signing out the Grok app.

The installed app version supplies `SAND_CLIENT_VERSION`. Custom installations may use `XG_GROK_CLIENT_VERSION` for their actual version. Authentication errors require appropriate sign-in or app updates; there is no automatic refresh-token flow.

## State and isolation

The default state directory is `$XDG_STATE_HOME/x-cli-via-grok` or `~/.local/state/x-cli-via-grok`. Windows uses `%LOCALAPPDATA%/x-cli-via-grok`. `XG_STATE_DIR` overrides the location.

- `config.json`: profile-scoped bot selection, authorization preference, active request, and uncertain bot creation state.
- `runs/<UUID>.json`: the self-contained prompt, session ID, root and gateway request IDs, matching replies, and final answer.
- `operation.lock/`: local process ownership for configuration and submission operations.

Files and directories use private POSIX modes where supported. Windows relies on the user's profile-directory permissions. State remains outside the repository and is retained until the user removes it. The tool does not silently delete remote messages or local history.

The local run UUID, CLI envelope ID, and gateway request ID are distinct. A unique run marker identifies the user root. Reply selection requires the actual gateway request ID and dedicated bot ID. Rooted reads may omit assistant messages; the adapter combines them with a bounded transcript tail and filters ownership before returning content.

Plain CLI sends do not provide a guaranteed idempotency key. Uncertain deliveries stay pending for reconciliation and are not automatically resent. Uncertain bot creation is checked against the roster before another creation.

One request can be active per local account profile. Separate devices do not share locks. Account binding with environment-only credentials depends on the credential source; verify that the saved bot still belongs to the active roster. The dedicated bot retains shared server memory.

## Recovery

| Condition | Action |
| --- | --- |
| `AUTH_REQUIRED` | Notify the user and reopen, sign in to, or update Grok Bot as appropriate. Do not solicit tokens. |
| `BOT_AMBIGUOUS` | Select an eligible dedicated bot with `setup --bot-id ID`. |
| `RESEARCH_BUSY` | Read the returned run ID instead of creating another bot. |
| `delivery_unknown` | Read the existing request. Do not resend it. |
| Transcript coverage gap | Inspect the dedicated bot and report the gap. Do not return another session's content. |
| `TRANSCRIPT_SCHEMA_CHANGED` or `REQUEST_ID_MISSING` | Stop result routing and update the adapter. |
| Stale local process lock | Use `recover-lock` only when the recorded process has stopped on the same host. Active research remains pending. |
| Missing completion marker | After the user confirms remote work finished, use `release RUN_ID --confirmed-finished` to release local bookkeeping only. |

Lock recovery and local release do not cancel Grok work, delete a bot, or clear shared memory.

## Invocation scope

Use this skill for public X searches, account summaries, discussion analysis, and checking claims circulating on X. Examples include "Summarize recent X discussion about a product" and "Find this account's public posts from last week."

Do not use it for tweet drafting, publishing, direct messages, general Grok questions, generic web research without X scope, or software tasks that merely use a variable named x.
