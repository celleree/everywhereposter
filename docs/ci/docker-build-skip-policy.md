# Pull Request Docker Build Policy

Pull request CI keeps the required **Docker build** check present for every pull request, but it may skip the actual image build when every changed file is explicitly safe-only.

## Safe-only changes

The image build may be skipped only when all changed files are in this allowlist:

- `AGENTS.md`
- root-level Markdown files
- Markdown files under `docs/**`
- Markdown files under `postiz-app/**`
- files under `postiz-app/tests/**`

Locale JSON, application source, dependencies, lockfiles, Dockerfiles, migrations, runtime configuration, deployment files, workflow files, and unknown paths require the real Docker build.

The `postiz-app/**` Markdown exemption depends on `postiz-app/.dockerignore` excluding `**/*.md` from the Docker context. Revisit this exemption if that exclusion or the build context changes. Mixed changes containing runtime source, dependencies, or Docker configuration still require Docker validation.

## Classification behavior

Paths are read as NUL-delimited Git filenames and shell-escaped in logs. This preserves exact allowlist matching for Unicode or newline-containing Markdown filenames without splitting their log entries.

The classifier compares the pull request head against its merge base so unrelated commits that later land on `main` are not treated as pull request changes.

Classification fails closed:

- failed or empty diffs require Docker
- missing or invalid classifier output fails the protected check
- failed, cancelled, or skipped prerequisite jobs fail the protected check
- manual workflow dispatch always builds

The classifier writes an explicit `reason` alongside `should_build`: `manual-dispatch`, `missing-revision`, `diff-unavailable`, `no-changes`, `docker-required-path`, or `safe-only-paths`.

Only an explicit `should_build=false` skips Docker validation. Only an explicit `should_build=true` starts Docker validation.

## Parallel validation and final gate

For Docker-required pull requests, the **Docker validation** worker starts after the repository guard and classifier succeed. It does not wait for the quality job, so Docker validation and quality checks can run in parallel.

The required **Docker build** check remains a final aggregate gate. It waits for the repository guard, quality checks, classifier, and Docker-validation worker, then fails closed unless:

- repository guard, quality, and classifier all succeeded;
- classifier output is literally `true` or `false`;
- `true` classification has a successful Docker-validation worker; or
- `false` classification has an intentionally skipped Docker-validation worker.

A failed, cancelled, missing, or unexpectedly skipped prerequisite cannot produce a green **Docker build** gate.

## Expected checks

Repository guards, typechecks, and stable unit tests still run for every pull request. When Docker validation is intentionally skipped for a safe-only change, the required **Docker build** check remains present and succeeds only after validating all prerequisites and classifier output.
