# Publish Everywhere

A single-repo Docker Compose deployment for running Publish Everywhere with the app source tracked in `postiz-app/`.

## Product Planning Docs

The repo now includes first-pass planning docs for the copy generation feature:

- `docs/copy-generation-prd.md`
- `docs/copy-generation-prompt-spec.md`
- `docs/voice-profile-schema.json`

These cover the recommended phase 1 build for:

- generating copy from image or video uploads
- making copy more platform-specific
- reducing common AI-sounding phrases
- personalizing output from transcript-based voice profiles stored in a knowledge base

## Watch the Tutorial for docker-compose install:
[https://m.youtube.com/watch?v=A6CjAmJOWvA&t=5s](https://m.youtube.com/watch?v=A6CjAmJOWvA&t=5s)

## Warning
If you are upgrading from Postiz old version, please make sure you update your docker compose, you can read more here:
https://docs.postiz.com/installation/migration

## Docker Compose

This guide assumes that you have docker installed, with a reasonable amount of resources to run Postiz. This Docker Compose setup has been tested with;

- Virtual Machine, Ubuntu 24.04, 2Gb RAM, 2 vCPUs.

<Snippet file="installation-pre-reqs.mdx" />

### Configuration uses environment variables

The docker containers for Postiz are entirely configured with environment variables.

- **Option A** - environment variables in your `docker-compose.yml` file
- **Option B** - environment variables in a `postiz.env` file mounted in `/config` for the Postiz container only
- **Option C** - environment variables in a `.env` file next to your `docker-compose.yml` file (not recommended).

... or a mixture of the above options!

There is a [configuration reference](/configuration/reference) page with a list
of configuration settings.

Repo layout:
```
publish-everywhere/
├── docker-compose.yaml
├── docker-compose.frontend-overlay.yaml
├── start-postiz.sh
├── nginx/
├── site/
└── postiz-app/
```

Setup:
```
git clone https://github.com/celleree/publish-everywhere
cd publish-everywhere
```

Then run:
```
docker compose up --build
```

Wait for it to load:
Open your website on https://publisheverywhere.halowebsites.com

Fresh clone note:

- This repo is now self-contained. You do not need a sibling `../postiz-app-upstream` checkout.
- The main app image is built from `./postiz-app` via `Dockerfile.dev`.
- If you use the standalone frontend overlay, it also builds from the same in-repo `./postiz-app` source.

## Multi-Account Support

This deployment can support multiple user accounts on the same Postiz instance.

- `DISABLE_REGISTRATION: 'false'` already allows additional users to sign up.
- Postiz upstream also supports team collaboration and member invites in the app.
- If you want invite or activation emails to work reliably, configure an email provider such as Resend or SMTP via the Postiz email settings.

Practical note:

- Multi-user access is controlled by Postiz itself, not by Docker Compose.
- If you need hard isolation between customers, brands, or teams, run separate Postiz instances instead of treating one instance as a strict multi-tenant deployment.
- Upstream currently has an open invite-flow bug for organization joins in self-hosted setups: [Issue #819](https://github.com/gitroomhq/postiz-app/issues/819).

---

## Meta Data Deletion

This deployment now includes both a public deletion-instructions page and a Meta-compatible callback/status flow for connected Facebook, Instagram, and Threads accounts.

- Public instructions page: `https://publisheverywhere.halowebsites.com/data-deletion`
- Meta Data Deletion Request URL: `https://publisheverywhere.halowebsites.com/api/public/meta/data-deletion`
- Meta callback status page format:
  `https://publisheverywhere.halowebsites.com/api/public/meta/data-deletion/status?code=<confirmation_code>`

What the callback does:

- validates Meta's `signed_request` using the configured app secret
- finds matching connected Meta channels by the app-scoped user ID Meta sends
- scrubs stored tokens/details and soft-deletes the matching integration records
- returns the human-readable status URL and confirmation code Meta expects

Public-use note:

- This covers repo-side callback handling, but you still need to enter the callback URL in the Meta app dashboard for each Meta app you ship.

Facebook Page permission upgrade note:

- Existing Facebook Page integrations must reconnect to grant `pages_read_user_content`.
- This permission is now requested alongside `pages_manage_engagement` so Publish Everywhere can honestly read Page comment content for connected Page posts during Meta review.

---

## AI Assistant Integrations

This deployment can now expose Postiz as an MCP server so users can manage channels and schedule posts from AI clients instead of only inside the web UI.

- Supported directly by the in-app Developers tab: Claude Code, Cursor, VS Code / Copilot, Windsurf, Amp, Codex, Gemini CLI, and Warp.
- Users can open `Settings -> Developers` in Postiz, copy their `pos_` API key, and paste the generated MCP config into their AI client.
- `MCP_URL` is set to the public app origin so the generated config points to `/mcp` instead of the `/api` base URL.
- `DISABLE_POSTIZ_MCP=false` keeps MCP enabled. Set it to `true` if you need to turn the feature off during troubleshooting.

Operator notes:

- MCP startup is patched to run in the background so a slow MCP bootstrap does not prevent the main app from starting.
- The reverse proxy now forwards `/mcp`, `/mcp-oauth`, legacy `/sse` and `/message`, and the OAuth discovery endpoints under `/.well-known/` directly to the backend.
- If you want to experiment with OpenAI app verification, set `OPENAI_APP_CHALLANGE` in `.env`. The upstream env name is spelled exactly that way.

Verification:

```bash
curl -sS --max-time 15 https://publisheverywhere.halowebsites.com/.well-known/oauth-authorization-server | jq .
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 https://publisheverywhere.halowebsites.com/mcp
```

Expected result:

- The OAuth authorization server endpoint returns `200` with JSON metadata.
- `/mcp` returns `401` without a bearer token, which confirms the route is live and protected.

ChatGPT note:

- Claude Code, Codex, Cursor, and similar MCP-capable tools can connect immediately through the generated config.
- ChatGPT compatibility depends on OpenAI's current external connector/app flow, so treat the MCP exposure here as the server-side foundation rather than a guarantee that every ChatGPT surface will attach to it directly.

---

## Example `docker-compose.yml` file

```yaml
services:
  postiz:
    image: publish-everywhere/postiz-app:custom
    build:
      context: ./postiz-app
      dockerfile: Dockerfile.dev
    container_name: postiz
    restart: always
    environment:
      # === Required Settings
      MAIN_URL: 'https://publisheverywhere.halowebsites.com'
      FRONTEND_URL: 'https://publisheverywhere.halowebsites.com'
      NEXT_PUBLIC_BACKEND_URL: 'https://publisheverywhere.halowebsites.com/api'
      JWT_SECRET: 'random string that is unique to every install - just type random characters here!'
      DATABASE_URL: 'postgresql://postiz-user:postiz-password@postiz-postgres:5432/postiz-db-local'
      REDIS_URL: 'redis://postiz-redis:6379'
      BACKEND_INTERNAL_URL: 'http://localhost:3000'
      TEMPORAL_ADDRESS: "temporal:7233"
      IS_GENERAL: 'true'
      DISABLE_REGISTRATION: 'false'
      DISABLE_POSTIZ_MCP: 'false'
      MCP_URL: 'https://publisheverywhere.halowebsites.com'

      # === Storage Settings
      STORAGE_PROVIDER: 'local'
      UPLOAD_DIRECTORY: '/uploads'
      NEXT_PUBLIC_UPLOAD_DIRECTORY: '/uploads'

      # === Cloudflare (R2) Settings
      # STORAGE_PROVIDER: 'cloudflare'
      # CLOUDFLARE_ACCOUNT_ID: 'your-account-id'
      # CLOUDFLARE_ACCESS_KEY: 'your-access-key'
      # CLOUDFLARE_SECRET_ACCESS_KEY: 'your-secret-access-key'
      # CLOUDFLARE_BUCKETNAME: 'your-bucket-name'
      # CLOUDFLARE_BUCKET_URL: 'https://your-bucket-url.r2.cloudflarestorage.com/'
      # CLOUDFLARE_REGION: 'auto'

      # === Social Media API Settings
      X_API_KEY: ''
      X_API_SECRET: ''
      LINKEDIN_CLIENT_ID: ''
      LINKEDIN_CLIENT_SECRET: ''
      # Optional: override only the LinkedIn Page flow with a separate app
      LINKEDIN_PAGE_CLIENT_ID: ''
      LINKEDIN_PAGE_CLIENT_SECRET: ''
      REDDIT_CLIENT_ID: ''
      REDDIT_CLIENT_SECRET: ''
      GITHUB_CLIENT_ID: ''
      GITHUB_CLIENT_SECRET: ''
      BEEHIIVE_API_KEY: ''
      BEEHIIVE_PUBLICATION_ID: ''
      THREADS_APP_ID: ''
      THREADS_APP_SECRET: ''
      FACEBOOK_APP_ID: ''
      FACEBOOK_APP_SECRET: ''
      INSTAGRAM_APP_ID: ''
      INSTAGRAM_APP_SECRET: ''
      YOUTUBE_CLIENT_ID: ''
      YOUTUBE_CLIENT_SECRET: ''
      TIKTOK_CLIENT_ID: ''
      TIKTOK_CLIENT_SECRET: ''
      PINTEREST_CLIENT_ID: ''
      PINTEREST_CLIENT_SECRET: ''
      DRIBBBLE_CLIENT_ID: ''
      DRIBBBLE_CLIENT_SECRET: ''
      DISCORD_CLIENT_ID: ''
      DISCORD_CLIENT_SECRET: ''
      DISCORD_BOT_TOKEN_ID: ''
      SLACK_ID: ''
      SLACK_SECRET: ''
      SLACK_SIGNING_SECRET: ''
      MASTODON_URL: 'https://mastodon.social'
      MASTODON_CLIENT_ID: ''
      MASTODON_CLIENT_SECRET: ''

      # === OAuth & Authentik Settings
      # NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME: 'Authentik'
      # NEXT_PUBLIC_POSTIZ_OAUTH_LOGO_URL: 'https://raw.githubusercontent.com/walkxcode/dashboard-icons/master/png/authentik.png'
      # POSTIZ_GENERIC_OAUTH: 'false'
      # POSTIZ_OAUTH_URL: 'https://auth.example.com'
      # POSTIZ_OAUTH_AUTH_URL: 'https://auth.example.com/application/o/authorize'
      # POSTIZ_OAUTH_TOKEN_URL: 'https://auth.example.com/application/o/token'
      # POSTIZ_OAUTH_USERINFO_URL: 'https://authentik.example.com/application/o/userinfo'
      # POSTIZ_OAUTH_CLIENT_ID: ''
      # POSTIZ_OAUTH_CLIENT_SECRET: ''
      # POSTIZ_OAUTH_SCOPE: "openid profile email"  # Optional: uncomment to override default scope

      # === Sentry

      # NEXT_PUBLIC_SENTRY_DSN: 'http://spotlight:8969/stream'
      # SENTRY_SPOTLIGHT: '1'

      # === Misc Settings
      OPENAI_API_KEY: ''
      # Optional: used only if you want to verify an OpenAI app challenge
      OPENAI_APP_CHALLANGE: ''
      NEXT_PUBLIC_DISCORD_SUPPORT: ''
      NEXT_PUBLIC_POLOTNO: ''
      API_LIMIT: 30

      # === Payment / Stripe Settings
      FEE_AMOUNT: 0.05
      STRIPE_PUBLISHABLE_KEY: ''
      STRIPE_SECRET_KEY: ''
      STRIPE_SIGNING_KEY: ''
      STRIPE_SIGNING_KEY_CONNECT: ''

      # === Developer Settings
      NX_ADD_PLUGINS: false

      # === Short Link Service Settings (Optional - leave blank if unused)
      # DUB_TOKEN: ""
      # DUB_API_ENDPOINT: "https://api.dub.co"
      # DUB_SHORT_LINK_DOMAIN: "dub.sh"
      # SHORT_IO_SECRET_KEY: ""
      # KUTT_API_KEY: ""
      # KUTT_API_ENDPOINT: "https://kutt.it/api/v2"
      # KUTT_SHORT_LINK_DOMAIN: "kutt.it"
      # LINK_DRIP_API_KEY: ""
      # LINK_DRIP_API_ENDPOINT: "https://api.linkdrip.com/v1/"
      # LINK_DRIP_SHORT_LINK_DOMAIN: "dripl.ink"

    volumes:
      - postiz-config:/config/
      - postiz-uploads:/uploads/
    ports:
      - "4007:5000"
    networks:
      - postiz-network
      - temporal-network
    depends_on:
      postiz-postgres:
        condition: service_healthy
      postiz-redis:
        condition: service_healthy

  postiz-postgres:
    image: postgres:17-alpine
    container_name: postiz-postgres
    restart: always
    environment:
      POSTGRES_PASSWORD: postiz-password
      POSTGRES_USER: postiz-user
      POSTGRES_DB: postiz-db-local
    volumes:
      - postgres-volume:/var/lib/postgresql/data
    networks:
      - postiz-network
    healthcheck:
      test: pg_isready -U postiz-user -d postiz-db-local
      interval: 10s
      timeout: 3s
      retries: 3
  postiz-redis:
    image: redis:7.2
    container_name: postiz-redis
    restart: always
    healthcheck:
      test: redis-cli ping
      interval: 10s
      timeout: 3s
      retries: 3
    volumes:
      - postiz-redis-data:/data
    networks:
      - postiz-network

  # For Application Monitoring / Debugging
  spotlight:
    pull_policy: always
    container_name: spotlight
    ports:
      - 8969:8969/tcp
    image: ghcr.io/getsentry/spotlight:latest
    networks:
      - postiz-network

  # -----------------------
  # Temporal Stack
  # -----------------------
  temporal-elasticsearch:
    container_name: temporal-elasticsearch
    image: elasticsearch:7.17.27
    environment:
      - cluster.routing.allocation.disk.threshold_enabled=true
      - cluster.routing.allocation.disk.watermark.low=512mb
      - cluster.routing.allocation.disk.watermark.high=256mb
      - cluster.routing.allocation.disk.watermark.flood_stage=128mb
      - discovery.type=single-node
      - ES_JAVA_OPTS=-Xms256m -Xmx256m
      - xpack.security.enabled=false
    networks:
      - temporal-network
    expose:
      - 9200
    volumes:
      - /var/lib/elasticsearch/data

  temporal-postgresql:
    container_name: temporal-postgresql
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: temporal
      POSTGRES_USER: temporal
    networks:
      - temporal-network
    expose:
      - 5432
    volumes:
      - /var/lib/postgresql/data

  temporal:
    container_name: temporal
    ports:
      - '7233:7233'
    image: temporalio/auto-setup:1.28.1
    depends_on:
      - temporal-postgresql
      - temporal-elasticsearch
    environment:
      - DB=postgres12
      - DB_PORT=5432
      - POSTGRES_USER=temporal
      - POSTGRES_PWD=temporal
      - POSTGRES_SEEDS=temporal-postgresql
      - DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/development-sql.yaml
      - ENABLE_ES=true
      - ES_SEEDS=temporal-elasticsearch
      - ES_VERSION=v7
      - TEMPORAL_NAMESPACE=default
    networks:
      - temporal-network
    volumes:
      - ./dynamicconfig:/etc/temporal/config/dynamicconfig
    labels:
      kompose.volume.type: configMap

  temporal-admin-tools:
    container_name: temporal-admin-tools
    image: temporalio/admin-tools:1.28.1-tctl-1.18.4-cli-1.4.1
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_CLI_ADDRESS=temporal:7233
    networks:
      - temporal-network
    stdin_open: true
    depends_on:
      - temporal
    tty: true

  temporal-ui:
    container_name: temporal-ui
    image: temporalio/ui:2.34.0
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_CORS_ORIGINS=http://127.0.0.1:3000
    networks:
      - temporal-network
    ports:
      - '8080:8080'

volumes:
  postgres-volume:
    external: false

  postiz-redis-data:
    external: false

  postiz-config:
    external: false

  postiz-uploads:
    external: false

networks:
  postiz-network:
    external: false
  temporal-network:
    driver: bridge
    name: temporal-network
```

LinkedIn note:

- `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` continue to drive the standard LinkedIn member/profile connection.
- `LINKEDIN_PAGE_CLIENT_ID` and `LINKEDIN_PAGE_CLIENT_SECRET` are optional overrides for the `linkedin-page` flow only. If you leave them blank, Postiz falls back to the standard LinkedIn app.
- A LinkedIn developer verification URL is an operator-only approval link, not a public site-verification file. Keep it in your local `.env` for reference if needed rather than serving it from Nginx.
