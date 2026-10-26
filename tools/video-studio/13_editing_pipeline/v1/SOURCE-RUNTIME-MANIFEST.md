# Source and runtime custody

Canonical app base: 422ebb473d55c44ff911e40c5d2220f06bd8a47a.
Preserved Studio chain imported as an isolated dependency commit from
2f2aa9580e6fdf1eaf8c6b06b954658894363beb. Historical PR264 remains untouched.
Only tools/video-studio/13_editing_pipeline/v1 is owned by this change.

Accessible adapters derive from the actual user-approved Easy project:
- sample src/index.tsx sha256 8b627b0a0083fd331cd9befd848a238331d4646285d19178b8029f9477cb4865
- full-film HeaderArt.tsx sha256 9f1d8cb1de774e54483d7dc7008e92318ab8725474d4abad92b4d6983305fdce
- EasyRelationship reuses the card/icon/connector composition idiom with generic
  flow/split/exchange data; EasyMediaPanels reuses bounded staged media panels.
- These are adaptations, not recovered private DynamicChecklist/ImageCollage code.

Owned fixture custody (media excluded from Git):
- Original Easy recording c14465a16bc8587bb36f36208828436fee8bcde379ca87795eddf6ad250a5c55, 59.633333s, 1440x2560, 30fps, 1789frames.
- Original B-roll 94157d4d76110972a06fc861d35bdd5e04282b1ddae3e10e4f36c01c4f39a748; existing approved broll-opening derivative 6e6535be4dd800ae254e5624d5aa3ff8739c1b62bca07d2cf5562f3b3cbf7b5e, frames150-219, 2.3s.
- Existing aligned sample words 39c0674287c6cda59aee6dd9b20ab5d3b441788d5404939aefe55f792a8d4daf,43words.
- Approved B audio-bearing sample 5664ce03f98fe51746e5fa685f0e65f4a57c297d959dbd46b9f9ce3e25b93c68; audio only is decoded, no voice processing added.
- Original cuts [632,701),[712,919),[934,1104) yield446frames/14.866667s.
- No raw uploaded footage or completed private video is committed.

Font: Liberation Sans Bold, existing Body-Bold.ttf sha256
3973aa5054fb467dd5627245d3dc82e37bf16fe075756156a570455871351582.
SIL OFL1.1 license in FONT-LICENSE.txt (existing license sha256
f32df582a2aab128c07b2f7e36e7b928dc5f6bd82657b905c04f91459f9e5cf9).
The historical CSS family alias EP Plex is preserved for layout code; it does
not claim that the loaded font is IBM Plex. No logo bitmap or unlicensed Arial
font is required; the review UI uses the text wordmark.

Runtime: Node22.12.0; owned Easy runtime already used Remotion4.0.530/React19.0.0,
now closed over this package's pinned npm lock. Python3.12.2, NumPy2.3.3,
Pillow11.3.0 (fixtures only); FFmpeg/ffprobe8.1.2. Existing owned Chrome Headless
Shell is configured explicitly, never rediscovered or automatically downloaded.
Its Windows executable sha256 is
ec76dc3e69ffab9daddf0bbe7bf0a9e0a034b2d086741a0ae2ef6358a597537b.
Binary hashes and actual installed package versions are recorded in each render.

Linux closure is unverified until an approved Linux executor runs the same
fixture render and QA with native binaries installed from the pinned manifests.
The current Windows Docker Linux engine pipe is absent. Do not copy Windows
binaries or assert Linux worker readiness based on metadata or Windows receipts.
