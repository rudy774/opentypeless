# Commercialization Architecture

## Honest product boundary

OpenTypeless is an MIT-licensed, local-first desktop client. This repository
contains clients for optional accounts, checkout, quota, managed inference,
backup, and updates; it does not contain the production service that operates
them.

The safest business model is:

- keep the open-source desktop and BYOK workflows useful without an account;
- sell managed speech recognition, managed AI cleanup, encrypted backup/sync,
  curated packs, and later team controls;
- make the managed backend authoritative for authentication, entitlement,
  quota, and billing; and
- preserve local history, settings, and BYOK credentials when cloud service is
  unavailable or a subscription expires.

BYOK audio goes directly to the user's speech provider. AI cleanup sends the
transcript and explicitly selected text directly to the configured LLM.
Provider keys must stay in the OS credential vault and must never be embedded
in a build or sent to the managed service.

A managed service receives audio, transcripts, and explicit backup uploads.
Before launch, its operator must publish retention, deletion, encryption,
regional-processing, subprocessor, privacy, and support policies.

## Release blockers

Do not sell a managed build until:

1. A Rudy-owned API implements auth, subscription status, checkout/portal,
   managed STT/LLM/Ask, backup, export, and deletion.
2. The packaged app no longer uses upstream accounts, API origins,
   repositories, support channels, identifiers, deep links, or update feeds.
3. Rudy owns the updater endpoint and signing pair. Only the public updater key
   belongs in client configuration; private keys stay in release secrets.
4. Billing webhooks, cancellation/refund handling, entitlement reconciliation,
   server-side idempotent quota accounting, abuse controls, and monitoring
   exist.
5. Privacy Policy, Terms, support, account deletion/export, backup retention,
   and subprocessor disclosures are live and linked.
6. Product-name and bundled third-party-mark rights have been reviewed. MIT
   permits selling the software but does not grant trademark rights.
7. Every advertised paid benefit is operational.
8. Pricing is backed by a cost model. Lifetime access with recurring managed
   quota creates an indefinite inference cost and must not be enabled by
   default without approval.

## Commercial release guard

**npm run commercial:check** skips normal development and becomes strict only
when **COMMERCIAL_BUILD=true**. Strict mode requires:

- COMMERCIAL_API_ORIGIN
- COMMERCIAL_WEBSITE_URL
- COMMERCIAL_REPOSITORY_URL
- COMMERCIAL_SUPPORT_URL
- COMMERCIAL_PRIVACY_URL
- COMMERCIAL_TERMS_URL
- COMMERCIAL_APP_IDENTIFIER
- COMMERCIAL_UPDATER_ENDPOINT
- COMMERCIAL_UPDATER_PUBLIC_KEY

It rejects missing values, obvious placeholders, the current upstream
OpenTypeless defaults, non-HTTPS URLs, invalid identifiers, and the upstream
updater public key. It also inspects the actual package metadata, frontend and
Rust API defaults, Tauri identifier/CSP/deep-link/updater configuration,
capability permissions, updater registration, and release automation. Supplying
plausible environment values cannot make the check pass while those static
files still point to upstream infrastructure. It never requests billing
credentials, provider API keys, OAuth secrets, deployment tokens, or signing
private keys.

Copy **.env.commercial.example** to an ignored **.env.commercial**, replace
every placeholder, and run:

    node --env-file=.env.commercial scripts/check-commercial-release.mjs

The example intentionally fails strict mode until completed.

These variables are currently a checklist only. Runtime and Tauri settings
remain statically configured elsewhere. Launch still requires wiring the
validated values into the build and proving the packaged binary contains them.
This guard does not prove ownership, deployment, legal readiness, or security.

The updater is intentionally disabled in this fork: updater artifact creation,
the upstream feed and public key, runtime plugin registration, and capability
permission are not active. Re-enable those pieces only after a Rudy-owned
release feed and signing pair exist, then extend the strict guard to verify the
packaged updater identity. Keeping the updater dependencies installed is
deliberate so that future wiring remains build-compatible; dependencies alone
do not activate the updater.

## Service and metrics foundation

The future backend needs capability-based entitlements, a server-owned plan
catalog, atomic usage reservations, stable error codes, encrypted/versioned
backups, deletion/export, privacy-safe request tracing, webhook verification,
capacity planning, incident response, and disaster recovery.

The desktop can add local aggregate metrics such as recording time, word count,
session count, completion/fallback/failure rate, and p50/p95 STT, cleanup, and
total latency. Store numeric aggregates and stable error codes, never
transcripts, prompts, selected text, window titles, tokens, or credentials.
Users must be able to reset/export metrics. Remote analytics requires a
separate disclosure, redaction review, and meaningful consent.

## Minimum launch evidence

Retain evidence that the strict guard passes; the packaged app has no upstream
service/update defaults; billing lifecycle and quota exhaustion work in a safe
test environment; managed operations and data deletion/export pass without
content-bearing logs; updater artifacts verify with Rudy-owned identities; all
policy links are live; and backup recovery and incident procedures were tested.
