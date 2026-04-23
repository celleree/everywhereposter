# Security Operations

This checklist captures the recurring commands for the Hetzner host at `46.62.170.47` and the public app at `https://publish-everywhere.halowebsites.com`.

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

curl -sS -I --max-time 15 https://publish-everywhere.halowebsites.com/auth | tr -d '\r'
curl -sS -I --max-time 15 https://publish-everywhere.halowebsites.com/api | tr -d '\r'
curl -sS --max-time 15 https://publish-everywhere.halowebsites.com/.well-known/oauth-authorization-server | head
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://publish-everywhere.halowebsites.com/mcp
```

Expected result:

- `22` is open
- `4007`, `7233`, `8080`, and `8969` are closed externally
- `/auth` returns `200`
- `/api` returns `308` to `https://publish-everywhere.halowebsites.com/api/`
- `/.well-known/oauth-authorization-server` returns `200` JSON
- `/mcp` returns `401` when called without an API key

## On-Host Validation

Run after maintenance or a reboot:

```bash
ssh arund@46.62.170.47 'sudo -n bash -lc '"'"'
systemctl is-active ssh docker ufw fail2ban
echo ---
cd /opt/publish-everywhere && docker compose ps
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
- Docker services are healthy
- `4007`, `7233`, `8080`, and `8969` are bound only on `127.0.0.1`
- `fail2ban` shows the `sshd` jail as active
- Kernel stays on the upgraded line, currently `6.8.0-107-generic`

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

## Maintenance Notes

- Rollback snapshot created on `2026-04-08`:
  `/root/security-snapshots/20260408T211645Z`
- App deployment directory:
  `/opt/publish-everywhere`
- Deploy from the single canonical repo at `/opt/publish-everywhere`; the app source now lives inside `/opt/publish-everywhere/postiz-app`.
- Standard deploy flow:

```bash
ssh arund@46.62.170.47 'cd /opt/publish-everywhere && git pull --ff-only && docker compose up -d --build'
```

- If the standalone frontend overlay is in use, deploy with:

```bash
ssh arund@46.62.170.47 'cd /opt/publish-everywhere && git pull --ff-only && docker compose -f docker-compose.yaml -f docker-compose.frontend-overlay.yaml up -d --build'
```

- If SSH hardening ever misfires, use the Hetzner web console as the recovery path.
