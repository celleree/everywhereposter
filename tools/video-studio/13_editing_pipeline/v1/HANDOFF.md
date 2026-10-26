# Historical pilot handoff

This document below is historical evidence, not acceptance of the accessible
profile. Current contract and runtime requirements are in README.md, CONTRACT.md
and SOURCE-RUNTIME-MANIFEST.md. Historical private effect exports cannot be
re-created by the accessible profile and are not silently substituted.
# Combined editing pilot — completed handoff

Executor: arund, Ubuntu WSL. Root was the sole implementation owner; helpers
provided disjoint read-only editorial and technical review. Studio is not a Git
repository. No application changes or PR were created.

Project root: `/home/arund/EverywherePoster-Video-Studio/13_editing_pipeline/v1`.
Accepted output project: `projects/talking-head-v2`.
Preview: http://127.0.0.1:4381 (restart with `node run.mjs serve projects/talking-head-v2`).
Final: `projects/talking-head-v2/final.mp4`.
Windows delivery: `C:\Users\arund\Downloads\EverywherePoster-AI-Directed-Talking-Head\EverywherePoster-Complete-Talking-Head-v1.mp4`.

Completed: original 117.433s recording and Cooked provenance verified; one shared
project for ordered cuts, 291 caption words, observed speaker geometry, 3 B-roll
cues and 3 effect instances. Codex supplied narration/asset-aware creative direction.
Remotion Player/export share Film; FFmpeg prepares original-source audio and muxes.
Two used effect types are DynamicChecklist and ImageCollage; other library adapters
are not all accepted through this runner. See README for exact limits.

Output: 89.566667s, 2687 frames, 1440×2560/30fps H.264/AAC, 183720083 bytes.
SHA256: e0a71d3e8108f2b5ed4f7ace31485ef05c4ff52f4f8e4b049517852def07672b.
Project SHA256: 800d12357f7d8bd7d4e1c78d7030c7a325aa6a4bbbe7c804f19e35d975857777.

Evidence: 13 focused tests; TypeScript; independent focused review and repairs;
complete final decode; original-resolution/frame-count checks; 0ms audio lag with
0.999924 correlation; 6 unobscured-picture SSIM samples 0.984801–0.994250;
8 encoded visual samples; SHA-matched Windows delivery; verified download and HTTP
range requests. Source remains hash-identical. See project `qa/` receipts.

Preview revision fixed slow original B-roll playback by adding a 720×1280 proxy.
All five export chunks were reused; original and revised exports are byte-identical.
Initial render: 15m40s wall time; revised cached assembly: about 10s. Token usage
and monetary cost were not measured. No paid API calls or new dependencies.

Browser: muted visual playback, B-roll seeking and >60s progression passed; 390px
phone viewport has no horizontal overflow. Unmuted headless audio encountered an
output-device error; audible browser listening is not verified. Final waveform QA
passed independently. Human continuous review and creative approval remain pending.

Boundaries preserved: no social posting, app edits, production activation,
destructive source edits or earlier-project overwrites. Reels 2–5 already existed
privately in Drive; their current file metadata and folder were verified.

User direction: single-user AI editing, no manual timeline required. Shared project
means tools exchange cuts/assets/captions/effects. Preserve scripts and opening hook;
prioritize B-roll, contextual motion, speaker protection and final review.

This is a completed local representative edit, not an unattended new-upload app.
Future runner/font changes require fresh render and QA; the download guard does not
automatically invalidate renderer-only changes. Keep this accepted revision frozen.
Next bounded action: user reviews this finished edit; any requested change goes into
a new project revision and reuses unaffected chunks. Wider upload automation,
all-effect adapter acceptance and multi-speaker editing remain separate work.
