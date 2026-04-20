# /node-carousel:setup

Interactive, voice-first brand wizard that creates `brand-profile.json` in the current working directory. Run this once per project.

**User's request:** $ARGUMENTS

## Behavior

Philosophy: **one cascade question drives everything**. The user picks an aesthetic voice; the wizard loads a matching preset with every visual decision pre-populated. Subsequent rounds only ask for overrides. User can press enter on any round except Voice and Brand Identity to accept preset defaults. At any point, the user can say "just write the preset as-is, I'll edit later" — honor that and skip to Step 4.

### Step 1: Check for existing brand-profile.json

Check if `./brand-profile.json` exists in the current working directory.

- **If it exists:** ask "A `brand-profile.json` already exists here. Overwrite it? (y/N)" — default no. If no, stop and tell them where to edit it manually (point to `docs/brand-profile-schema.md`).
- **If not:** proceed.

### Step 2: Run the voice-first wizard

Use `AskUserQuestion` if available for structured questions, otherwise ask conversationally. Preset library lives in `templates/presets/` — see `prompts/setup-presets.md` for the full description of each.

---

**Round 1 — Voice (THE cascade question) — REQUIRED**

Ask a single question with 5 options. Phrase each option by its vibe, not technical jargon:

```
What's the vibe of your content?

(A) Editorial serif — warm, considered, premium (Lenny Rachitsky, Morning Brew)
(B) Clean grotesk — modern, confident (Stripe, Linear, Cal.com)
(C) Technical mono — precise, developer-facing (Vercel v0, Supabase)
(D) Display serif bold — high-contrast editorial (NYT-style, luxury)
(E) Utilitarian bold — Swiss-minimal, stark (Pentagram, design studios)

Not sure? (A) is the safest default for most brands.
```

Map the answer:
| Choice | Preset file |
|---|---|
| A | `templates/presets/editorial-serif.json` |
| B | `templates/presets/neo-grotesk.json` |
| C | `templates/presets/technical-mono.json` |
| D | `templates/presets/display-serif-bold.json` |
| E | `templates/presets/utilitarian-bold.json` |

Resolve the plugin root (`${CLAUDE_PLUGIN_ROOT}` or fall back to the directory containing `.claude-plugin/plugin.json`). Load the matching preset JSON file and keep it in memory as the working brand profile.

---

**Round 2 — Brand identity (text only) — REQUIRED**

Ask for three text fields:
- Brand name (e.g. `Node`)
- Social handle, including `@` (e.g. `@nodeagency`)
- Tone, one line (e.g. `direct, builder-voice, no fluff`)

Overlay the answers into `brand.name`, `brand.handle`, `brand.tone` on the working profile. These are the only fields that must be non-empty — `render.mjs` will reject the profile if `brand.name` is blank.

---

**Round 3 — Color override (optional)**

Show the preset's palette in a visual-friendly way. Format example (editorial-serif):

```
Your preset comes with these colors:
  Background: #F8F5F0 (warm cream)
  Text:       #1A1A1A (near-black)
  Accent:     #C84B31 (terracotta)
  Muted:      #6B6B6B (grey)

Keep these, or customize?
(A) Keep preset colors (recommended)
(B) Change accent only
(C) Use my own (all 4 hex codes)
```

Handling:
- **A or empty** → no change.
- **B** → prompt for new accent hex. Derive `accentSecondary` as a ~20% darker shade, OR accept a second hex if the user offers one.
- **C** → prompt for all four (background, text, accent, muted). Again derive `accentSecondary` unless user provides it.
- Accept common color names (`navy` → `#000080`, `cream` → `#F8F5F0`, etc.).
- Reject invalid hex (e.g. `#xyz`, `blue`) with a retry prompt showing `#RRGGBB` format.

Merge overrides into `visual.colors` on the working profile.

---

**Round 4 — Background override (optional)**

Describe the preset's default in plain language, then offer overrides. Example for editorial-serif:

```
Your preset uses: solid cream with film grain.

Change?
(A) Keep preset default (recommended)
(B) Solid color (no grain)
(C) Subtle gradient (2-color diagonal)
(D) Mesh gradient (modern, soft — Stripe/Framer style)
(E) Radial vignette (Apple keynote style)
(F) Upload image (path needed)
```

Handling:
- **A or empty** → no change.
- **B** → set `background.type = "solid"`, keep `background.color` as preset's bg, set `grain.enabled = false`. Don't touch mesh/radial/gradient sub-objects (keep preset values for future reference).
- **C** → set `type = "gradient"`. Ask for `gradient.from` and `gradient.to` (defaults: preset bg + preset accent). Keep 135° angle unless user overrides.
- **D** → set `type = "mesh"`. Use preset's existing `mesh.blobs` as the default. Offer: "Keep preset mesh blobs, or describe your own (colors + positions)?" If describe: accept 2-5 blob specs (hex + loose position like `top-left`, `bottom-right`, `center`), convert positions to percentage strings.
- **E** → set `type = "radial"`. Use preset's `radial` config. Ask only if they want to change `radial.from` color (default: accent) and `radial.center` (default: `50% 30%`).
- **F** → set `type = "image"`, prompt for `imagePath`. Accept absolute or relative paths. Do NOT validate the file exists (they may drop the image in later).

