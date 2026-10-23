# Review one already-funded test refund with an absent charge refund list

This operator-only tool supplements immutable signed refund receipts with fresh,
current-account read-only Stripe evidence. It never creates a purchase or refund,
starts a listener, migrates a database, rewrites audit rows, or enables production
billing. Policy remains provisional: credits never expire; full original-method
refund of one entirely unused identifiable top-up; company bears ordinary fees;
administrative review required. Partial spending, mixed funding, partial refunds,
disputes, uncertain usage and reservations remain unsupported.

Stripe stopped automatically expanding `Charge.refunds` in API version 2022-11-15:
https://docs.stripe.com/changelog/2022-11-15/deprecates-charges-auto-expand
The pinned stripe 20.4.0 / 2026-02-25.clover SDK permits this field to be absent.
A full `amount_refunded` and successful individual refund alone do not establish
list completeness. The tool verifies GET `/v1/account`, GET `/v1/charges/:id`, and
GET `/v1/refunds?charge=ch_ID&limit=100`. The latter must return exactly one expected
full succeeded refund with `has_more=false`. Both financial GETs use the existing
`charge_read` permission (Charges and Refunds Read); Accounts Read verifies the
current account. No permission expansion or provider write is required.

References: https://docs.stripe.com/api/refunds/list and
https://docs.stripe.com/keys/permissions-reference

The service accepts proof only as a separate server-side argument. The HTTP review
body cannot supply it. Proof must be at most 30 seconds old, identify the exact
test charge/payment/customer/refund, and match the funded top-up amount/currency.
Within the existing serializable wallet and identity locks, it rechecks the full
unused hold and all immutable history. Signed terminal refund success is still
mandatory. Only absent/null charge lists (including old normalized null/null rows)
can use supplemental proof. Explicit pagination, malformed lists, other refunds,
failed/canceled receipts, partial amounts and disputes stay blocked. A pre-repair
null/null row did not distinguish absence from malformed data; the complete API
list resolves that narrow historical ambiguity without changing the old row.

A separate `VERIFIED_PROVIDER_READ` audit row, clearly identified as an API read,
is appended atomically with binding and one ledger reversal. No raw Stripe
response, card/billing details, URL, signature or key is persisted. The wallet
remains `REVIEW`; a new contradictory or incomplete event after debit can make
reconciliation `UNCERTAIN` while retaining the debit. Duplicate original event
IDs remain no-ops. API reads are not an atomic provider snapshot; concurrent local
webhooks are serialized and revalidated, and later adverse events remain sticky.

## Adoption while the original helper is running

Use a separate unrecorded interactive WSL terminal, from the clean independently
reviewed repair worktree. Keep the original helper and its fixture/listener intact.
Do not use the unfunded resume option for this case. This tool has no signing-key
prompt; existing immutable signed receipts provide that part of the evidence.

```sh
python3 -I scripts/billing/review-funded-test-refund.py \
  --account acct_EXPECTED --fixture postgresql://isolated:isolated@127.0.0.1:PORT/ep_ai_wallet_test \
  --evidence /home/arund/dev/NEW_PRIVATE_REVIEW_EVIDENCE \
  --org stripe-acceptance-UUID --topup UUID --request UUID \
  --charge ch_EXPECTED --refund re_EXPECTED
```

Supply the existing test restricted key only at the hidden prompt. The tool first
verifies the account and local case, then waits. Type `review` to perform the two
read-only provider GETs and explicit local ledger reconciliation once, or `quit`.
A failed attempt stops without automatic retry. A provider read refusal requires
inspection; do not create another refund, remove holds, or weaken the guards.
The original helper's `status` command dynamically reads the resulting DB state;
no restart or source hot-reload is needed. It should report request `REFUNDED`,
reconciliation `SUCCEEDED`, one funding and one reversal, zero balance/hold,
wallet `REVIEW`. A concurrent adverse event may instead report `UNCERTAIN` with
zero balance and the same one reversal, requiring further review.

This development change does not run that operator step. No active acceptance
fixture is mutated and no Stripe provider calls are made during implementation.
Formal provider-forwarded end-to-end acceptance still needs operator execution
and provenance; local synthetic tests do not establish it.
