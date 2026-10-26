# Contextual footage acquisition v1

Scope: one trusted editor-selected, cleared HTTPS URL and intended context -> one
local acquisition owner/cache -> verified supporting asset -> a new owned-input
manifest for existing Studio prepare.py. No search service, app API, database
migration, account credentials, publishing action or editor network change.
Only this sibling directory is owned. Base cf215f4a.

## Runtime boundary

The downloader container uses network none. Its fixed loopback proxy relay reaches
only a pathname Unix socket mounted from the guarded gateway container. The gateway
alone has external networking and validates every CONNECT destination, pins the
validated public IPv4 address, allows only configured hostnames/443 and counts
all tunnel bytes/connections against one job budget. No HTTP forwarding, IPv6
transport, IP literals, private/mixed A records or unknown CDN hosts. HTTPS is
verified end-to-end by yt-dlp; the product never disables certificate checks.
The Docker launcher is trusted host code, not inside either worker. Containers
receive no Docker socket, app environment, home directory or broad host mounts.
Only this adapter source directory is mounted read-only into the offline validator.
Input bytes are streamed into its UID-owned private tmpfs; the host job stays 0700. All workers have bounded tmpfs, dropped
capabilities, non-root UID, no published ports and no-new-privileges.

This topology is implemented, NOT yet Linux-verified. No Windows fallback or
host firewall change exists. Missing Docker/native Linux prerequisites fail.

## Build and configure (CI/runtime owner)

Build context is this directory:

    docker build -f runtime/Dockerfile -t studio-footage-downloader .

Official Python image and official yt-dlp release/checksum are pinned in
runtime/tools.lock.json. Build checks downloaded yt-dlp bytes. No runtime updates,
plugins, remote components, browser cookies, netrc or executable hooks. Initial
profile disables JS runtimes: sources requiring a JS challenge/authentication
fail rather than fetching components or harvesting credentials. Only combined
native formats are selected; there is no external FFmpeg network downloader.
Some providers/formats are intentionally unsupported in this first slice.

Set both runtime/config.example.json image references to reviewed immutable image
digests. downloaderImage is the built adapter image. offlineImage MUST be an
approved Linux Studio runtime with python on PATH and /usr/bin/ffmpeg plus
/usr/bin/ffprobe with libx264. This image is a runtime-owner prerequisite; none
is invented or auto-pulled by the adapter build. CI must supply/verify it before
claiming end-to-end readiness. Docker's normal run may pull the configured digest;
no floating tag is accepted.

## Trusted request and policy

Request example (shape example, no live footage permission):

    {"schemaVersion":1,"requestId":"req1","projectId":"project1","revision":1,
     "authorizationScope":"owner1","url":"https://media.example.com/owned.mp4",
     "interval":[1,3],"outputFrom":30,"anchorWord":"w0",
     "context":"Illustrate the narrated work","use":"illustrative",
     "rights":{"status":"approved","scope":"owner1","basis":"owned",
       "evidence":"Permission record ID","attribution":"Owner"}}

The app/editor must authorize the scope and rights record; strings in this
worker-internal schema are not authentication. Never place credentials, signed
permission links or private purchase documents in the request. Downloadability
is not permission. Rights are carried into an immutable receipt and bound into
the new manifest's provenance. Evidence use additionally requires the trusted
caller to set contentVerified:true after checking actual content. Illustrative
assets still require user creative review; receipt readiness is technical only.

Policy example:

    {"hosts":["media.example.com"],"trafficBytes":262144000,
     "assetBytes":104857600,"sourceSeconds":600,"coverageSeconds":30,
     "acquisitionSeconds":120,"normalizeSeconds":60,"connections":64}

Hosts include explicitly approved extractor/CDN destinations; no auto-widening.
Coverage is configurable by the trusted policy, not a fixed creative limit.
Initial behavior downloads a bounded whole source, then trims offline and
normalizes a separate silent H.264/CFR30 supporting clip. No source-voice DSP.
Limits fail closed. Socket timeout15s and at most one transport retry stay inside
the acquisition deadline. Gateway counts encrypted tunnel bytes in both directions;
in-flight TCP/kernel buffers can exceed the forwarding ceiling by a bounded
read window. Whole normalization stage has an outer deadline and kernel disk cap.

## Commands

    python acquire.py --request REQUEST.json --policy POLICY.json --runtime RUNTIME.json --cache NEW_OR_EXISTING_PRIVATE_CACHE
    python compose_manifest.py --manifest OWNED_INPUT.json --request REQUEST.json --policy POLICY.json --cache CACHE --output NEW_OWNED_INPUT.json
    python ../../13_editing_pipeline/v1/prepare.py --manifest NEW_OWNED_INPUT.json --output NEW_PROJECT --runtime STUDIO_RUNTIME.json

CLI success0, failure1, argparse usage2. Output manifest is exclusive-created;
existing source/audio/font inputs are retained. It increments the project revision,
registers a local hashed video and a narration-anchored B-roll event. It does not
invoke rendering, alter the source EDL, replace speech or mark creative approval.

Cache holds one immutable derived asset.mp4 and receipt.json per exact URL,
rights/scope, policy and requested interval. Context/placement differences reuse
those bytes. One local exclusive owner serializes concurrent requests, whose
waiters recheck the cache after release. Different URLs/intervals do not currently
converge, even if they might be aliases or overlapping coverage. No global
content store, source-version polling or distributed exactly-once guarantee.
A crashed owner lock fails closed; operator reviews/removes that one stale lock
only after proving the previous owner is gone. Corrupt records are never reused
or overwritten automatically. Unique partial job directories are removed on
failure; container cleanup targets only generated names; cleanup failures are surfaced and prevent cache publication. Cache must be private
and trusted, not writable by untrusted users or other tenants.

Receipt binds cacheKey, asset hash, acquired input hash, actual media facts/coverage,
source identity/redacted URL plus URL digest, rights and digest, policy, image
references, tools-lock hash and retrieval time. It never stores the original
source query string. Compose adds receipt path/hash to provenance.acquiredAssets;
existing prepare.py binds that complete manifest hash into preparation custody.
No ready asset is claimed solely from a downloader success code.

## Verification and handoff

    python -m unittest discover -s tests -v

Current unit tests use an injected fake runtime with clearly synthetic bytes;
they prove contracts, duplicate ownership, cache integrity, cleanup and policy
logic, NOT actual media validity or a working container tunnel. The opt-in
FOOTAGE_TEST_IMAGE (digest-pinned) runs a real Linux direct-child no-route smoke.
No CI workflow changes are included here; CI owner owns the remaining gates:

1. Build the pinned downloader image; provide approved offline image and digest.
2. Run actual network-none + Unix-socket gateway/relay topology: TLS-verified
   controlled generated HTTPS footage -> download -> offline probe/normalize/full
   decode -> new manifest -> unchanged Studio prepare and small renderer fixture.
3. Verify private/redirect/rebinding denials and proxy-bypass denial from the
   downloader AND a child process. No real private service need be contacted.
4. Verify byte/deadline/temp-storage exhaustion and cancellation clean only owned
   containers/volumes/jobs and never publish a partial ready receipt.

Controlled HTTPS success may use a disposable isolated Linux test network with
synthetic public-address routing and a test-only CA. Do not add a production
private-IP exception or disable product TLS verification to make tests pass.
No live third-party source is currently cleared or acquired. This package is
not runtime-ready until those positive/negative Linux gates pass.
