# Task path scope

The offline Node helper reads the existing rendered issue fields. No sidecar file or additional issue field grants authorization. F1 eligibility and owner-applied readiness after the final content edit remain separate required gates.

```text
### Expected scope

Owned paths:
- path/to/file.ts
- path/to/directory/

Shared paths or dependencies:
- None

### Explicitly out of scope

Prohibited paths:
- path/to/directory/private/

Other behavior exclusions:
- Keep unrelated behavior unchanged.
```

Use `- None` for an empty prohibited list. Shared paths must also be exactly `- None`; unresolved or free-form assignments fail closed. Paths are literal repository-relative files or directories with a trailing slash. Absolute, traversal, control, backslash, glob, duplicate, or ambiguous entries fail. Prohibitions and fixed governance/secret/dependency/container protections override ownership. Nested policy files, Git hooks, Git attributes/modules, and the canonical-branch guard are protected too.

`parse` validates an issue snapshot and its declared paths without Git mutations. `bind` adds repository/issue identity, snapshot and normalized-scope hashes, the start SHA, and optional repair PR HEAD. `collect`, `index`, and `pr` verify the bound contract and inspect local Git/ filesystem state; they do not stage or commit. Invoke the helper with Node; the existing wrapper supplies its positional arguments.

The task and queue wrappers load their remaining shell source into memory before starting any worker. It keeps helper and contract hashes in the parent process, then reads and verifies the helper/contract bytes once before importing those exact helper bytes for post-run checks. After Codex it checks NUL-delimited staged, unstaged, deleted and untracked paths, with rename detection disabled so both endpoints must be owned. It rejects symlink/gitlink modes and symlink ancestors, stages literal NUL pathspecs, and checks the resulting index. Repair also validates the complete pinned PR diff against the freshly owner-approved issue selected by the trusted `agent/issue-N` branch.

These are admission and final path/index guards. They do not prevent transient writes or writes to ignored files, and they do not replace sandboxing, independent review, CI, or existing human approval gates.
