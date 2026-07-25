# EverywherePoster Email Operations

## Current provider

- Provider: Resend
- Customer-visible sender name: `EverywherePoster`
- Sender domain: `everywhereposter.com`
- The exact sender mailbox and `RESEND_API_KEY` are production configuration and must not be committed.

## Operator-reported status

As of 2026-07-25, the operator reported that the Resend domain and landing-page domain setup had been updated. Repository state cannot independently verify the Resend dashboard, DNS records, or current production secret values.

## Required production environment

```text
EMAIL_PROVIDER=resend
EMAIL_FROM_NAME=EverywherePoster
EMAIL_FROM_ADDRESS=<verified sender at everywhereposter.com>
RESEND_API_KEY=<production secret>
```

Keep all secrets outside Git. `docker-compose.yaml` already passes these existing environment variables into the `postiz` container.

## Verification checklist

After changing production email configuration:

1. Recreate only `postiz` if the container environment changed.
2. Confirm startup logs contain `Email service provider: resend`.
3. Confirm startup logs do not report missing `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS`, or `RESEND_API_KEY`.
4. Register a disposable test account and confirm the activation email arrives when activation is enabled.
5. Request a password reset and confirm the message arrives and links to `https://app.everywhereposter.com`.
6. Test an organization or team invitation if that workflow is enabled.
7. Confirm the From name displays as `EverywherePoster` and the From address uses the verified `everywhereposter.com` domain.
8. Check the Resend activity log for accepted delivery and investigate any bounce or rejection.

## Safety

- Never commit a real API key or production sender mailbox if it is considered private operational data.
- Do not paste secret values into issues, pull requests, screenshots, or logs.
- Do not rename the existing environment keys.
- A Resend dashboard update does not require an application image rebuild. Recreate only the affected runtime service when environment values change.
