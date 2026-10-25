# Environment, authorization, and recovery

## Status and installation

`doctor` is offline: app installation, Node compatibility, CLI presence, session-file presence, and lock metadata. Presence is not proof of a valid login. `doctor --online` validates the live bot list without creating a bot; it may need the user's existing Grok app authorization.

`setup` automatically installs a missing `grok-bot-cli@0.12.4` with npm into the tool's private `runtime/` directory. It uses `--ignore-scripts` and does not require sudo or alter global PATH. `setup --install-cli` installs that tested version privately even if an older global version exists. It does not auto-update upstream to an untested latest release.

Node.js 22.19+ must already exist. A compatible local NVM/fnm runtime can be selected if the host launched Node 20. Otherwise tell the user to install supported Node.js. Grok Bot app installation remains a user action.

macOS app detection and encrypted legacy login were live-tested. Windows/Linux use standard installation paths and the upstream CLI's supported native session. Custom installations can set `XG_GROK_APP_PATH`; conservative detection can produce a false negative. Windows/Linux end-to-end behavior has not been live-verified.

## Authentication

Prefer the upstream CLI's native encrypted `gateway-descriptor.json`, or the credentials already supplied by the user's environment. Do not print credentials. The wrapper sends no direct X or Grok gateway requests: all research and bot operations go through grok-bot-cli.

An observed macOS app version did not produce a gateway descriptor. The opt-in legacy adapter reads only that app's known `sand-secrets.json` active-account access-token entry and the `Grok Bot Safe Storage` keychain item, using the existing encrypted storage format. It passes the access token to the Grok CLI child process in memory. It does not read a refresh token, persist plaintext credentials, copy credentials into a skill, or grant itself keychain permission. Unknown storage formats fail explicitly.

`setup --authorize-app-session` records a non-secret authorization preference. Notify the user before invoking it; if authorization is not established, ask before that operation. A macOS prompt requires the user's action. Do not automate system approval. To revoke the wrapper preference, remove `legacySessionAuthorized` from its local config; this does not sign out the Grok app.

The app's installed version is used for `SAND_CLIENT_VERSION` because the upstream default version was observed to be rejected. The tool does not impersonate a guessed newer version. Custom app installations may set `XG_GROK_CLIENT_VERSION` to their actual installed app version. A 401 still requires sign-in/update; no automatic refresh-token flow is implemented.

## State and isolation

State defaults to `$XDG_STATE_HOME/x-cli-via-grok`, or `~/.local/state/x-cli-via-grok`; on Windows it uses `%LOCALAPPDATA%/x-cli-via-grok`. `XG_STATE_DIR` overrides it.

- `config.json`: profile-scoped bot ID, authorization preference, active run and uncertain creation receipt.
- `runs/<UUID>.json`: readable research prompt, session ID, root/gateway request ID, matching messages and final answer.
- `operation.lock/`: local process ownership, released when the command exits normally.

Directories/files are created with 0700/0600 POSIX modes where supported. Windows relies on the user's profile-directory ACLs. Local research history is not uploaded to GitHub. Retention is explicit: the tool does not silently delete history or the user's remote messages.

Never confuse a CLI envelope/correlation ID, the local run UUID, and the gateway requestId. Only the gateway requestId on the actual user transcript entry is used to select replies. A unique readable run marker discovers that root. Rooted reads can omit assistant send-message entries in the observed upstream version. The adapter merges the rooted read with a bounded transcript tail when necessary, then filters by exact requestId and bot ID before returning any content.

The upstream plain CLI send does not provide a verified idempotency key or a server-memory reset. Unknown deliveries stay pending and are reconciled by reading; they are never automatically retried. Unknown bot creation is reconciled against the live roster before another create can be attempted.

There is one active local run per profile, not one new remote bot per session. Two machines have separate locks; simultaneous first setup or external writes are not globally serialized. Account binding for environment-only credentials is weaker than the app's stable active-account identity; always verify the saved bot ID still belongs to the active roster.

## Recovery

- `AUTH_REQUIRED`: open/sign in or update Grok Bot; notify the user. Do not print or solicit tokens.
- `BOT_AMBIGUOUS`: select one listed purpose-specific bot using `setup --bot-id ID`; never silently reuse a general-purpose bot.
- `RESEARCH_BUSY`: read the supplied runId. No extra bot is created.
- `delivery_unknown`: use `read`; do not resend. If the root is beyond the 200-entry tail, inspect Grok UI and report a coverage gap.
- `TRANSCRIPT_SCHEMA_CHANGED` / `REQUEST_ID_MISSING`: stop result routing and update the adapter. Never return an unfiltered transcript.
- A process crash can leave a lock. `recover-lock` only removes it after proving its PID no longer exists on this hostname. It does not cancel or release an active research run.
- An upstream reply without `XG_DONE <runId>` stays pending. After the user verifies that Grok has finished, `release RUN_ID --confirmed-finished` releases only local bookkeeping. It does not cancel remote work or clear shared memory. Do not call it automatically to bypass serialization.

## Trigger examples

Use: “查 X 上最近三个月关于 Booking.com 的讨论”；“Twitter 上大家怎么评价这个产品”；“汇总这个账号最近一周的公开帖子”；“核对一条在 X 流传的说法”。

Do not use: “帮我写一条推文”；“替我发帖/私信”；“解释 Grok 模型”；“全网查某公司的新闻” without Twitter/X scope；“在代码里把变量 x 改名”。
