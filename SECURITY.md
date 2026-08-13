# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities through [GitHub Security Advisories](https://github.com/rudy774/opentypeless/security/advisories/new).

**Do not open a public issue for security vulnerabilities.**

Your report should include:

- A descriptive title
- Severity assessment (Critical / High / Medium / Low)
- Affected component(s)
- Steps to reproduce
- Impact description

We will acknowledge your report within 72 hours and aim to release a fix within 14 days for critical issues.

## Security Model

This fork supports both local **Bring Your Own Key (BYOK)** operation and optional managed-cloud features:

- Provider API keys are stored in the operating-system credential vault where supported. Legacy plaintext settings are migrated only after a verified vault write; they are not silently deleted if migration fails.
- No cloud account is required for the core BYOK workflow.
- BYOK audio and cleanup text are sent directly to the providers the user configures.
- Managed-cloud features require an authenticated session and send the data required for the requested managed operation.
- Transcription history and aggregate Day/Week/Month activity metrics are stored locally in SQLite. The app does not automatically upload analytics or diagnostic logs.
- Rotating diagnostic logs are stored locally for troubleshooting. They record operational status, stable error information, and timings; provider response bodies, transcripts, prompts, selected text, tokens, and credentials must not be logged.
- The Tauri webview uses a Content Security Policy.

Cloud backup is an explicit user action and may upload history, dictionary, and allow-listed settings. BYOK credentials are excluded from backup payloads.

The current commercial-readiness boundaries and launch blockers are documented in [docs/COMMERCIALIZATION.md](docs/COMMERCIALIZATION.md).

## Out of Scope

The following are not considered vulnerabilities:

- Prompt injection in LLM responses (no security boundary to bypass)
- Users exposing their own API keys through misconfiguration
- Issues requiring physical access to the user's machine
- Vulnerabilities in third-party STT/LLM provider APIs
