---
target: the OpenTypeless desktop UI
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-08-11T23-21-05Z
slug: src-components
---
⚠️ DEGRADED: single-context (independent Assessment A sub-agents did not complete after two attempts; deterministic Assessment B completed independently)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2 | The home screen reports usage, but not a strong current ready/not-ready state for dictation and cleanup. |
| 2 | Match system / real world | 2 | Raw labels such as `elevenlabs`, `gemini`, `keyboard`, STT, and LLM make users translate implementation terms. |
| 3 | User control and freedom | 3 | Manual start/stop, configurable output, escape paths, and confirmations are strong; some secondary behavior is hidden. |
| 4 | Consistency and standards | 2 | Duplicate navigation rails, uneven control styles, and raw configuration values weaken predictability. |
| 5 | Error prevention | 3 | Connection tests, constrained options, safe clipboard fallback, and confirmations prevent common failures, but readiness problems surface too late. |
| 6 | Recognition rather than recall | 2 | The active location is visible, but users must remember where provider readiness, hotkeys, cleanup, diagnostics, and advanced controls live. |
| 7 | Flexibility and efficiency | 4 | Global shortcuts, multiple workflows, provider choice, manual recording, app-aware cleanup, and mouse mapping serve experts well. |
| 8 | Aesthetic and minimalist design | 2 | Nearly every region is a raised jelly card, giving welcome copy, counts, quotas, configuration, and actions similar weight. |
| 9 | Error recovery | 3 | Retry, diagnostics, history status, and clipboard fallback are useful, though recovery is not surfaced from the home screen. |
| 10 | Help and documentation | 2 | Onboarding and helper text exist, but contextual readiness guidance and a low-risk practice flow are missing. |
| **Total** |  | **25/40** | **Acceptable — strong capability, significant interface restructuring needed** |

## Design Specificity Verdict

The voice workflow is product-specific, but the main window does not yet express it. The home screen reads like a generic account dashboard built from interchangeable statistic cards. The most distinctive product truth — “hotkey → speak naturally → ElevenLabs → optional Gemini cleanup → original text field” — is present only as scattered configuration facts, not as the organizing idea.

The deterministic scan found one warning: `layout-transition` in `src/components/Capsule/Waveform.tsx:64`. Seven bars update `height` every animation frame while CSS transitions height, causing avoidable layout work. This is a real, bounded performance issue rather than a false positive.

No reliable browser overlay was available because this is a Tauri WebView and the supplied visual evidence was static PNG output. Off-screen native window capture successfully showed the current Home, General, Speech Recognition, AI Polish, and History views at 1140×962 without clipping.

## Overall Impression

OpenTypeless is functionally mature and unusually flexible, but its interface treats configuration inventory as the product. The biggest opportunity is to make the app feel like a quiet voice command center: show whether dictation is ready, what shortcut starts it, where the words will go, and what happens after speech — then let everything else recede.

## What's Working

- The persistent labeled navigation is understandable and gives first-time users a stable map.
- Global shortcuts, manual stop, provider choice, output fallback, history, and diagnostics give power users meaningful control.
- API keys are masked, local-storage reassurance sits next to the sensitive field, and provider testing is available at the point of configuration.

## Priority Issues

### [P1] Readiness is not the home screen's primary message

**Why it matters:** A user opening the app wants to know whether the hotkey, microphone, transcription provider, cleanup provider, and output path are ready. Counts and quotas do not answer that question.

**Fix:** Replace the welcome card and scattered configuration block with one readiness command center: a clear Ready / Needs attention state, the current hotkey, the speech-to-output route, and a direct fix action when any required piece is missing.

**Suggested command:** `$impeccable layout`

### [P1] Settings navigation and terminology expose the implementation

**Why it matters:** The main sidebar plus a second full-height settings sidebar consumes 38% of the window before content, while STT/LLM terminology and raw enum values force translation.

**Fix:** Keep a compact settings section rail, add short task-oriented descriptions, use human provider names, and group the everyday controls under Voice, Writing, Personalization, and System mental models.

