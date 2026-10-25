# Agent installation

Use this procedure when a user asks Codex or Claude Code to install this repository. Complete both skill installation and initialization. Installing the npm package or copying the skill alone does not establish readiness.

## Prepare the local runtime

Work on the same device as the user's Grok Bot desktop app. A remote or cloud environment cannot use a desktop login on another device.

Select the current host: `codex` or `claude`. Use `both` only when the user asks to install for both hosts. No host configuration or permission changes are required.

Check for Node.js 22.19 or later and npm. Reuse a compatible installed runtime, including one managed by NVM or fnm. If none exists, install a supported Node.js version through the user's existing package or version manager within the host's permissions, then continue. If runtime installation requires user action, state the specific requirement and resume afterward. Do not use administrator access without authorization.

Read the package entrypoint and installation implementation before execution. A checkout can be used directly, without a build, global npm installation, or a permanent repository directory:

```sh
git clone https://github.com/mcsuen/x-cli-via-grok.git
cd x-cli-via-grok
node bin/x-cli-via-grok.mjs install --host codex --json
```

Replace `codex` with `claude` for Claude Code. Use a temporary directory or the host's installation workspace for the checkout. If git is unavailable, download and extract the [source archive](https://github.com/mcsuen/x-cli-via-grok/archive/refs/heads/main.zip), then run the same entrypoint. Runtime state is stored outside the checkout.

Before running `install`, notify the user that initialization checks their existing Grok login, may show an operating-system authorization prompt, and reuses or creates one dedicated X research bot. The user handles sign-in and OS approval dialogs.

## Complete initialization

The `install` command installs the self-contained skill, installs a missing Grok CLI privately, verifies live account access, and reuses or creates the dedicated research bot. It repairs an outdated discovered Grok CLI with a private pinned copy unless an explicit `XG_GROK_CLI` override is set. It does not submit a research query.

- `ready`: installation and initialization succeeded. Confirm that the host discovers `x-research-via-grok`; reload skills or reopen the session if needed.
- `needs_user_action`: installation is incomplete. Follow `nextAction`, keep the installed files, and rerun the same command after the required action. Exit code 1 accompanies this status.
- Other errors: report the concrete failure and resolve it within the installation scope. Do not claim readiness or repeatedly retry an uncertain bot creation.

If Grok Bot is missing, direct the user to <https://cursor.com/sand> to install, open, and sign in. Continue automatically with work that does not depend on that action, then resume initialization once available.

If `AUTHORIZATION_REQUIRED` requests the legacy macOS adapter, explain existing-login and Keychain access before proceeding. Within established user authorization, rerun:

```sh
node bin/x-cli-via-grok.mjs install --host codex --authorize-app-session --json
```

Preserve the original host and any custom directory options. The flag permits the in-memory adapter; it does not approve OS dialogs. Never request tokens, passwords, or verification codes in chat. For multiple eligible bots, present the returned candidates and pass the selected ID with `--bot-id ID`.

## Skill destinations and updates

New user installations use `~/.agents/skills/x-research-via-grok` for Codex and `~/.claude/skills/x-research-via-grok` for Claude Code. See the [Codex skill locations](https://learn.chatgpt.com/docs/build-skills) and [Claude Code skill locations](https://code.claude.com/docs/en/skills).

For a host with a custom skills directory, pass `--dir /absolute/skills-parent` with a single host. Before installing, check for an existing installation, including legacy `$CODEX_HOME/skills` or `~/.codex/skills` locations. Use its parent with `--dir` when that is the host's active discovery path; do not create duplicate active copies.

Identical installations are reused. Unmodified installations managed by this installer can be updated. Content hashes are stored in a local installation receipt; custom or unmanaged differing content is preserved and requires review. Do not delete a user's customized skill to bypass a conflict.

The installed skill includes its runtime, so the source checkout may be removed after successful installation. A global `x-cli-via-grok` command is optional. If the user also wants that command, install the GitHub package in a user-writable npm prefix and run `x-cli-via-grok install --host HOST --json`.

Report the selected host, readiness or remaining user action, and any required skill reload. Do not run a sample X query unless requested.
