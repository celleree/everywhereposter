# Post Everywhere Operating Notes

Persistent operational notes for Post Everywhere work. These are intended to prevent repeated environment mistakes and preserve context across sessions.

## Frequent Notes

- Arundel prefers one step at a time, especially for server and development tasks. Avoid long command dumps unless requested.
- For Post Everywhere work, the correct live working environment is usually Hetzner SSH at `/home/arund/publish-everywhere-git`, not local WSL.
- Avoid starting Docker Desktop, the local WSL Postiz stack, or local cloudflared on the PC unless intentionally working locally. A duplicate local tunnel previously caused Cloudflare to route traffic to the wrong stack.
- Before coding sessions, check `git status --short` and `git log -5 --oneline`.
- The current active branch is `snapshot/local-working-state-2026-04-29`.
- Use VS Code SSH for editing, but use the Hetzner console for heavy Docker builds. VS Code SSH disconnected during builds; the Hetzner console is safer.

## Rare but Important Notes

- The Hetzner server has only 4 GB RAM, so Docker and Next.js builds may need extra swap. `/swapfile2` was added for this.
- Instagram posting fixes are committed through `23d45941`. The current repo `HEAD` after planning docs is `eb770cf9`.
- Instagram image posts now work, but images must use a valid feed aspect ratio unless normalization is added. Square images and 4:5 portrait images work. Very tall images, such as `666x1000`, fail validation.
- If Instagram posts appear live but Publish Everywhere says they failed, check the post-publish permalink lookup.
- The public URL is fixed as `https://publisheverywhere.halowebsites.com` and should not be changed casually because OAuth, Meta, and app config depend on it.
- Required environment variable names on Hetzner include `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and public URL variables. Do not commit secrets.
