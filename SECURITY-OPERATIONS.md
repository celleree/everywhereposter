# Security Operations

> Current-source rule: this document covers host security and post-maintenance validation only. For application deployment, use `OPERATING-MANUAL.md` and `docs/production-handoff-2026-05-11.md`.

This checklist covers the Hetzner host at `46.62.170.47` and the public app at `https://app.everywhereposter.com`.

## Admin Access

- SSH entrypoint: `ssh arund@46.62.170.47`
- Escalation: `sudo -n <command>`
- Root SSH is intentionally disabled.
- Password-based SSH is intentionally disabled.

## Weekly Host Review

Run from your local shell:

```bash
ssh arund@46.62.170.47 'sudo -n journalctl -u ssh --since "7 days ago" --no-pager | tail -n 100'
ssh arund@46.62.170.47 'sudo -n fail2ban-client status sshd'
ssh arund@46.62.170.47 'sudo -n apt list --upgradable'
```

What to look for:

- Expected `Accepted publickey for arund` entries
- Ongoing bot noise is normal
- No successful password logins
- `fail2ban` jail `sshd` stays active
- Upgrade list stays empty or limited to low-risk packages until the next maintenance window

## After Any Compose or Network Change

Run from your local shell:

```bash
for p in 22 4007 7233 8080 8969; do
  printf '== %s ==\n' "$p"
  (timeout 5 bash -lc "</dev/tcp/46.62.170.47/$p" && echo open) || echo closed
done

curl -sS -I --max-time 15 https://app.everywhereposter.com/auth | tr -d '\r'
curl -sS -I --max-time 15 https://app.everywhereposter.com/api | tr -d '\r'
curl -sS --max-time 15 https://app.everywhereposter.com/.well-known/oauth-authorization-server | head
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://app.everywhereposter.com/mcp
```

Expected result:

- `22` is open
- `4007`, `7233`, `8080`, and `8969` are closed externally
- `/auth` returns `200`
- `/api` returns `308` to `https://app.everywhereposter.com/api/`
- `/.well-known/oauth-authorization-server` returns `200` JSON
- `/mcp` returns `401` when called without an API key

## On-Host Validation

Run after maintenance or a reboot:

```bash
ssh arund@46.62.170.47 'sudo -n bash -lc '"'"'
systemctl is-active ssh docker ufw fail2ban
echo ---
cd /home/arund/publish-everywhere-git && docker compose ps
echo ---
ss -tulpn | egrep "(:22 |:4007 |:7233 |:8080 |:8969 )|Local Address:Port" || true
echo ---
fail2ban-client status
echo ---
fail2ban-client status sshd
echo ---
uname -r
'"'"''
```

Expected result:

- `ssh`, `docker`, `ufw`, and `fail2ban` are all `active`
- Docker services are running as expected
- `4007`, `7233`, `8080`, and `8969` are bound only on `127.0.0.1`
- `fail2ban` shows the `sshd` jail as active

## SSH Validation

Run from your local shell:

```bash
ssh -o BatchMode=yes arund@46.62.170.47 'whoami && sudo -n true && echo sudo-ok'
ssh -o BatchMode=yes -o ConnectTimeout=8 root@46.62.170.47 'echo root-login-worked' || true
ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o KbdInteractiveAuthentication=no -o NumberOfPasswordPrompts=0 -o ConnectTimeout=8 arund@46.62.170.47 'echo password-auth-worked' || true
```

Expected result:

- `arund` login succeeds
- `sudo-ok` prints
- Root SSH is denied
- Password-only SSH is denied

## Deployment Boundary

Do not deploy from this document.

Current application deployment is:

1. Merge through a pull request into `main`.
2. Let GitHub Actions build and publish the exact full-SHA GHCR image.
3. Pull that exact image on Hetzner.
4. Retag it as `publish-everywhere/postiz-app:custom`.
5. Recreate only the `postiz` service without building on the server.
6. Verify logs, image identity, registration state, and public HTTP behavior.

Use these sources for the exact commands and rollback procedure:

- `OPERATING-MANUAL.md`
- `docs/production-handoff-2026-05-11.md`

The following historical patterns are obsolete and must not be used:

- `/opt/publish-everywhere`
- `git pull` followed by an on-server Docker build
- `docker compose up -d --build`
- the standalone frontend overlay deployment flow
- deployment from an old snapshot branch

## Recovery Notes

- Rollback snapshot created on `2026-04-08`: `/root/security-snapshots/20260408T211645Z`
- Canonical checkout: `/home/arund/publish-everywhere-git`
- If SSH hardening ever misfires, use the Hetzner web console as the recovery path.
