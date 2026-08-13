# OpenTypeless UI Redesign Brief

## Core Job

The main window should answer one question immediately: **Is voice typing ready, and what do I press?** Ordinary dictation still happens outside the window through the global shortcut; the window is a calm command center for confidence, setup, history, and recovery.

## Distilled Information Architecture

### Home

1. **Readiness command center** — current ready/attention state, active dictation shortcut, plain-language start/stop behavior, and the speech → cleanup → destination route.
2. **Activity** — dictation time with Day/Week/Month filter plus today and total recording counts in one coherent group.
3. **Setup and usage** — friendly provider names, AI cleanup state, output behavior, and account/quota information only when it is relevant.

Remove the duplicated Settings and History buttons from Home. Replace raw storage values with human labels. Do not make plan upsell compete with readiness.

### Settings

Use one settings navigation rail, not the global app rail plus a second full-height rail. Enter Settings through a clear “Back to OpenTypeless” path, then group existing panes around user tasks:

- General — shortcuts, recording behavior, output, startup/history/capsule preferences
- Speech recognition — provider and language
- AI cleanup — provider, writing behavior, translation, advanced prompt controls
- Dictionary — words and correction rules
- Scenes — reusable voice workflows
- About — appearance, diagnostics, version, and support information

Keep API keys masked, local-storage reassurance adjacent, and testing at the provider field. Put provider-specific URLs and model details behind progressive disclosure after common setup.

### History

Keep search, date groups, copy, correction creation, and deletion. Make each result scannable with a three-line preview, stronger metadata, and an explicit expand/collapse interaction for long text. Keep destructive clearing secondary and clearly destructive.

### Capsule

Preserve the movable always-on-top behavior and all recording states. Keep the waveform, timer, stop affordance, and progress communication. Animate waveform bars with transforms, not layout-changing height transitions.

## Interaction Priorities

1. Dictation readiness and shortcut recognition
2. Fixing a readiness problem
3. Reviewing recent output
4. Changing everyday recording or cleanup behavior
5. Editing advanced provider details
6. Account, quota, upgrade, and diagnostics

## Visual Constraints

- Operate mode: fast scanning and native desktop confidence outrank decoration.
- One font family; four text sizes; three weights.
- Teal is the product/action signal, not a background applied to every selected control.
- Quiet flat or lightly bordered surfaces; elevation is reserved for transient UI.
- No nested cards, indiscriminate gradients, large pill containers, or hover scaling that shifts layout.
- Minimum 13px body copy and 12px helper copy with WCAG AA contrast.
- Visible `:focus-visible` on every interactive element; status never relies on color alone.
- Responsive down to a narrow desktop window and compatible with light, dark, localization, RTL, zoom, and reduced motion.

## Prototype Question

What composition makes readiness, the shortcut, and the provider-to-output route understandable in five seconds without turning Home into either a setup wizard or a metrics dashboard?

## Prototype Decision

Three disposable variants were captured on the local branch `prototype/open-typeless-command-center` at commit `0be67df`:

- **A — Command deck:** familiar labeled sidebar, dark readiness surface, horizontal speech route, and a quiet activity/setup split.
- **B — Studio split:** top navigation and a dramatic half-window speech journey beside activity and setup.
- **C — Focus canvas:** icon rail and a sparse centered instruction surface.

Variant A is the production direction. It made readiness and the shortcut most obvious while preserving navigation recognition and enough operational detail for recovery. Variant B split attention too strongly between two halves, and Variant C hid navigation labels and too much setup context. Production should reimplement A with real state rather than copying prototype code.

## Success Measures

- One dominant Home region and no more than three supporting groups.
- The shortcut and current start/stop behavior are legible without opening Settings.
- Provider names and output behavior are human-readable everywhere.
- Settings no longer displays two competing navigation rails.
- Long History entries can be skimmed before expansion.
- The deterministic design detector reports no layout-transition finding for the capsule waveform.
