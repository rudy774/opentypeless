---
name: OpenTypeless
description: A quiet voice-routing instrument for confident desktop dictation.
colors:
  signal-teal: "#0f7465"
  signal-teal-hover: "#0a5e52"
  signal-wash: "#d9f3ed"
  on-signal: "#ffffff"
  mist-canvas: "#f3f7f6"
  mist-field: "#e9f0ee"
  paper: "#ffffff"
  ink: "#14211e"
  secondary-text: "#50625d"
  tertiary-text: "#556963"
  hairline: "rgba(20, 50, 43, 0.13)"
  night-canvas: "#111817"
  night-surface: "#202c29"
  night-ink: "#f0f6f4"
  night-signal: "#4acdb5"
  night-on-signal: "#10221e"
typography:
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "31px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  data:
    fontFamily: "Cascadia Mono, SF Mono, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-teal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  nav-active:
    backgroundColor: "{colors.signal-wash}"
    textColor: "{colors.signal-teal}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "20px"
  command-deck:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: OpenTypeless

## Overview

**Creative North Star: "The Quiet Signal Route"**

OpenTypeless should feel like a calm voice-routing instrument, not a statistics dashboard or an AI chat surface. A mist canvas, paper controls, ink command surface, and restrained teal signal make configuration easy to identify without making the tray-first utility demand attention.

The system is compact, operational, and native to Windows. Product-specific route diagrams explain where speech goes; everything else stays flat, legible, and familiar. The former glossy jelly treatment is an anti-reference: permanent surfaces do not inflate, wobble, or compete for equal visual weight.

**Key Characteristics:**

- One dark command surface establishes configuration, shortcut state, and the speech route.
- Paper and mist layers create structure with hairline borders rather than decoration.
- Teal identifies current state, signal, and primary action.
- Labeled navigation and plain-language provider names favor recognition.
- Motion is sparse, reduced-motion aware, and transform-based.

## Colors

The palette combines cool, low-chroma neutrals with one clear teal signal; dark mode preserves the same role relationships rather than merely inverting values.

### Primary

- **Signal Teal:** The action and signal color. Use it for active navigation, primary controls, focus, microphone feedback, and meaningful links. Its light-mode pair passes WCAG AA for normal text on Signal Wash.
- **Signal Wash:** The quiet selected-state field behind teal text and icons.

### Neutral

- **Mist Canvas:** The main application field behind content surfaces.
- **Mist Field:** Recessed inputs, segmented-control tracks, and supporting regions.
- **Paper:** Navigation rails, headers, cards, menus, and form surfaces.
- **Ink:** Primary copy and the signature Home command deck.
- **Secondary and Tertiary Text:** Supporting copy and metadata; tertiary is never the sole carrier of state.
- **Hairline:** Permanent borders, dividers, and group boundaries.

**The Signal Scarcity Rule.** Teal earns attention by remaining rare; use it for current state and action, not as ambient decoration.

**The Role-Preservation Rule.** Dark mode changes values, never semantic roles: canvas stays quiet, surfaces stay distinct, and teal remains the signal.

## Typography

**Display Font:** Segoe UI Variable Text (with Segoe UI and system-ui fallback)
**Body Font:** Segoe UI Variable Text (with Segoe UI and system-ui fallback)
**Label/Mono Font:** Cascadia Mono for keycaps and measured data only

**Character:** The Windows system face keeps the utility fast and native. Weight, measure, and whitespace create hierarchy; ornamental display typography is deliberately absent.

### Hierarchy

- **Headline** (600, 26–31px, 1.12): the Home command statement only.
- **Title** (600, 16–19px, 1.3): page and card titles.
- **Body** (400, 13px, 1.65): explanations, transcripts, and field content; keep prose comfortably narrow.
- **Label** (500–600, 12px): form groups, metadata, and compact actions. Use sentence case rather than decorative all caps.
- **Data** (600, 12px): keyboard keycaps and comparable measured values.

**The Data-Is-Data Rule.** Monospace is reserved for shortcuts and measurements; provider names, navigation, and body copy stay in Segoe UI.

## Layout

The desktop shell uses a 184px labeled rail and a flexible content area. Settings replaces the global rail with one 216px section rail so two navigation systems never compete. Page content is centered at 980–1060px, with 20–28px outer padding and a 16–24px vertical rhythm.

