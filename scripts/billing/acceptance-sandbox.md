# Local Stripe test acceptance helper

This additive operator helper uses the frozen PR234 wallet, Checkout and refund
services directly. It never boots the app, loads .env, migrates a database, calls
paid AI, creates a refund, deletes a provider object or configures production.
The existing acceptance-offline.cjs remains unchanged.

**Current result: external acceptance NOT RUN.** Offline tests use generated
signatures and fake SDK objects and label evidence OFFLINE_SIMULATED. They do not
prove provider-forwarded delivery or successful live refund acceptance.

## Preconditions and secure entry

Use only after focused offline checks and independent HIGH review PASS for the
exact clean committed HEAD. No actual credentials were used to prepare this helper.

An operator must supply the explicitly approved expected acct_ ID and an empty,
task-owned disposable PostgreSQL database with the already checked-in migrations
applied locally. The URL must have isolated:isolated credentials, 127.0.0.1, an
explicit dedicated port 49152-65535, database ep_ai_wallet_test, no query/fragment.
The helper refuses existing tenants, including an interrupted prior run. It does
not prepare schema, reset, resume or clean existing database rows.

From an unrecorded native WSL terminal, use the installed Python and Node:
```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 \
  python3 -I scripts/billing/acceptance-sandbox.py \
  --expected-account acct_EXPLICIT_APPROVED_ID \
  --fixture postgresql://isolated:isolated@127.0.0.1:55485/ep_ai_wallet_test \
  --evidence /home/arund/dev/NEW_PRIVATE_EVIDENCE_DIRECTORY
```

The launcher requires a TTY and getpass with echo disabled; echo fallback aborts.
Enter STRIPE_SECRET_KEY (sk_test_ or rk_test_) and STRIPE_SIGNING_KEY (whsec_) only
at the hidden prompts. Never place them in shell arguments, .env, history, files,
chat, screenshots or logs. The clean child environment contains these keys only
during execution. No production credentials, proxy, API-host, Connect override or
AI-provider configuration is inherited. This relies on the local OS/process trust
boundary; environment memory is not securely zeroized.

The official installed SDK reads the **current** account with accounts.retrieve()
(no account argument). A mismatch stops before local case/customer/Checkout
creation. Every accepted HTTP event must also exist via events.retrieve() using
that verified account key, with matching event ID/type/testmode/account/object
fingerprint. Mutable pending_webhooks is excluded. Only the original raw signed
HTTP event reaches the production service; retrieved objects are identity checks.

## Operator actions and transport blocker

The helper prints a randomly selected loopback-only /stripe endpoint. It exposes
only POST /stripe; no browser/HTTP control route or URL control token exists.
A Stripe CLI/approved forwarder is **not installed/configured by this helper**.
No webhook registration, account/key/grant creation or external forwarding has
been performed. A chosen free port alone is not a working external transport.

After separately authorized forwarding is actually ready, enter
`confirm-forwarder-ready` in the terminal, then `purchase usd_500`. The helper
permits one synthetic LAUNCH_V1 local organization and one $5 USD topup, at most
three explicit attempts with the same durable/provider idempotency keys. SDK
automatic network retries are disabled. The Checkout URL is shown only on the
terminal and is excluded from evidence. Complete hosted test Checkout manually;
the intentionally unused loopback return URL grants no credit. This helper does
not log into a browser or authenticate from mobile/dashboard sessions.

`status` prints local IDs, counters and wallet status. `request-refund` places the
existing service's local full unused-balance hold. An operator may separately
create the test refund manually in the approved Dashboard. The optional terminal
`review re_ACTUAL_ID ch_ACTUAL_ID` reads the actual refund, checks the case PI,
charge, full $5 amount/currency, then invokes the existing local review service.
There is no Refund.create capability or automatic refund operation.

**Refund lifecycle architecture blocker:** reviewTestTopup requires the actual
re_ ID, which does not exist before Stripe creates a refund. Genuine refund
events may arrive first. This listener immediately dispatches them, producing
REVIEW/BLOCKED_REFUND_RECONCILIATION with held value and no reversal; subsequent
review rejects prior refund/dispute evidence. This helper does not hold, suppress,
re-sign, reorder events, alter financial contracts or promise that ordering can
pass. Early own-case refunds before funding are matched through a read-only
bound-session PI lookup and immediately reach production quarantine.

Saved HTTP evidence is labeled
SIGNED_HTTP_ACCOUNT_VERIFIED_TRANSPORT_UNATTESTED: signature plus current-account
event lookup proves event authenticity/account identity, but cannot distinguish
actual provider forwarding from a valid local replay. API retrieval and synthetic
fixtures are never labeled live webhook completion. Provider delivery provenance
must be established separately before claiming provider-forwarded end-to-end PASS.

## Evidence, shutdown and focused checks

A new mode-0700 directory contains mode-0600 append-only redacted evidence:
IDs, counts, fingerprints, status and HEAD only. No key, signature, raw payload,
customer PII or Checkout URL is persisted. Provider exception details are suppressed.

`quit` closes only this listener and Prisma connection. Local synthetic rows and
immutable audit records remain for inspection. The owning parent/operator disposes
only its identified fixture container after evidence is retained. No external
objects are deleted. Interrupted runs require a separately recreated empty fixture.

Offline focused commands (installed dependencies only; fresh isolated DB required):
```sh
python3 -B -I scripts/billing/acceptance-sandbox-launcher.test.py
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent \
  AI_WALLET_TEST_DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:55485/ep_ai_wallet_test \
  node --test scripts/billing/acceptance-sandbox.test.cjs
```
The Node test blocks outbound sockets except its explicit disposable fixture and
owned loopback listener. Prisma connects only to the validated fixture; all SDK
objects are fake. Tests leave synthetic database evidence and remove only their
own temporary evidence files.
