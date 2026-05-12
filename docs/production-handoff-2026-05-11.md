# Production deployment handoff

This note captures production deployment facts that are not obvious from the Git repository itself.

## Public deployment

Public site:

```text
https://publisheverywhere.halowebsites.com
```

Final observed state after the 2026-05-11 deployment:

```text
Public site shows updated UI.
Floating legal bar is gone.
Profiles/data are intact.
postiz and public-web rebuilt successfully.
```

## Production server

```text
Provider: Hetzner
IP: 46.62.170.47
SSH host alias: publish-everywhere-hetzner
SSH user: arund
```

## Cloudflare Tunnel

```text
Tunnel name: publish-everywhere
Tunnel ID: c9487391-ac63-4934-b29d-06b1a1fd3801
Connector ID: 99da6331-a478-42d6-88f4-338e61ab87b1
Origin IP: 46.62.170.47
```

Important tunnel/container note:

```text
Cloudflare Tunnel is running from the Hetzner Docker stack, not the local Windows/WSL Docker stack.
Container: cloudflared-publish-everywhere
```

## Production paths

Production deployment folders on Hetzner:

```text
/opt/publish-everywhere
/opt/publish-everywhere/docker-compose.yaml
/opt/publish-everywhere/postiz-app
/opt/publish-everywhere/site/branding
/opt/publish-everywhere/nginx/privacy-site.conf
```

Important: these production folders are not Git checkouts:

```text
/opt/publish-everywhere
/opt/publish-everywhere/postiz-app
```

The running Docker Compose project builds the public app from:

```text
/opt/publish-everywhere/postiz-app
```

## Docker services

Main production containers:

```text
postiz
publish-everywhere-web
cloudflared-publish-everywhere
postiz-postgres
postiz-redis
```

Successful rebuild command used from `/opt/publish-everywhere`:

```bash
sudo docker compose -f docker-compose.yaml up -d --build --force-recreate postiz public-web
```

This rebuilt/recreated only `postiz` and `public-web`. It did not delete volumes or reset the database.

## Deployment method used on 2026-05-11

Local fixed branch:

```text
snapshot/local-working-state-2026-04-29
```

The local branch was pushed to GitHub, but Hetzner could not read the private GitHub repo over HTTPS without credentials. Because production is not Git-managed, deployment was done with `rsync`.

Process used:

```text
1. rsynced the local clean branch to Hetzner staging:
   /tmp/publish-everywhere-staging

2. Copied only these staged paths into production:
   postiz-app/
   site/branding/
   nginx/privacy-site.conf

3. Intentionally did not overwrite:
   /opt/publish-everywhere/docker-compose.yaml

4. Rebuilt only:
   postiz
   public-web
```

Important warning:

```text
Do not overwrite production docker-compose.yaml from the local branch without reviewing it first.
The local version includes safety/profile changes that may alter production behavior, including required env vars and Cloudflare tunnel profile handling.
```

## Backups created on Hetzner

```text
/home/arund/postiz-prod-backups/20260511T031011Z/publish-everywhere-full.tgz
/home/arund/postiz-prod-backups/20260511T031438Z/postiz-postgres-pg_dumpall.sql.gz
```

## SSH access issue solved

SSH initially failed because Fail2ban had banned the user's public IP.

```text
IP at the time: 136.52.69.219
```

Unban command used:

```bash
fail2ban-client set sshd unbanip 136.52.69.219
```

Server access state observed:

```text
No Hetzner Cloud firewall attached.
UFW allowed port 22.
sshd was listening on 0.0.0.0:22.
```

## Permission notes

```text
Use sudo for Docker commands.
Do not chmod/chown .cloudflared.
.cloudflared is root-owned and should stay protected.
```

The Docker socket required `sudo` for the `arund` user. Do not casually add the user to the Docker group on production; Docker group access effectively grants root-level control.

## Commands to avoid on production

Do not run these unless intentionally deleting/resetting data:

```bash
docker compose down -v
docker volume rm
docker volume prune
docker system prune --volumes
prisma migrate reset
prisma db push --force-reset
```

## Public verification command

This verification passed after deployment:

```bash
curl -ksL "https://publisheverywhere.halowebsites.com/branding/branding.js?v=20260510a" | grep -n "ensureLegalBar();" || echo "public legal bar call removed"
```

Expected and observed result:

```text
public legal bar call removed
```
