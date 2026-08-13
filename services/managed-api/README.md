# OpenTypeless managed API

This directory contains the operator-owned service behind the optional OpenTypeless Cloud account, transcription, cleanup, billing, quota, encrypted-backup, and account-management surfaces. The desktop remains fully usable with local or bring-your-own-key providers when this service is not configured.

The service is a Node.js/Express application backed by PostgreSQL. It uses Better Auth for account sessions, Stripe for the server-owned plan catalogue and billing state, ElevenLabs Scribe for managed speech-to-text, Gemini for managed cleanup/Ask, and Resend for transactional email. Provider and billing credentials are server-side only.

## Security boundary

- Desktop requests use a signed bearer token. Managed WebView requests explicitly omit ambient cookies.
- Desktop OAuth uses a five-minute, one-time authorization code with PKCE S256; reusable bearer tokens never enter deep-link URLs.
- BYOK provider keys are not accepted by this API. Portable backups reject credential-like fields and exclude provider/model/base-URL routing settings.
- Backups, OAuth session artifacts, account exports, and billing redirects are encrypted with AES-256-GCM. Account export links are one-time and expire after 30 minutes.
- Quota reservations, idempotency records, rate limits, OAuth transactions, Stripe events, and entitlement changes are persisted in PostgreSQL. Stale reservations are reconciled at startup and every five minutes.
- Logs are structured and content-free: no audio, transcript, prompt, provider body, bearer token, URL query, or credential value is intentionally logged.

## Local verification

From the repository root:

```powershell
npm.cmd ci
npm.cmd run service:build
npm.cmd run service:test
npm.cmd run service:contract:check
npm.cmd run service:contract:test
```

A PostgreSQL integration environment is required to run the service itself. Copy `.env.example` to an untracked `.env`, replace every placeholder, then load those values through your process manager or secret store. The application deliberately does not load `.env` files itself.

Run migrations before replacing an existing service instance:

```powershell
npm.cmd run service:migrate
npm.cmd run service:start
```

For a single controlled instance, `RUN_MIGRATIONS_ON_START=true` is also supported. Leave it false when multiple replicas can start concurrently and run `service:migrate` as a separate release job instead.

## Container

Build from the repository root because the runtime validates backup payloads against the checked-in OpenAPI contract:

```powershell
docker build -f services/managed-api/Dockerfile -t opentypeless-managed-api:local .
docker run --rm --env-file services/managed-api/.env -p 8787:8787 opentypeless-managed-api:local
```

The image runs as the unprivileged `node` user and exposes `/api/health/ready`. Use TLS at the load balancer, configure `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops, and never expose PostgreSQL publicly.

## Required production setup

1. Create a TLS-enforced PostgreSQL database and run `npm run service:migrate` from the exact image being deployed.
2. Create Stripe products/prices and register `POST https://<api-origin>/api/billing/stripe/webhook` for Checkout, subscription, refund, and dispute events.
3. Configure Google and/or GitHub OAuth redirect URIs for Better Auth under `https://<api-origin>/api/auth/callback/<provider>` if those providers are offered.
4. Verify the Resend sender domain and set `MAIL_FROM` to an address on that domain.
5. Provision least-privilege ElevenLabs, Gemini, Stripe, Resend, and OAuth credentials in the deployment secret manager.
6. Set alerting on readiness failures, HTTP 5xx rate, provider-unavailable errors, webhook retries, quota reconciliation failures, database saturation, and latency percentiles.
7. Build the desktop with the same exact owned API origin and deep-link scheme. Run the commercial release guard before signing installers.

## Operations and retention

The first migration creates all managed-service tables and indexes. The service deletes expired OAuth codes, account-export artifacts, rate-limit buckets, completed idempotency rows, and old completed billing events during reconciliation. Transcript and prompt content are not written to managed usage tables. Cloud backups remain until the user replaces them or deletes the account; define and publish an operator retention policy before accepting paying users.

Backup encryption currently uses one active `BACKUP_ENCRYPTION_KEY_ID`. Keep the prior key available during any future rotation implementation; changing the key without a migration makes existing encrypted backups and one-time artifacts unreadable.

## Launch boundary

This repository provides the deployable service implementation and release checks. It does not create your Stripe account, domains, database, sender reputation, provider quotas, tax configuration, privacy terms, support operation, uptime monitoring, or incident-response process. Those operator-owned dependencies must be completed and tested with production-mode credentials before selling access.
