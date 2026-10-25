# Architecture and design decisions

`Agent user intent → SKILL.md → standalone Node CLI → grok-bot-cli → dedicated Grok Bot → public X search`

The repository is an independently installable CLI and a portable Agent Skill. A thin package entrypoint imports the exact runtime bundled inside the skill. There is no second implementation to drift out of sync, no web server, no MCP daemon, and no direct Grok gateway or X API client.

## Responsibility boundary

The skill decides whether the user is requesting Twitter/X information, expands a self-contained brief, resolves dates using the user's timezone, communicates authorization needs, evaluates evidence, and writes the final answer. It does not trigger merely because the letter X, Grok, social media writing, or a generic company-news request appears.

The CLI handles deterministic filesystem/environment checks, pinned upstream installation, existing-login adaptation, bot discovery and persistence, readable prompt construction, journaled sends, reply ownership, bounded polling, and installation of the skill into supported host directories. It exposes only research/setup capabilities, not an arbitrary Grok command passthrough.

## Authentication

The native upstream app session remains preferred. macOS legacy authentication is an opt-in compatibility adapter for an observed app version lacking the gateway descriptor. It reads the known active-account encrypted access-token entry and the existing app safe-storage key, uses the standard Electron AES/PBKDF2 storage format, passes the token to the CLI child environment, and never serializes it. Unknown formats fail closed. No refresh-token implementation is added.

The installed app version supplies the upstream client version header. This addresses an observed unsupported-default-header error without guessing a newer version. Upstream remains responsible for validating gateway hosts and sending authenticated requests.

## Research lifecycle

1. A local operation lock prevents races in configuration and bot creation.
2. Resolve the current login profile and verify the live bot roster. Saved bot IDs must still identify a purpose-specific bot.
3. Create a bot only when no purpose-specific bot exists; persist uncertain creation before the mutation. Do not retry an unknown create.
4. Render a complete prompt and journal a new local UUID before sending. The local session is not a remote object.
5. Plain CLI `send` is manual and can return unknown even with `accepted:true`. It is sent once. The local run stays active until reconciled.
6. Find the matching user root using its unique readable run marker, then bind to the gateway's actual requestId. Correlation/envelope IDs are not substituted for it.
7. Read only the matching Bot and requestId. Use the rooted thread once available; the observed upstream root response can omit assistant replies, so merge a bounded transcript tail when necessary and still require exact requestId ownership. Return only matching progress and the final response bearing the run completion marker.
8. Persist completion and release the profile's active run. A completed answer may still say the underlying search failed; the host must judge the content.

## Deliberate limits

One shared bot is useful for a tidy sidebar, but it is not a privacy boundary between server-side conversations. Prompt instructions reduce context contamination; they cannot prove memory erasure. Local locks cannot serialize other devices or manual writes to the same Bot. A future upstream isolated-conversation/session API would be the right way to strengthen this, rather than inventing unsupported flags.

There is no arbitrary automatic retry of a mutation, no invisible reset, and no automatic bot deletion. There is no general “read all my Grok messages” command. Bounded transcript gaps or missing IDs stop result routing rather than returning other research.

The local state directory stores prompts and replies and can therefore contain user research interests. It is outside the repository, private where POSIX modes apply, and retained until the user removes it. No telemetry is implemented. Installed skill/runtime code does not contain the creator's account IDs or credentials.

## Upstream and specification references

- [grok-bot-cli](https://github.com/ScriptedAlchemy/grok-bot-cli): CLI command semantics, authentication mechanisms, manual sends and rooted transcript reads.
- [Agent Skills specification](https://agentskills.io/specification): portable SKILL.md structure and metadata.

This project relies on grok-bot-cli as a separately installed MIT-licensed tool; it does not vendor its bundled runtime or depend on it as an npm runtime dependency. Private installation is explicit in setup and pinned to the tested version.
