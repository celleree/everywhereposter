# Codex Instructions

Work in credit-saving mode.

## Default Workflow

- Prefer small, targeted fixes.
- Do not scan the entire repository unless necessary.
- Do not edit files until you have explained the plan.
- Before editing, identify the likely root cause, smallest fix, files to change, and verification command.
- Ask before making broad changes.
- Inspect only the files directly related to the task, error, or current issue.
- If more context is needed, ask for the exact file names before reading them.
- Do not refactor unrelated code.
- Do not rename things unless required.
- Do not change formatting unless required.
- Do not add dependencies unless explicitly approved.
- Run the narrowest relevant test or check, not the full suite.
- Show the diff after changes.
- Stop after the first working fix.

## Avoid

- Do not use subagents unless explicitly requested.
- Do not perform broad cleanup.
- Do not improve unrelated code.
- Do not explore unrelated folders.
- Do not run long commands without explaining why.

## Operational rules for this repo

- Work one step at a time, especially for server and dev tasks.
- For Post Everywhere, the usual live working environment is Hetzner SSH at `/home/arund/publish-everywhere-git`, not local WSL.
- Do not start Docker Desktop, the local WSL Postiz stack, or local cloudflared unless local work is intentional.
- Before coding sessions, run `git status --short` and `git log -5 --oneline`.
- The current active branch is `snapshot/local-working-state-2026-04-29`.
- Use VS Code SSH for editing and the Hetzner console for heavy Docker builds.