**Suggested command:** `$impeccable distill`

### [P1] Small, low-contrast text undermines desktop accessibility

**Why it matters:** Repeated 11px tertiary labels on pale gray surfaces are difficult to scan and fall short of a confident Windows utility. Focus styling is inconsistent outside form fields.

**Fix:** Raise the typography floor, darken secondary/tertiary colors, establish visible `:focus-visible` treatment for every interactive element, and preserve meaning beyond color.

**Suggested command:** `$impeccable audit`

### [P2] The jelly treatment creates a noisy, soft hierarchy

**Why it matters:** Heavy inner highlights, shadows, hover scaling, large radii, and gray-on-gray gradients make all content look inflated and equally important. Controls move under the pointer and dark mode carries the same visual weight.

**Fix:** Replace raised cards with quiet bordered surfaces, reserve elevation for transient elements, reduce radii and motion, and use the teal accent for status and action rather than filling every selected control.

**Suggested command:** `$impeccable quieter`

### [P2] History is difficult to scan and the capsule meter animates layout

**Why it matters:** Long transcripts form undifferentiated text blocks with tiny metadata and remote actions. Separately, height transitions in the live waveform add avoidable layout work to the most latency-sensitive feedback surface.

**Fix:** Give history entries clearer card boundaries, preview clamping, stronger metadata/actions, and expandable detail. Change waveform animation to transforms instead of height.

**Suggested command:** `$impeccable optimize`

## Cognitive Load

Five of eight checks fail: single focus, chunking, visual hierarchy, minimal choices, and progressive disclosure. The Home view exposes welcome text, three metrics, quota/account data, four configuration rows, and duplicated navigation actions at once. Settings adds a second navigation system while technical provider controls and everyday behavior share the same visual level.

The emotional journey begins with a friendly welcome but immediately drops into gray usage inventory. There is no reassuring peak moment that says “you are ready,” and a successful setup has no celebratory or confidence-building end state beyond a small latency line.

## Persona Red Flags

**Alex (power user):** The underlying shortcuts are excellent, but the Home view makes Alex parse decorative cards and duplicate Settings/History buttons instead of presenting current readiness and recent output. Raw configuration is visible without being actionable.

**Jordan (first-timer):** Jordan sees STT, LLM, BYOK, model names, base URLs, two sidebars, and hidden advanced sections before understanding the provider chain. There is no obvious safe practice action to confirm the microphone and insertion flow.

**Sam (accessibility-dependent):** 11px tertiary copy, subtle gray boundaries, hover-driven elevation, and incomplete focus-visible treatment make scanning and keyboard navigation harder. State must remain announced and understandable without teal/green alone.

## Minor Observations

- Home repeats Settings and History actions already present in persistent navigation.
- Configuration values should be `ElevenLabs Scribe v2`, `Google Gemini`, `AI cleanup on`, and `Type directly`, not storage enums.
- The Free Plan quota block is visually prominent even when a BYOK user's immediate concern is provider readiness.
- Settings pages leave large empty areas while individual inputs span very wide lines.
- Clear History sits in a low-contrast fixed bar that resembles a disabled control.

## Questions to Consider

- What if opening OpenTypeless answered only three questions first: “Am I ready?”, “What shortcut do I press?”, and “What will happen to my words?”
- Could a first-time user test the full microphone-to-text route without leaving OpenTypeless or risking text in another app?
- Which advanced provider controls deserve to remain visible after a connection succeeds?

## Success Criteria

1. Within five seconds, a user can identify dictation readiness, the active hotkey, the provider/cleanup route, and the next corrective action.
2. Home has one dominant readiness region and no more than three supporting groups; persistent navigation is not duplicated as content.
3. Settings uses task language and friendly values while keeping advanced provider details progressively disclosed.
4. Default body text is at least 13px, important helper text is at least 12px with AA contrast, and all controls have visible keyboard focus.
5. History entries are scannable before expansion, and the recording waveform animates transforms rather than layout properties.
