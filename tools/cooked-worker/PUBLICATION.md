# Owner-only private Cooked delivery preparation

This path prepares local images for the same owner's internal private use.
Only `celleree` and its deployment automation may access registry/Hetzner copies;
customers receive edited videos only. Preparation does not authorize registry
login, push, host access, deployment or activation. Those remain separate gates.
The retired #244 public same-repository Release-asset route must never be used:
its workflow explicitly refuses, and legacy download/prepare/publish CLI commands
reject before external I/O. No raw archive or companion is uploaded.

Public redistribution remains unresolved: exact matching Debian source/patches,
PyAV native provenance/source/notice mappings, recipient delivery, and GPL/OpenSSL
questions require review if outside recipients ever receive copies. These are
not automatic blockers to the confirmed same-owner internal use. Private access
is neither legal clearance nor a licensing waiver. Preserve all collected source
evidence and existing notices; do not reopen closed revision-specific model
checks or claim that synthetic test bundles resolve public distribution.

## Local inputs and preparation

After exact-source review and separate approval to run local Docker preparation,
use a clean checkout at the reviewed full SHA, existing locked compiler tools,
and an absolute real directory outside the checkout containing only regular,
nonsymlink `base.tar` and `custody.json`. The archive is the already verified
uncompressed dual OCI/legacy Docker export. No input download or credential is
needed. The approved official Node 22.20.0 linux/amd64 digest must already exist
in the local Docker store; this path never pulls it. Use a fresh directory for
each attempt; retain failed outputs for diagnosis rather than overwriting them.

`custody.json` is a <=16KiB JSON object with exactly these keys (no duplicates):

```json
{
  "schema": 1,
  "sourceSHA": "<reviewed full 40-character SHA>",
  "baseArchiveSHA256": "<reviewed full archive SHA256>",
  "baseIndexDigest": "sha256:3d118a94c192655d02f186449f00d41a48a4f896cb93850006139dcba4b3a9d3",
  "baseConfigDigest": "sha256:eff48e58dd5a40c9bd9308b81232b6c520fdf81a1e40a8e424388726e35cc17c",
  "nodeBase": "node@sha256:<reviewed official Node digest>",
  "owner": "celleree",
  "allowedAccess": ["owner", "deployment-automation"],
  "independentRecipients": false,
  "customerDelivery": "edited-videos-only",
  "attestedBy": "celleree"
}
```

This is a schema example, not a usable custody receipt. The owner must attest the
actual identities and custody facts. Review and retain the record's SHA256
independently; pass it as `CUSTODY_SHA256`. Operator statements attest intended
custody, not proven package permissions, recipient facts or legal compliance.
Synthetic fixtures and mocked tests never qualify as real evidence.

Set `SOURCE_SHA`, `BASE_SHA256`, `NODE_BASE` (also accepts
`docker.io/library/node@sha256:<digest>`) and `CUSTODY_SHA256` to reviewed values,
then, only with local execution approval, run:

```sh
python3 tools/cooked-worker/publication.py prepare-private /absolute/private-work
```

The unchanged stager checks exact clean HEAD before Docker mutation. Existing
archive validation checks the full blob graph, config, compressed layer hashes
and uncompressed rootfs diff IDs, rejecting malformed/unsafe/bounded archive
content. The load archive preserves exact config/layers while replacing
archive-controlled tags with `cooked-import:verified`. The unchanged Dockerfile
builds `cooked-final:verified` for linux/amd64. Shared `verify-image.py` retains
upstream/model pins/files, runtime hashes, UID10001:GID0 and notices checks.
Loaded config/rootfs, local Node version/platform/license, unchanged base/final
inventory and copied Node license must match. No source/model rebuild, apt,
Dockerfile or dependency change is introduced.

An exclusively created `verification.json` reports
`PRIVATE_PREPARED_NOT_PUBLISHED`, source/custody/archive hashes, distinct original
OCI index/config identities, imported Docker image ID, worker Docker image ID,
Node digest, staging and verification results. `mainSHA`, `bundleSHA256` and
`registry` remain null: preparation proves no current-main relationship, public
bundle completeness, registry digest, visibility or pull access. It stops before
registry login/push; no publication/deployment receipt is implied.

## Separately authorized publication and staging

There is no new registry automation. A later explicitly approved operator uses
existing Docker/GHCR tooling, with approval naming both fixed packages and any
first creation:

- `ghcr.io/celleree/publish-everywhere-cooked-base:<full-sourceSHA>`
- `ghcr.io/celleree/publish-everywhere-cooked-worker:<full-sourceSHA>`

Before any registry write, recheck exact reviewed clean source, local image IDs
and retained input/verification hashes. Read-only authenticated package inspection
must establish owner identity, private visibility and owner/deployment-only access
(including inherited repository access and Actions grants). Verify intended pull
access for existing packages. Public or ambiguous targets stop. Never repair
visibility or permissions automatically. Credentials/access remain an approval
gate; no credentials are introduced by this preparation.

For a new package, obtain explicit first-creation approval and conclusive
read-only absence evidence. GitHub documents new container packages as private
by default; this is not visibility/access proof. A 401/403, opaque 404 or unknown
state never proves absence. Only authenticated structured `MANIFEST_UNKNOWN` or
`NAME_UNKNOWN` with HTTP404 establishes absent tags; inspect package existence
and intended access separately. Existing immutable tags stop; no competing writer,
overwrite, `latest`, fallback package or public Release path is allowed.

With publication approval and access gates satisfied, log in using the approved
credential mechanism, tag the two verified local image IDs to exactly the names
above, then push each full-SHA tag using existing Docker commands. Record each
actual registry manifest digest and confirm it against the push result; Docker
image IDs, original index/config and registry manifests are distinct identities.
Immediately inspect private visibility/access after first creation. Retain partial
publication evidence and stop on any failure; never delete/overwrite to recover.
Verify an owner/deployment-only authenticated pull of the exact digest before any
separately authorized Hetzner staging. Host copy/pull, runtime/resource acceptance,
deployment and editor activation each remain pending until explicitly approved.
Customers must never receive independent image/archive/source-bundle copies under
this private-use path; changed recipients require a fresh distribution review.

[GitHub Container Registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
supports the default-private statement; live package settings/access still need
verification during a future approved execution.

Focused offline checks:
`python3 -B -m unittest discover -s tools/cooked-worker -p publication_test.py`
and `node --test tools/cooked-worker/stage-runtime.test.cjs`.
