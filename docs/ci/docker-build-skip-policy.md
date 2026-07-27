# Pull Request Docker Build Policy

Pull request CI keeps the required **Docker build** check present for every pull request, but it may skip the actual image build when every changed file is explicitly safe-only.

## Safe-only changes

The image build may be skipped only when all changed files are in this allowlist:

- `AGENTS.md`
- root-level Markdown files
- Markdown files under `docs/**`
- files under `postiz-app/tests/**`

Locale JSON, application source, dependencies, lockfiles, Dockerfiles, migrations, runtime configuration, deployment files, workflow files, and unknown paths require the real Docker build.

## Classification behavior

The classifier compares the pull request head against its merge base so unrelated commits that later land on `main` are not treated as pull request changes.

Classification fails closed:

- failed or empty diffs require Docker
- missing or invalid classifier output fails the protected check
- failed, cancelled, or skipped prerequisite jobs fail the protected check
- manual workflow dispatch always builds

Only an explicit `should_build=false` skips the image build. Only an explicit `should_build=true` starts the image build.

## Expected checks

Repository guards, typechecks, and stable unit tests still run for every pull request. When the image build is skipped, the required **Docker build** check remains present and succeeds after validating all prerequisites and classifier output.
