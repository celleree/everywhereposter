# EverywherePoster Copilot instructions

Start with [AGENTS.md](../AGENTS.md). Use its current checkout checks, bounded scope, model routing, and approval gates.

- Locate code through [repository routing](../docs/brain/REPOSITORY_ROUTING.md).
- Check capability claims against [product truth](../docs/brain/PRODUCT_TRUTH.md).
- Follow [the handoff cycle](../docs/brain/CHATGPT_CODEX_HANDOFF.md#chatgpt-managed-implementation-cycle): push the completed HEAD, wait for matching required CI, then obtain required fresh independent exact-SHA review.
- Use [the root protocol](../docs/brain/ORCHESTRATOR_PROTOCOL.md) for local worktrees and [Codex automation](../docs/brain/CODEX_AUTOMATION.md#execution-lanes) for GitHub role/visibility limits.
- Application-specific notes are in [postiz-app/CLAUDE.md](../postiz-app/CLAUDE.md) and [the workspace Copilot adapter](../postiz-app/.github/copilot-instructions.md). Toolchain truth is `postiz-app/package.json`, with matching CI and Docker declarations.

These routes do not authorize installs, authentication changes, production access, merge, or deployment.
