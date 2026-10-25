# Validation record

Validated on 2026-10-25 on macOS with Node.js 22.22.0, grok-bot-cli 0.12.4, and Grok Bot 0.75.8.

- Offline doctor detects the app, CLI and saved-session format without requesting keychain access.
- Opt-in legacy login authenticates the current Grok account through its existing encrypted app login. No access/refresh token or user-specific bot ID is included in this repository.
- Missing-dependency installation was exercised in an isolated temporary private runtime directory using the real npm package.
- A single dedicated research Bot was created. Two real queries with different local session names reused that Bot and returned different gateway request IDs and only their own replies.
- The first public-X query returned a Booking Holdings post; the second returned NASA posts, with no prior Booking.com answer mixed into its returned messages.
- A real upstream rooted-thread read omitted assistant messages. A bounded transcript-tail merge fixed retrieval while preserving strict request-ID filtering; this behavior has a regression test.
- A real post dated October 23 UTC was correctly inside the October 24 Asia/Shanghai range. The timezone conversion has a regression test.
- Standalone copied-skill execution, repeat installation, and refusal to overwrite user-modified skills are covered by local tests.
- The skill passed the Codex skill-creator frontmatter validator. Package contents were inspected with npm pack.

Tests do not prove that Grok's research is factually complete, that it exhaustively searches X, or that server memory is isolated. Automatic skill triggering remains host-dependent. Windows/Linux end-to-end login and live queries have not been tested; the repository includes a cross-platform unit-test CI matrix to validate portable logic.

Runtime credentials, local research history, query receipts, and any private installation directories remain outside this repository. This record describes behavior without publishing account-specific state or the full live research transcripts.
