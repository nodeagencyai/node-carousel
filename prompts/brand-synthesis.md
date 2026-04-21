# Brand Synthesis Prompt

You are synthesizing scan signals into a complete `brand-profile.json`. You run
at `/node-carousel:scan` time, after `scripts/scan-site.mjs` and (optionally)
`scripts/prepare-references.mjs` + `prompts/reference-analysis.md` have
produced:

- `<scan-dir>/scan.json` — site signals (fonts, colors, meta, text samples).
  Schema documented in `scripts/scan-site.mjs` and `scripts/extract-brand-signals.mjs`.
- `<scan-dir>/references.json` (optional) — visual patterns from user's uploaded
  carousels. Schema documented in `prompts/reference-analysis.md`.

Goal: pick the closest preset, layer signals on top of it, write a complete
valid `brand-profile.json` to `./brand-profile.json`, render a 2-slide preview,
and confirm with the user.

---

## Step 1 — Pick the closest preset

There are 6 presets in `templates/presets/`:

| Preset file                          | Picks it when                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `editorial-serif.json`               | Serif display (Instrument Serif, Playfair, DM Serif, EB Garamond); cream/warm light bg; terracotta/burgundy accent    |
| `neo-grotesk.json`                   | Sans-serif (Inter, Geist, Manrope, Space Grotesk); single accent; either mode; "clean/confident"                      |
| `technical-mono.json`                | Mono display (JetBrains Mono, IBM Plex Mono, Fira Code) OR dev-tool branding; near-black bg; single vivid accent      |
| `display-serif-bold.json`            | Bold display serif (DM Serif Display, Bodoni, Playfair Display Bold); high contrast; dramatic                         |
| `utilitarian-bold.json`              | Heavy sans (Archivo Black, Inter Black, Druk); stark B&W + single accent; grid-heavy                                  |
| `satoshi-tech.json`                  | Satoshi font detected (Fontshare source); lime/neon accent; dark mode                                                 |

### Scoring procedure

Compute a confidence score per preset by tallying signal matches:

**Font family match (strong signal, weight 3):**
- Check `scan.fonts.display` (case-insensitive contains). Example: scan says
  `Instrument Serif, serif` → `editorial-serif` scores +3.
- Also check `scan.fonts.body` for mono/sans hints.
- `scan.fonts.displaySource === "fontshare"` and display is `Satoshi*` →
  `satoshi-tech` +3.

**Color mode match (weight 2):**
- `scan.colors.background` luminance < 0.2 (dark mode) boosts
  `technical-mono`, `satoshi-tech`, `neo-grotesk` (they default dark).
- Luminance > 0.85 (light/cream) boosts `editorial-serif`,
  `display-serif-bold`, `utilitarian-bold`.

