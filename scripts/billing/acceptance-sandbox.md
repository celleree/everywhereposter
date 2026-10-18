# Local Stripe test acceptance helper

**External acceptance: NOT RUN.** This helper combines the reviewed sandbox adapter
with the reviewed late-refund reconciliation repair. Offline checks use synthetic
keys, generated signatures and fake SDK objects; evidence is OFFLINE_SIMULATED.
They do not prove provider forwarding or external end-to-end acceptance.

The helper calls the wallet, Checkout and refund services directly. It never boots
the app, loads .env, migrates a database, calls paid AI, creates a provider refund,
deletes a provider object or configures production. acceptance-offline.cjs is unchanged.

## Prerequisites still outstanding

The smallest next user action is to **confirm computer access**. Computer access
alone does not satisfy the remaining prerequisites:

- An unrecorded native WSL terminal with installed Python/Node, and independent
  HIGH review PASS for the exact clean committed HEAD.
- The intended Sandbox's explicitly approved full acct_ ID. Its name alone is
  insufficient; the intended ID is currently unknown.
- An existing test/restricted key allowing the actual SDK account/event/refund/
  session reads and Customer/Checkout writes used here. No key, grant or permission
  has been created or changed. Do not enter or send a key now.
- A separately approved, working signed-event transport to the known endpoint
  http://127.0.0.1:55500/stripe, with its matching whsec_. Stripe CLI is not installed
  or configured. Manual Dashboard actions alone cannot forward to 127.0.0.1.
  No forwarder setup/start, webhook registration or transport approval has occurred.
- A fresh task-owned disposable PostgreSQL database with existing migrations
  explicitly applied. Verification fixtures are removed after verification; they
  are not available for an operator run. The helper refuses all existing tenants,
  including an interrupted run, and never resets or deletes audit rows.

The database URL must use isolated:isolated, 127.0.0.1, dedicated port 49152-65535,
database ep_ai_wallet_test and no query/fragment. The listener port must also be
49152-65535 and differ from the database port. Both launch layers validate it;
the listener always binds 127.0.0.1. The known endpoint permits future approved
transport setup before hidden credential entry; choosing a port does not set it up.

## Manual Dashboard workflow, once prerequisites are separately approved

From the unrecorded native WSL terminal, select a new private evidence directory
outside the checkout and the newly prepared disposable fixture:
```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 \
  python3 -I scripts/billing/acceptance-sandbox.py \
  --expected-account acct_EXPLICIT_APPROVED_ID \
  --fixture postgresql://isolated:isolated@127.0.0.1:55489/ep_ai_wallet_test \
  --listen-port 55500 \
  --evidence /home/arund/dev/NEW_PRIVATE_EVIDENCE_DIRECTORY
```

1. Enter the approved existing sk_test_/rk_test_ and matching whsec_ only at hidden
   prompts. TTY/getpass echo fallback fails closed. Never put secrets in arguments,
   .env, chat, screenshots, logs or history. The minimal child environment excludes
   proxy, API-host, Connect, preload and AI configuration. Process memory is not
   securely zeroized.
2. The installed SDK verifies the **current account** using accounts.retrieve()
   without an account argument. Mismatch stops before case/customer/Checkout writes.
   Confirm the signed listener is ready and the approved transport actually works;
   then enter `confirm-forwarder-ready` and `purchase usd_500`.
3. Complete that TEST Checkout manually in the browser. There is one synthetic
   LAUNCH_V1 organization and one $5 topup, with at most three explicit attempts
   using the same operation/idempotency keys and no SDK automatic retries. The URL
   appears only on the terminal. A return redirect grants no credit. Wait for the
   genuine signed funding event and verify `status` shows one funding entry.
4. Enter `request-refund` to place the full unused-balance hold. Only with separate
   authorization, manually issue the full TEST refund to the original payment
   method in the approved Dashboard. The helper has no Refund.create capability.
5. Genuine own-case signed refund events dispatch immediately. After signed
   terminal success arrives, enter `review re_ACTUAL_ID ch_ACTUAL_ID`. This reads
   the actual refund, checks PI/charge/full $5/currency, then invokes explicit local
   review. Clean complete history and the existing full hold can reconcile money:
   one reversal, requestStatus REFUNDED, reconciliationState SUCCEEDED, balance and
   held value zero. The wallet remains REVIEW; refundOutcome is
   MONETARILY_RECONCILED_WALLET_FROZEN. No wallet unfreeze is implied.
6. Inspect `status`, then `quit`. Pending/no terminal proof, failed/disputed,
   ambiguous or old incomplete history stays blocked with held value and no
   reconciliation. A later contradiction after debit leaves requestStatus REFUNDED
   but reconciliationState UNCERTAIN and DEBIT_RECORDED_REVIEW_REQUIRED; that is
   not clean success. Duplicate delivery/review cannot create a second reversal.

Every accepted event must match events.retrieve() under the verified current
account, including ID/type/testmode/account/object fingerprint. Only the original
raw signed HTTP event dispatches; API objects serve identity checks. Early own-case
refunds use a read-only bound-session PI lookup and immediately reach quarantine.
There is no holding, suppressing, queueing, re-signing, reordering or API-read
substitution for genuine delivery. Both dispute funds events reach quarantine.

HTTP evidence is SIGNED_HTTP_ACCOUNT_VERIFIED_TRANSPORT_UNATTESTED: signatures and
account lookup cannot distinguish provider forwarding from a valid local replay.
Provider delivery provenance needs separate evidence before any provider-forwarded
end-to-end PASS claim. Signed local replay never establishes external acceptance.

## Evidence and focused local checks

A new mode-0700 directory holds mode-0600 redacted evidence: safe IDs, counters,
HEAD, fingerprints, wallet/request/reconciliation states and refund outcome. No key,
signature, raw payload, customer PII or Checkout URL is saved; errors are suppressed.
`quit` closes only this listener/Prisma connection. Synthetic rows and immutable
audit remain until the owner removes its identified fixture after retaining evidence.
No external objects are deleted; an interrupted run needs a fresh fixture.

With installed dependencies and a fresh migrated disposable database:
```sh
python3 -B -I scripts/billing/acceptance-sandbox-launcher.test.py
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent \
  AI_WALLET_TEST_DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:55489/ep_ai_wallet_test \
  node --test scripts/billing/acceptance-sandbox.test.cjs
```
The Node test blocks outbound sockets except its explicit fixture and owned
loopback listener. All SDK objects are fake. It leaves synthetic database evidence
and removes only its temporary evidence files. Listener unit tests may use port 0;
the operator launcher always requires the explicit known high port.