Home uses one full-width command deck followed by an activity/setup split. At narrow widths the split and route stack vertically while navigation remains recognizable. History uses a bounded column with date groups and rendering containment for long lists. Settings limits working content to 780px so fields remain readable instead of stretching across the window.

Breakpoints reflect the shipped desktop shell: navigation compacts around 720px, multi-column Home content begins around 760px, and outer padding expands around 900px.

## Elevation & Depth

The system is flat by default. Canvas, fields, paper surfaces, borders, and tonal differences provide permanent structure. Small shadows appear on selected segmented controls; medium and floating shadows are reserved for the command deck, menus, dialogs, and transient overlays.

### Shadow Vocabulary

- **Low definition:** a 1px/2px neutral shadow for selected controls and small lifted states.
- **Command depth:** a broad, low-opacity shadow beneath the single dark Home command deck.
- **Floating depth:** the strongest shadow, reserved for menus, dialogs, and overlays.

**The Flat-by-Default Rule.** A surface does not receive elevation merely because it is a card; elevation communicates importance or temporary layering.

## Shapes

Controls use gently curved 6–10px corners, cards use 12–14px corners, and major signature surfaces may reach 16–18px. Full pills are limited to compact status chips, toggle tracks, progress bars, and the draggable recording capsule. Hairline borders define shape more often than shadows.

**The Capsule Exception Rule.** The floating live-transcription capsule may be pill-shaped; ordinary panels and navigation must not borrow that silhouette.

## Components

### Buttons

- **Shape:** Compact, gently curved controls (8–10px).
- **Primary:** Signal teal with the `on-signal` foreground and a darker teal hover. Dark mode uses dark ink on the brighter night signal so button labels retain strong contrast.
- **Hover / Focus:** Hover increases contrast without changing geometry; every control receives a 2px teal `:focus-visible` outline.
- **Ghost:** Transparent or paper-backed with secondary text and a hairline border where containment matters.

### Cards / Containers

- **Corner Style:** Quiet 12–14px curves.
- **Background:** Paper in light mode and night surface in dark mode.
- **Shadow Strategy:** Flat at rest; the command deck is the intentional exception.
- **Border:** One hairline neutral stroke.
- **Internal Padding:** Usually 16–20px; 24px on the command deck.

### Inputs / Fields

- **Style:** Mist field, 8–10px radius, explicit ink text, and a hairline border where field boundaries need reinforcement.
- **Focus:** Teal border plus the global visible focus outline.
- **Error / Disabled:** Semantic error or reduced opacity while keeping the label readable.

### Navigation

Navigation stays labeled at ordinary desktop widths. Items are 40px tall with 17px line icons; the current item uses Signal Wash with teal text and icon. Hover uses a tonal mist surface, never scaling or wobbling.

### Command Deck

The Home command deck is the signature component: an ink surface containing text-backed configuration state, keycaps, and a speech-recognition → AI-polish → output route. It is the only permanent dark surface in light mode and the only Home region allowed strong depth.

### Recording Capsule

The capsule remains always on top, movable, non-activating, and compact. Live microphone bars use `transform: scaleY()` with a fixed layout box; reduced motion removes decorative flutter without hiding input level.

## Do's and Don'ts

### Do:

- **Do** make configuration, the shortcut, and the output route legible within five seconds.
- **Do** use friendly provider names such as ElevenLabs Scribe v2 and Google Gemini.
- **Do** keep permanent surfaces flat and separated by tone or hairline borders.
- **Do** preserve visible keyboard focus, text-backed state, localization, narrow-window support, and reduced motion.
- **Do** clamp long history text and provide an explicit expansion path.

### Don't:

- **Don't** expose storage enums such as `elevenlabs`, `gemini`, or `keyboard` as user-facing values.
- **Don't** reintroduce nested navigation rails, duplicated Home navigation actions, or dashboard card inventory.
- **Don't** use glossy gradients, indiscriminate shadows, hover scaling, or jelly wobble on permanent UI.
- **Don't** use all-caps eyebrow copy as decoration or shrink important helper text below 12px.
- **Don't** animate layout properties for live microphone feedback.
