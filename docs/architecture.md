# Architecture

```text
Agent Skill -> standalone Node CLI -> grok-bot-cli -> dedicated Grok Bot -> public X search
```

## Components

| Component | Responsibility |
| --- | --- |
| Agent Skill | Recognize public Twitter/X research intent, expand the request, resolve dates, communicate authorization requirements, and present sourced findings. |
| Node CLI | Inspect the environment, install the pinned upstream CLI, manage the dedicated bot, track requests, and return matching replies. |
| grok-bot-cli | Authenticate with Grok Bot and perform bot and transcript operations. |
| Dedicated Grok Bot | Search public X content and produce findings with original post links, coverage, and limitations. |

The package entrypoint imports the runtime inside the skill directory. Both installation forms use the same implementation. There is no separate web service, background daemon, or direct X API client.

The installation command copies the self-contained skill and initializes the authenticated research environment. It reports readiness only after live bot access and dedicated bot preparation. Missing user actions produce a resumable structured response. Local content-hash receipts allow unmodified managed skills to update while preserving custom content. No authentication or research runs are performed by npm lifecycle hooks.

## Request lifecycle

1. Acquire a local operation lock and resolve the active account profile.
2. Verify the live bot roster and reuse a saved, purpose-specific bot. Create one only when no eligible bot exists.
3. Save a local run ID and a self-contained prompt before submitting the request.
4. Send once in manual reply mode. Keep an uncertain delivery pending until it can be reconciled.
5. Locate the user root with its unique run marker and bind the run to the gateway request ID.
6. Read the rooted thread and, when necessary, a bounded transcript tail. Return only replies matching the bot and request IDs.
7. Store the final reply when its completion marker is present and release the active local run.

A completed reply may describe a failed or incomplete search. Evidence quality and coverage remain part of the answer presented by the agent.

## Authentication

Authentication uses the upstream native app session or credentials already present in the user's environment. The optional macOS legacy adapter reads the active app account's encrypted access-token entry and its existing safe-storage key. It passes the decrypted token to the Grok CLI child process in memory and does not persist plaintext credentials or access refresh tokens.

The installed app version supplies the upstream client-version header. Unknown encrypted storage formats fail explicitly. Operating-system authorization dialogs remain under user control. The upstream CLI handles authenticated requests and gateway host validation.

## Isolation and state

There is one dedicated bot and one active local request per account profile. Sessions and runs are local identifiers. They do not create additional bots or provide independent server-side memory.

The local state directory contains configuration, prompts, and matching replies. Files use private POSIX permissions where supported; Windows uses the user's profile-directory permissions. State is retained until the user removes it. The tool does not upload local history to a repository or collect telemetry.

Local locks cannot coordinate other devices or manual writes to the same bot. Missing request IDs, mismatched targets, and transcript coverage gaps stop result routing. Unknown mutations are not automatically retried. The CLI does not reset shared memory or delete remote bots and conversations.

## Dependencies

- [grok-bot-cli](https://github.com/ScriptedAlchemy/grok-bot-cli) is a separately installed MIT-licensed tool. Setup installs a pinned version into a private directory when required.
- The skill follows the [Agent Skills specification](https://agentskills.io/specification).
- The Node CLI has no third-party runtime library dependencies.
