# Commercialization Architecture

## Honest product boundary

OpenTypeless is an MIT-licensed, local-first desktop client. This repository contains both the local-first desktop client and a deployable managed-service implementation under `services/managed-api`. The service is still opt-in: no checked-in source build points at a live endpoint, and this repository does not create or operate the external production infrastructure required to sell it.

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

1. The included managed API is deployed at a Rudy-owned HTTPS origin and passes
   database, authentication, billing, provider, backup, export, deletion, and
   recovery tests against that deployed environment.
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

## Commercial client identity and release guard

The checked-in source build is fail-safe:

- the checked-in `com.opentypeless.app` identifier is retained only to preserve the existing OS data directory and installed-user settings; it is a legacy compatibility value, not a commercial identity;
- every distributed commercial build must apply the generated overlay with an operator-owned identifier (changing the source identifier without a migration can make existing data appear lost);
- repository and support links belong to the Rudy774 fork;
- the registered deep-link scheme is fork-specific;
- CSP does not permit the upstream managed-service origin;
- frontend and Rust managed API origins are empty unless explicitly supplied at build time;
- BYOK and local providers remain available without a managed service; and
- updater configuration, updater artifacts, runtime permission/registration, and legacy updater workflows remain disabled.

The product name, identifier, deep-link scheme, CSP origin, and managed API origins are compiled into the generated client configuration. `COMMERCIAL_WEBSITE_URL`, `COMMERCIAL_REPOSITORY_URL`, `COMMERCIAL_SUPPORT_URL`, `COMMERCIAL_PRIVACY_URL`, and `COMMERCIAL_TERMS_URL` are checklist-only guard inputs: the generator does not wire them into the app. Before sale, link those owned destinations from the product UI and release materials and verify them independently.

Strict mode is enabled only with `COMMERCIAL_BUILD=true`. It requires public, owned client identity values for the API, website, repository, support, policies, product name, application identifier, and deep-link scheme. It also requires `VITE_MANAGED_API_BASE_URL` and `OPENTYPELESS_MANAGED_API_BASE_URL` to exactly match `COMMERCIAL_API_ORIGIN` so the webview and Rust pipeline cannot silently use different services.

Copy `.env.commercial.example` to the ignored `.env.commercial`, replace every placeholder, and generate the Tauri overlay:

```bash
node --env-file=.env.commercial scripts/generate-commercial-tauri-config.mjs
node --env-file=.env.commercial scripts/check-commercial-release.mjs
```

The generated `src-tauri/tauri.commercial.generated.json` is ignored because it is distribution identity, not a universal source default. It sets the owned product name, application identifier, URI scheme, and the exact managed API CSP origin while explicitly keeping updater artifact creation off. Apply it at build time:

```bash
VITE_MANAGED_API_BASE_URL=https://api.your-owned-domain.example \
VITE_APP_DEEP_LINK_SCHEME=yourproduct \
OPENTYPELESS_MANAGED_API_BASE_URL=https://api.your-owned-domain.example \
npm run tauri build -- --config src-tauri/tauri.commercial.generated.json
```

The release workflow is inert until the repository variable `COMMERCIAL_RELEASE_ENABLED=true` is set. It takes the same public identity fields from GitHub Actions variables, regenerates and audits the overlay, exports the managed origin to both compiler paths, publishes only to `github.repository`, and uses the repository-scoped GitHub token. It does not request an updater signing key because auto-update is still disabled.

The guard rejects missing or placeholder values, upstream origins/repositories/identifiers/deep links, non-HTTPS endpoints, mismatched compile-time origins, overlays outside the repository, missing CSP access, active updater configuration, and upstream release targets. It never asks for or prints billing credentials, provider API keys, OAuth secrets, deployment tokens, or signing private keys.

Passing this local guard proves configuration consistency only. It cannot prove domain/repository ownership, backend deployment, OAuth callback registration, billing correctness, legal readiness, operating support, OS code-signing identity, or production security. Those remain launch evidence, not assumptions.

## Service and metrics foundation

The included `services/managed-api` implements capability-based entitlements, a Stripe-owned plan catalogue, atomic usage reservations, stable errors, encrypted/versioned backups, one-time encrypted exports, deletion, content-free request tracing, webhook verification, persistent rate limits, and stale-operation reconciliation. Its deployment and operations runbook is in [`services/managed-api/README.md`](../services/managed-api/README.md). Capacity planning, monitoring, incident response, backups, key rotation, and disaster recovery remain operator responsibilities.

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
