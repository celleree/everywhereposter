# Cooked publication preparation

This manual workflow is preparation code, not permission to dispatch, upload
Release assets, publish images, deploy, or activate the editor. Each needs its
separate approval. It preserves the vetted Python/model image; it never runs apt,
rebuilds that image, changes source/model pins, or changes either Dockerfile.

**Release remains blocked.** Exact matching Debian source archives/patches,
PyAV bundled-native provenance/source/notice mappings, and tested recipient
delivery remain incomplete. Existing notices and a synthetic passing test bundle
do not resolve those gaps. Revision-specific model evidence is already retained;
that closed item must not be reopened as an unexplained blocker.

## Inputs and identities

After independent review and separate execution approval, the repository owner
`celleree` can dispatch `publish-cooked-worker.yml` on exact current `main`, which
must be the merge commit of a merged PR. Inputs are full source SHA, approved
official `node@sha256:<digest>` (also `docker.io/library/node`), and two numeric
same-repository GitHub Release asset IDs with reviewed SHA256 checksums. Assets
must be uncompressed regular-file tar archives: the original `docker image save`
export and a completed recipient companion bundle. No arbitrary URL is accepted.
No archive or source-bundle binary is uploaded as an artifact or Release asset.
Separately approved future execution publishes only the two fixed GHCR images.

The approved original Docker image identity is the OCI index
`sha256:3d118a94c192655d02f186449f00d41a48a4f896cb93850006139dcba4b3a9d3`;
its config is separately
`sha256:eff48e58dd5a40c9bd9308b81232b6c520fdf81a1e40a8e424388726e35cc17c`.
Those identities are not interchangeable. The dual OCI/legacy export's entire
blob graph, config, compressed blob hashes and uncompressed rootfs diff IDs are
checked before loading. A new legacy load archive preserves exact config and
layer bytes and replaces archive-controlled tags with `cooked-import:verified`.
Harmless normalized directory entries are ignored; links, specials, sparse files,
traversal, duplicate names/JSON keys and excess member/byte/JSON bounds reject.
Nothing uses `extractall`. Limits: 20,000 members, 8GiB member bytes, 4MiB JSON.

The worker is built with the unchanged stager and Dockerfile for linux/amd64.
The imported base config/rootfs, Node version/platform, UID10001:GID0, runtime
hashes, upstream/model pins/files and retained notices must pass the existing
shared `verify-image.py` contract before registry login (also used by the
preparation workflow). The observer
must also see identical base inventory in the final worker.

## Companion schema 1

`manifest.json` is JSON with these required fields:

```text
schema: 1
sourceSHA: exact reviewed execution source SHA
baseArchiveSHA256: full archive checksum
baseIndexDigest: approved OCI index above
baseConfigDigest: approved config above
nodeBase: exact approved official Node digest input
inventory:
  base:
    debian: [{binary, version, source, sourceVersion}, ...]
    python: [{name, version}, ...]
    native: [{path, sha256}, ...]
    payload: [{path, sha256}, ...]
  node: {version, licenseSHA256}
  worker: {sourceSHA, sourceFiles, runtimeHashes} # from stager manifest
components:
  - kind: debian | python | native | payload | node | worker
    identity: exact inventory row (entire node/worker object for those kinds)
    disposition: bundled-source | source-present | notice-only
    basis: substantive resolved component-specific explanation
    sources: [bundle-relative source file paths]
    notices: [bundle-relative notice file paths]
    build: [bundle-relative build/patch/provenance mapping file paths]
files: {bundle-relative path: sha256, ...}
delivery: {owner, instructions: files-path, testedEvidence: files-path}
```

Every file except the manifest must occur in `files`; every mapping reference must
exist and hash-match. No symlinks or external file references are accepted. Each
observed inventory row requires exactly one component, with no extra/duplicate
components. Notices/build mappings must be nonempty. Source dispositions require
nonempty bundled source references; `source-present` uses recipient material
explaining/preserving source already shipped. `notice-only` requires a documented
basis. Empty, TODO, unknown, pending or unresolved dispositions fail validation.
The parser checks mechanical completeness; it cannot certify licenses, whether
source is corresponding, or whether a stated basis/delivery test is correct.
The expected bundle checksum must receive responsible provenance/licensing review
before execution; never fabricate a placeholder accepted manifest.

The offline base observer records all installed Debian binary/source versions,
Python distributions, all site-packages `.so` files and files under `.libs`
directories, and payload hashes for all manifest-listed upstream/model files,
the source manifest, model notices and CPython license. Node version and complete
Node license hash come from the approved Node image and must match final notices.
This observed inventory is a coverage key, not a claim to identify all historical
layer content or all statically linked dependencies. Review must reconcile those
through component source/build mappings, including Debian, CPython, Node and
wheel-native component provenance. Bundled source archives may themselves contain
links as opaque hash-verified files; this tool never extracts them.

## Registry and evidence gates

Only `ghcr.io/celleree/publish-everywhere-cooked-base:<full-sourceSHA>` and
`ghcr.io/celleree/publish-everywhere-cooked-worker:<full-sourceSHA>` are written.
There is no `latest`, arbitrary destination, production secret or activation path.
The publication job alone requests `contents:read` and `packages:write`; the source
gate uses contents-read plus pull-requests-read for the merged-PR provenance API.
The preparation workflow needs the same narrow read permission. See the
[GitHub endpoint permission requirement](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit).
Inputs enter shells only through environment values.
Workflow concurrency serializes its own writers. Existing tags block publication;
only authenticated structured HTTP404 `MANIFEST_UNKNOWN` or `NAME_UNKNOWN`
proves absence for these fixed targets. Publication approval must explicitly name
both packages, including first creation. 401/403, opaque404, server errors and
unknown scope/state stop; no permission fallback or alternate target is used. Do not run competing external
writers: GHCR provides no atomic create-only tag operation.

A receipt records source/main SHA, imported config/index, archive/bundle checksums,
Node digest, staging/image verification and actual registry manifest digests.
Imported Docker image ID, worker Docker image ID, original index and config are
recorded separately; rewrapping can change the Docker/registry manifest identity
without changing original config/rootfs. A null registry value means a push was
attempted but its resulting digest remains unverified.
Partial publication can leave the first immutable tag if the second push fails;
retain the receipt and stop for an approved recovery, without deleting/overwriting.
Only JSON receipts are retained as workflow artifacts. Asset upload, completed
source/notice acceptance, publication execution, deployment and activation remain
separate gates.

Focused checks: `python3 -B -m unittest discover -s tools/cooked-worker -p publication_test.py`
and `node --test tools/cooked-worker/stage-runtime.test.cjs`.
