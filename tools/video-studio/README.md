# Video Studio source snapshot

`13_editing_pipeline/v1` preserves the combined Cooked, Codex direction, Remotion
and FFmpeg local pilot. Its original 11 files were 511 physical lines; the test
now uses a small synthetic fixture so no real per-video timeline is published.
The runtime files and original local milestone documents are preserved unchanged.
`HANDOFF.md` records the local rendering milestone before this GitHub snapshot.

## Run the source-only checks

From the repository root, using the repository's supported Node.js runtime:

```sh
node --test tools/video-studio/13_editing_pipeline/v1/tests/*.test.mjs
```

These checks validate project contracts. They do not render video or establish
real-media quality; the pilot README describes the earlier local render evidence.

## Rendering prerequisites

This snapshot is not a standalone installation or an application feature. Restore
the files into `13_editing_pipeline/v1` of the existing Video Studio workspace to
use its `12_effect_library/v1` and `v2` sources, installed JavaScript dependencies,
Cooked Python runtime with NumPy/Pillow, FFmpeg/ffprobe and local Chromium binary.
The runner retains that workspace's absolute runtime paths and relative imports.
Its package file intentionally does not provision third-party dependencies.

Original recordings, B-roll, font/logo files, projects, proxies, renders, caches
and dependency folders are excluded. Supply these locally before using the pilot
README's rendering commands. Codex supplies creative direction for each edit;
an unattended new-upload AI service is future work.