**Accent hue match (weight 1):**
- Terracotta/warm red/burgundy (#B0-D0 red, low blue) → `editorial-serif`.
- Lime/neon green/yellow-green → `satoshi-tech`.
- Purple/indigo → `neo-grotesk`.
- Blue/cyan → `technical-mono`.
- Monochrome/near-greyscale accent → `utilitarian-bold`.

**Reference composition match (weight 2 when references.json exists):**
- `references.typography.displayStyle === "serif"` + `displayWeight: "bold"`
  → `display-serif-bold` +2.
- `references.typography.displayStyle === "mono"` → `technical-mono` +2.
- `references.typography.displayStyle === "display"` +
  `texture.overallFeel === "brutalist"` → `utilitarian-bold` +2.
- `references.color.mode === "dark"` reinforces whichever dark preset already
  leads on fonts.

Normalize the max score to 0–1 range by dividing by the theoretical max
(about 8 across the weighted signals). That's the preset match confidence.

### Decision

- **Best preset confidence ≥ 0.6** → use it as the base. Overrides will still
  happen in Step 2, but the preset's `background.type`, `decorations`,
  `numbering`, `grain` defaults all stand unless references say otherwise.
- **Best preset confidence < 0.6** → pick the highest-scoring preset as a
  base and add a `warnings` entry noting the low match. Bias overrides in
  Step 2 more aggressively from scan/reference signals.
- **scan.json has `error` field set or `colors.confidence < 0.3`** → bail with
  a low-confidence message and suggest `/node-carousel:setup` instead (the
  `/node-carousel:scan` command handles this fallback).

Show the user the picked preset and confidence before proceeding:

```
Closest preset: editorial-serif (match 0.78)
  Signals: display serif detected (Instrument Serif), cream background,
           warm-red accent.
```

---

## Step 2 — Build brand-profile.json

Start from the selected preset JSON (load from
`${CLAUDE_PLUGIN_ROOT}/templates/presets/<name>.json`). Overlay the following
fields. Every override is non-destructive: if a signal is missing, keep the
preset default.

### brand.name

Derive from `scan.meta.title`. Strip common suffixes:

- ` | Home`, ` | Homepage`, ` - Home`
- ` - Official Site`, ` - Official Website`
- ` | <Brand>`, ` — <Brand>` patterns that repeat the name twice
- Everything after the first ` | `, ` — `, or ` - ` in long SEO titles —
  keep the first segment.

If the result is empty, fall back to the hostname without TLD
(`acme.com` → `Acme`, title-cased).

### brand.handle

Priority order:
1. Twitter meta (`twitter:site` or `twitter:creator`) — already starts with `@`.
2. If none, derive from hostname: `acme.com` → `@acme`, `node.agency` → `@node`.
3. If the path contains `instagram.com/<name>`, extract `<name>` as handle.

### brand.tone

One line, maximum 8 words. Synthesize from:
- `scan.meta.description` — pick the voice cues (e.g. "for builders",
  "no-nonsense", "editorial").
- `scan.textSamples.heroHeadline` / `heroSubheadline` — how do they actually
  write? Short + punchy? Long + explanatory?
- `references.texture.overallFeel` if available.

Examples that are good:
- `direct, builder-voice, no fluff`
- `editorial, considered, premium`
- `playful, contrarian, opinionated`

Examples that are bad:
- `We help ambitious founders...` (sentence, not tone)
- `professional` (one word, no texture)

### visual.colors

Straight from scan:
- `background` ← `scan.colors.background` (always take this if defined;
  it's the most reliable signal).
- `text` ← `scan.colors.text` (default white on dark bg, near-black on light
  if scan couldn't detect).
- `accent` ← `scan.colors.accent` (skip if null, keep preset default).
- `accentSecondary` ← derive ~20% darker shade of accent (multiply RGB
  channels by 0.8, clamp to 0-255). If the accent is already dark
  (luminance < 0.3), instead lighten by 20%.
- `muted` ← derive as midpoint between background and text luminance,
  rounded to nearest neutral grey.

### visual.fonts

- `display` ← `scan.fonts.display` if `displaySource !== "unknown"`. Otherwise
  keep preset default and add a warning.
- `body` ← `scan.fonts.body` if `bodySource !== "unknown"`. Otherwise
  keep preset default.
- Strip CSS fallbacks (e.g. `"Inter", sans-serif` → `Inter`). Strip quotes.

### visual.background.type

Decide in this order:

1. If `references.texture.hasGrain` → keep preset's solid/gradient + enable
   grain (handled in `grain` section below). Set `type = "solid"` unless
   preset's default is richer.
2. If `references.texture.hasGradient` and no shapes → `type = "gradient"`.
3. If `references.texture.hasShapes` → `type = "geometric-shapes"` (v0.4+).
4. If the scan OG image shows a mesh/blob background or references note
   "mesh" explicitly → `type = "mesh"`.
5. If none of the above → keep preset default.

Keep all sub-objects (`gradient`, `mesh`, `radial`, `imagePath`) populated
from the preset — `render-v0.4.mjs` picks based on `type`, and populated
sub-objects make the profile self-documenting.

### visual.noise (v0.4.3) / visual.background.grain

- If `references.texture.hasGrain === true` → set
  `visual.background.grain.enabled = true`, `intensity = 0.08`,
  `baseFrequency = 0.9`.
- Otherwise, keep preset default.

### visual.decorations

Toggle from references if available:

- `cornerMarks` ← `references.decorationStyle.usesCornerMarks`
- `accentRule` ← `references.decorationStyle.usesRules`
- `numberBadges` ← `references.decorationStyle.usesOversizedNumbers`
- `pullQuoteBlock` ← `references.decorationStyle.usesPullQuotes`
- `oversizedMark` ← false unless references flag a giant mark or number

If no references, keep preset defaults.

### visual.numbering

Default to `{ "style": "fraction-mono", "position": "bottom-right" }` unless
preset says otherwise and references don't contradict it.

### visual.logo (optional)

If `scan.meta.ogImage` is a logo-looking URL (has `logo`, `icon`,
`favicon` in the path), set:

```json
"logo": {
  "path": "<abs URL>",
  "position": "top-right"
}
```

Otherwise omit the `logo` field entirely. Don't invent placeholder paths.

### visual.dimensions

Always `{ "width": 1080, "height": 1350 }`. Never change this.

---

## Step 3 — Validate and preview

1. Write the synthesized profile to `./brand-profile.json` with 2-space
   indentation. Match the key order of `templates/presets/<picked>.json`
   for human-diff-ability.

2. Render the 2-slide preview using the reusable fixture:

   ```bash
   PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-<resolved-path>}"
   mkdir -p ./brand-preview
   node "${PLUGIN_ROOT}/scripts/render-v0.4.mjs" \
     ./brand-profile.json \
     "${PLUGIN_ROOT}/test/fixtures/brand-preview-strategy.json" \
     ./brand-preview/
   node "${PLUGIN_ROOT}/scripts/preview.mjs" ./brand-preview/
   ```

3. Open the preview in the browser:

   ```bash
   open ./brand-preview/preview.html     # macOS
   xdg-open ./brand-preview/preview.html # Linux
   ```

   If the `open`/`xdg-open` fails, print the absolute path and tell the user
   to open it manually.

---

## Step 4 — Confirm

Show the user a plain-English summary of what was synthesized, then ask
exactly one question with three options:

```
Synthesized brand-profile.json:

  Preset: editorial-serif (match 0.78)
  Name: Node
  Handle: @nodeagency
  Tone: direct, builder-voice, no fluff
  Colors: bg #F8F5F0 / text #1A1A1A / accent #C84B31
  Fonts: Instrument Serif (display) / Inter (body)
  Background: solid + grain
  Decorations: accent rule, pull-quote block

Preview open at ./brand-preview/preview.html

Keep this profile? (y/n/edit)
```

Handle responses:

- **y / yes / <enter>** → confirm. Tell the user `brand-profile.json` is ready
  and suggest `/node-carousel:generate <topic>`.
- **n / no** → tell the user you'll hand off to `/node-carousel:setup` for
  the interactive wizard. Do NOT delete `brand-profile.json` — they can keep
  it as a starting point if they want.
- **edit** → enter an inline refinement loop:
  - Ask "What should change?"
  - Accept targeted edits like "make the accent purple", "tone should be
    'playful, opinionated'", "switch to neo-grotesk preset", "drop grain".
  - Re-apply edits to the in-memory profile, rewrite `brand-profile.json`,
    rerender the preview, reopen, and re-ask the confirm question.
  - Loop until user says y or n.

---

## Output contract

- Writes `./brand-profile.json` — complete, valid brand profile that
  `scripts/render-v0.4.mjs` will accept.
- Writes `./brand-preview/slide-01.svg`, `./brand-preview/slide-02.svg`,
  `./brand-preview/preview.html` via the render + preview scripts.
- Never touches `brand-profile.json` anywhere other than CWD.
- Never modifies files under `templates/presets/` or anywhere else in the
  plugin root.

## Do NOT

- Invent accent colors the scan didn't find. If accent is null, keep preset
  default and note it in warnings.
- Claim a preset match confidence >0.6 when the math says otherwise.
- Write `brand-profile.json` with empty `brand.name` — that's a render blocker.
- Add fields outside the schema that `render-v0.4.mjs` and its tokens expect.
  Stick to the preset structure.
- Skip the preview render — the user needs to see it to confirm.
- Start the refinement loop without first writing `brand-profile.json` —
  the file on disk is the source of truth for the edit loop.