Keep all other sub-objects (gradient, mesh, radial, imagePath) populated — render.mjs picks based on `type`, and leaving full sub-objects makes the file self-documenting.

---

**Round 5 — Grain override (optional)**

Describe current grain state plainly. Example:

```
Film grain: ON (intensity 0.08).
Flip? (Y/N — default: keep)
```

If user flips:
- If currently on → set `background.grain.enabled = false`.
- If currently off → set `background.grain.enabled = true` with `intensity: 0.08` and `baseFrequency: 0.9` defaults.

Grain works on ANY background type — that's why it's its own round.

---

**Round 6 — Numbering override (optional)**

```
Slide counter style:
(A) <preset default> (recommended)
(B) Fraction in mono (03 / 08)
(C) Minimal dots
(D) Progress bar
(E) None
```

Map to `visual.numbering.style`:
| Choice | Value |
|---|---|
| A / empty | keep preset |
| B | `fraction-mono` |
| C | `dot` |
| D | `bar` |
| E | `none` |

For `fraction-mono`, default `position = "bottom-right"`. `dot` always renders bottom-center; `bar` spans the width.

---

### Step 3: Merge and write brand-profile.json

Apply overrides in this order (non-destructive — every layer only overwrites fields the user actually set):

1. Start from the selected preset (full valid brand profile).
2. Overlay brand identity (Round 2).
3. Overlay color overrides (Round 3) — only the fields the user changed.
4. Overlay background overrides (Round 4) — change `background.type` and the relevant sub-object.
5. Overlay grain override (Round 5).
6. Overlay numbering override (Round 6).

Write to `./brand-profile.json` with 2-space indentation. Preserve key order to match `templates/brand-profile.default.json` for human diff-ability.

### Step 4: Generate a brand preview

Build a 2-slide brand-preview strategy and render it using the existing pipeline.

Create `./brand-preview/strategy.json`:
```json
{
  "slides": [
    { "template": "title", "data": {
      "KICKER": "BRAND PREVIEW",
      "HEADLINE_LINE_1": "Your brand",
      "HEADLINE_LINE_2": "in motion"
    }},
    { "template": "bullet", "data": {
      "HEADLINE": "Three checks",
      "BULLET_1": "Colors feel right",
      "BULLET_2": "Fonts render cleanly",
      "BULLET_3": "Contrast is readable"
    }}
  ]
}
```

Run the render and preview scripts. Resolve `PLUGIN_ROOT` from `${CLAUDE_PLUGIN_ROOT}` if set, otherwise the directory containing the `.claude-plugin/plugin.json` file.

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-<resolved-path>}"
node "${PLUGIN_ROOT}/scripts/render.mjs" ./brand-profile.json ./brand-preview/strategy.json ./brand-preview/
node "${PLUGIN_ROOT}/scripts/preview.mjs" ./brand-preview/
```

### Step 5: Open the preview

```bash
open ./brand-preview/preview.html    # macOS
xdg-open ./brand-preview/preview.html # Linux
```

Fall back to printing: "Open `./brand-preview/preview.html` in your browser to see the brand preview."

### Step 6: Report

Tell the user:
- `brand-profile.json` written to `<absolute path>`
- Preset used: `<preset name>` (e.g. `editorial-serif`)
- Preview opened at `./brand-preview/preview.html`
- To edit manually, see `docs/brand-profile-schema.md` and tweak `brand-profile.json` directly, then rerun `/node-carousel:generate`
- Ready to generate their first carousel with `/node-carousel:generate <topic>`

## Design principles

- **Minimize fatigue** — every round past Round 2 accepts enter/blank to keep preset defaults.
- **Show don't list** — when asking about colors or backgrounds, show the current values (hex + color name) before asking to change.
- **Non-destructive** — every override layers on top of preset; user never has to specify fields they don't care about.
- **Mobile-aware** — Instagram users are on phones; default 1080×1350 and preset contrast ratios work for mobile reading.
- **Escape hatch** — at any point, user can say "just write the preset as-is, I'll edit later"; skip remaining rounds and jump to Step 3 with the preset + identity only.

## Edge cases

- **Existing image path** — if an existing `brand-profile.json` already uses `type: "image"`, pass the `imagePath` through during overwrite unless the user explicitly chooses a new background.
- **Invalid hex codes** — ask again with a short example of valid format (`#RRGGBB`).
- **Named colors** — accept `navy`, `white`, `black`, `cream`, `red`, `orange`, `purple`, etc. and map to canonical hex. Unknown names → ask for hex.
- **Non-interactive TTY** — fall back to writing the editorial-serif preset (safest default) with filled-in placeholder identity (`Your Brand`, `@yourbrand`, `direct, confident, no fluff`) and tell the user to edit.
- **Geist font on server without it** — if the user picks (B) neo-grotesk and reports Geist doesn't render, suggest replacing `display`/`body` with `Space Grotesk` + `Inter` as the neo-grotesk fallback pairing.

## Do not

- Validate font names against Google Fonts (pointless network call — the preview reveals problems).
- Create any files outside CWD except the plugin's own files.
- Modify `~/.claude/` or any existing plugin installations.
- Prompt for `dimensions.width` / `dimensions.height` — all presets are locked to 1080×1350.
- Ask about `accentSecondary` separately — always derive it from `accent` unless the user volunteers a value.
