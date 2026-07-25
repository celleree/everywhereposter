# Deployment Notes

Deployment memory for EverywherePoster. `OPERATING-MANUAL.md` remains the source of truth; this file captures durable deployment lessons and reminders.

## Current Model

- GitHub Actions builds the app image.
- Deploy using the full commit SHA image from GHCR.
- Tag the exact pulled image locally as `publish-everywhere/postiz-app:custom`.
- Restart only the `postiz` container for app-only deploys.
- Confirm logs and manually verify the changed behavior.

## Safety Rules

- Do not use short SHAs for deployment.
- Do not prune Docker volumes casually.
- Do not run destructive Prisma/database commands in production.
- Do not treat GitHub Actions success alone as deployed.
- Do not start local WSL Docker/cloudflared unless local work is intentional.

## Entry Template

```md
## YYYY-MM-DD - Short Title

- Context:
- Finding:
- Safe command or check:
- Evidence:
```
