# x-cli-via-grok

Search, aggregate, and analyze public Twitter/X content through a dedicated Grok Bot. The package includes a standalone CLI and a portable Agent Skill for Codex, Claude Code, and other compatible hosts.

All bot management and research requests use [grok-bot-cli](https://github.com/ScriptedAlchemy/grok-bot-cli). The required desktop application is [Grok Bot](https://cursor.com/sand).

## Requirements

- Node.js 22.19 or later, with npm.
- Grok Bot installed and signed in on the local device.
- Local command execution and network access.

The CLI installs a missing `grok-bot-cli` into its private runtime directory. Grok Bot installation, account sign-in, and operating-system authorization remain user actions.

## Installation

```sh
npm install --global github:mcsuen/x-cli-via-grok
x-cli-via-grok install-skill --host both
```

Use `--host codex` or `--host claude` to install for one host. The default skill locations are `$CODEX_HOME/skills` (or `~/.codex/skills`) and `~/.claude/skills`.

Other Agent Skills hosts can install `skills/x-research-via-grok/` directly. The skill includes its runtime and does not depend on the repository working directory. Identical installations are reused; user-modified skills are not overwritten. Reopen the agent session when required for discovery.

Automatic invocation depends on the host's skill discovery and model selection. Claude Code supports the provided installation path; Claude Desktop requires a separate compatible local-tool integration.

## Setup

```sh
x-cli-via-grok doctor --json
x-cli-via-grok setup --json
```

`doctor` checks the local environment without reading the keychain or creating a bot. `doctor --online` verifies the active login against the live bot roster.

`setup` installs a missing `grok-bot-cli@0.12.4`, verifies authentication, and reuses or creates a dedicated research bot. `setup --install-cli` installs the pinned CLI version privately without changing a global installation. Multiple eligible bots require an explicit `--bot-id` selection.

For a legacy macOS app session, the following command authorizes use of the existing encrypted login through macOS Keychain:

```sh
x-cli-via-grok setup --authorize-app-session --json
```

Notify the user before authentication or keychain access. The user handles sign-in, passwords, verification codes, and system prompts. Access tokens are handled in memory and are not saved by this tool. See [operations](skills/x-research-via-grok/references/operations.md) for authentication and recovery details.

## Research

With the skill installed, ask the agent to search or analyze public Twitter/X content. For example:

> Summarize recent X discussions about a product. Separate official announcements from user reports and include original post links.

For direct CLI use, save a self-contained research request in a UTF-8 file:

```sh
x-cli-via-grok plan --prompt-file request.txt --timezone UTC --json
x-cli-via-grok query --prompt-file request.txt --session product-research --timezone UTC --wait 40 --json
```

`plan` previews the expanded prompt locally. `query` submits it to the dedicated bot. Dates default to the last seven calendar days; use `--since YYYY-MM-DD` and `--until YYYY-MM-DD` for a specific inclusive range. The current day ends at the actual current time. Use `--language` to request a response language; otherwise the response follows the original request.

If the result is pending, read the returned run ID:

```sh
x-cli-via-grok read RUN_ID --wait 40 --json
x-cli-via-grok sessions --json
```

Commands return JSON. Exit code 0 can represent a pending request. `complete` means the final reply was received; inspect the answer for search failures, missing coverage, and unverified claims. Errors use exit code 1.

## Bot and session model

- One dedicated bot is reused per local account profile. Sessions and runs are local objects, not additional entries in the Grok bot list.
- One research request can be active at a time per local profile. Concurrent submissions return `RESEARCH_BUSY`.
- Requests are self-contained. Returned replies must match both the dedicated bot ID and the gateway request ID.
- Rooted reads and bounded transcript tails are combined when necessary, with request ownership checked before returning content.
- Uncertain sends are reconciled by reading; they are not automatically resent. Uncertain bot creation is checked against the live roster before another creation.

Grok server memory is shared within the dedicated bot. Request and result routing do not provide server-side memory isolation. Local locks do not coordinate other devices or manual writes to the bot.

The research interface does not post, send direct messages, like, follow, create schedules, or delete user bots and conversations.

## Configuration

| Variable | Purpose |
| --- | --- |
| `XG_STATE_DIR` | Override the local state directory. |
| `XG_GROK_APP_PATH` | Specify a nonstandard Grok Bot installation path. |
| `XG_GROK_APP_DATA` | Specify the app data directory used by local session inspection and the legacy adapter. |
| `XG_GROK_CLI` | Select an existing Grok CLI executable or Node entrypoint. |
| `XG_GROK_CLIENT_VERSION` | Supply the actual app version for a custom installation. |

State defaults to `$XDG_STATE_HOME/x-cli-via-grok` or `~/.local/state/x-cli-via-grok`. Windows uses `%LOCALAPPDATA%/x-cli-via-grok`. Configuration, prompts, and results stay in that local directory; access tokens are not persisted.

The CLI supports standard app discovery paths and upstream native authentication. The optional legacy encrypted-session adapter supports macOS only. Custom installations may require explicit paths. See [architecture](docs/architecture.md) for component responsibilities and isolation boundaries.

## License

MIT. This project is independent of Grok Bot, X, Cursor, OpenAI, and Anthropic.
