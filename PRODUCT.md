# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

OpenTypeless primarily serves people who write across many Windows applications and want speech to become polished text without breaking their flow. The Rudy774 fork is especially useful to shortcut-driven power users who prefer bring-your-own-provider control, deliberate start/stop recording, and reliable insertion back into the field where dictation began.

## Product Purpose

OpenTypeless turns a global hotkey and spoken audio into clean text inside the application the user is already using. It also supports one-shot voice questions, selected-text rewriting, translation, history, personal dictionary corrections, and app-aware writing. Success means the user can speak naturally, including pauses, receive useful polished text quickly, and trust that it will return to the intended text field.

## Positioning

The product combines open-source desktop dictation, provider choice, optional AI cleanup, and cross-application text insertion. The Rudy774 fork adds ElevenLabs Scribe v2 BYOK, pause-friendly manual recording, original-field restoration on Windows, a movable always-on-top recording capsule, timing diagnostics, and a filtered dictation-time dashboard.

## Operating Context

The product runs quietly in the system tray and is invoked primarily through global keyboard or programmable-mouse shortcuts while another application has focus. The main window is used to understand readiness, review recent dictation, inspect usage, configure providers and cleanup, manage shortcuts, troubleshoot failures, and revisit history. Provider credentials are entered in settings and stored locally.

## Capabilities and Constraints

- Preserve the tray-first and global-hotkey workflow; the main window must not be required for ordinary dictation.
- Preserve press-once-to-start and press-again-to-stop recording, including unlimited quiet pauses when automatic stop is disabled.
- Keep ElevenLabs speech recognition and Gemini cleanup independently configurable.
- Maintain the original-field restoration path and safe clipboard fallback on Windows.
- Preserve the draggable, always-on-top, non-activating capsule and its live microphone feedback.
- Keep provider keys out of source control and avoid exposing secrets in diagnostics or history.
- Retain localization, light/dark themes, keyboard access, and the current Tauri/React application architecture.
- Do not invent usage, account, provider, or readiness states that the application cannot verify.

## Brand Commitments

The product name is OpenTypeless. The interface should feel calm, capable, direct, and local-first rather than promotional or chatty. Existing app icon assets and the teal product accent are recognized identifiers, but the current visual treatment is not a binding design constraint for this redesign.

## Evidence on Hand

- Product and fork behavior: `README.md`
- Current desktop interface: `src/components/`, `src/windows/MainApp.tsx`, and `src/styles/globals.css`
- App icon assets: `src-tauri/icons/` and `src/assets/app-icons/`
- Existing interface captures: `docs/images/app-main-light.png`, `docs/images/app-settings.png`, `docs/images/app-history.png`, and `docs/images/onboarding-stt.png`
- No testimonials, external benchmarks, or verified performance claims should be fabricated for the product UI.

## Product Principles

1. Keep dictation readiness obvious without demanding attention.
2. Put the everyday voice workflow first and reveal provider complexity progressively.
3. Make status, destination, timing, and failure recovery trustworthy at a glance.
4. Reward shortcut-driven experts without leaving first-time users to decode jargon.
5. Preserve local control, provider transparency, and safe handling of user text and credentials.

## Accessibility & Inclusion

Primary configuration and troubleshooting flows must remain usable by keyboard and screen reader, show visible focus, avoid color-only status communication, honor reduced motion, support zoom and narrow desktop windows, and retain the existing localization and right-to-left infrastructure.
