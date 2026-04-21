# Brand Synthesis Prompt

You are synthesizing scan signals into a complete `brand-profile.json`. You run
at `/node-carousel:scan` time, after `scripts/scan-site.mjs`,
`prompts/screenshot-analysis.md`, `prompts/voice-niche-analysis.md`, and
(optionally) `scripts/prepare-references.mjs` + `prompts/reference-analysis.md`
have produced:

- `<scan-dir>/scan.json` — site signals (fonts, colors, meta, text samples,
  multi-page `textContent`, `logo` descriptor, optional `brandfetch` payload).
  Schema documented in `scripts/scan-site.mjs` and
  `scripts/extract-brand-signals.mjs`.
- `<scan-dir>/vision-analysis.json` — visual signals that CSS can't see
  (hierarchy, whitespace, composition, imagery, density, mood). Always present.
  Schema documented in `prompts/screenshot-analysis.md`.
- `<scan-dir>/voice-niche.json` — copy-only voice + niche classification
  (register, energy, confidence, style, warmth, industry, audience,
  productType, `tone` string). Always present.
  Schema documented in `prompts/voice-niche-analysis.md`.
- `<scan-dir>/references.json` (optional) — visual patterns from user's uploaded
  carousels. Schema documented in `prompts/reference-analysis.md`.
- `scan.brandfetch` (optional) — if BrandFetch API key was set and the domain
  was in BrandFetch's DB, `scan.json` has a `brandfetch` field with
  `{ available: true, data: { name, description, logos[], colors[], fonts[],
  industries[] } }`. When absent, `{ available: false, reason }`. Authoritative
  for logos + colors when present.

Goal: pick the closest preset, layer signals on top of it, write a complete
valid `brand-profile.json` to `./brand-profile.json`, render a 2-slide preview,
and confirm with the user.

---

## Source priority

When two sources disagree, resolve in this order (1 wins):

1. **BrandFetch** (`scan.brandfetch.data`, when `available: true`) —
   authoritative for **logos** and **colors**. BrandFetch hand-curates, so its
   hex codes and logo SVGs beat CSS clustering + inline-SVG extraction.
2. **vision-analysis.json** — authoritative for **visual hierarchy**,
   **composition**, **whitespace**, **density**, and **mood**. The CSS scan
   can't see pixels; this pass can.
3. **voice-niche.json** — authoritative for **tone**, **voice register**,
   **warmth**, and **niche**. The copy pass read the actual words; scan.json's
   `meta.description` is a one-line summary at best.
4. **references.json** (when the user provided references) — authoritative
   for **composition patterns** (`cornerMarks`, `accentRule`, `numberBadges`,
   `pullQuoteBlock`, grain/gradient/shapes toggles). The user's own carousels
   are the clearest signal for how their carousels should look.
5. **scan.json** — authoritative when nothing else has a signal. Fonts,
   typography classification, and raw CSS-extracted colors come from here
   unless BrandFetch overrides. `scan.meta.title` is still the source of truth
   for `brand.name`.

If a higher-priority source is missing or `uncertain`, fall through to the
next one. Never overwrite a confident higher-priority signal with a
lower-priority default.

---

## Background color reconciliation

`scan.colors.background` is extracted from computed CSS on the `<body>` or
hero section, and many modern site builders (Framer, Webflow, Squarespace)
ship a `#FFFFFF` body default even when the visible hero is dark — the dark
surface is painted by an absolutely-positioned section, a canvas, or a
full-bleed image that CSS clustering misses. Vision analysis sees pixels, so
it's the tiebreaker when scan and vision disagree on lightness.

Apply this rule before filling `visual.colors.background` in Step 2:

1. **Vision says dark** — if `vision-analysis.json` is available AND its
   `observations`, `imagery.notes`, or `mood` contains any of: `dark`,
   `black`, `near-black`, `midnight`, `cosmic`, `deep`, `void`, `space` →
   vision wins. Use a dark background. If vision gives a specific hex,
   use it; otherwise default to `#0A0A0A`. Sample a closer tone from
   vision's description when it's specific (e.g. "deep navy" → `#0A0F1E`,
   "warm charcoal" → `#1A1714`).
2. **Vision says light** — if vision describes `light`, `white`, `cream`,
   `off-white`, `paper`, `bright` → scan's background is most likely
   correct. Use `scan.colors.background` as-is.
3. **Vision says tinted** — if vision describes a colored tint (e.g.
   `warm cream`, `soft blue haze`, `muted peach`) → defer to
   `scan.colors.background` if it doesn't conflict on lightness. If it
   does conflict (scan is `#FFFFFF` but vision says `warm cream`), pick
   the color best described by vision (`#F8F2E8` for warm cream, etc.).
4. **No vision analysis** — use `scan.colors.background` directly.

### Concrete example (nodeagency.ai, v0.6 scan)

- `scan.colors.background` → `#FFFFFF` (Framer body default)
- `vision-analysis.observations` → "Dark near-black background with
  swirling grey vortex"
- Rule 1 fires on `dark` + `near-black` → vision wins → resolved bg
  `#0A0A0A`.

### Resolution note (recommended, optional for v0.6.1)

When a reconciliation fires, emit a resolution note on the
`brand-profile.json` so downstream tooling and the user can audit the
call:

```json
"resolution": {
  "background": {
    "from": "vision",
    "reason": "scan reported #FFFFFF (Framer body default) but vision observed 'near-black background with swirling grey vortex' — vision wins per background reconciliation rule 1"
  }
}
```

Valid `from` values: `"scan"`, `"vision"`, `"brandfetch"`, `"preset"`.
Keep `reason` one sentence, cite which rule fired.

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

**Vision-analysis re-weighting (weight 2 when vision-analysis.json exists):**
- `imagery.style === "type-only"` + `composition === "asymmetric-left"` or
  `"asymmetric-right"` → `display-serif-bold` +2 (and mark
  `cover-asymmetric` as a preferred pattern default).
- `mood` contains `editorial` + `whitespace` in
  {`airy`, `editorial-spacious`} → `editorial-serif` +2.
- `mood` contains `tech` + `whitespace` is `tight` or `balanced` →
  `technical-mono` or `satoshi-tech` +1 (reinforces dark-mode fonts above).
- `mood` contains `bold` + `density` is `dense` or `maximalist` →
  `utilitarian-bold` +2.

**Voice + niche re-weighting (weight 2 when voice-niche.json exists):**
- `voice.register === "casual"` + `voice.warmth === "warm"` →
  `editorial-serif` +2.
- `voice.style === "builder-voice"` + `voice.register === "technical"` →
  `technical-mono` +2.
- `niche.industry` contains any of (`dev tool`, `developer tool`, `API`,
  `SDK`, `devtool`) case-insensitive → `technical-mono` +2.
- `niche.industry` contains any of (`agency`, `studio`, `consultancy`) →
  `neo-grotesk` +2 OR `utilitarian-bold` +1 (pick neo-grotesk unless mood
  already points brutalist).
- `voice.confidence === "playful"` + `voice.energy === "high"` →
  `satoshi-tech` +1 (neon palette fits playful tech brands).

Normalize the max score to 0–1 range by dividing by the theoretical max
(about 12 across all weighted signals when every source is present;
8 when only scan + one extra signal exists). That's the preset match
confidence.

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

### brand.tone / brand.voice.tone

Primary source: `voice-niche.json`'s `tone` field. That prompt already
constrained its output to the brand-profile.json contract (3-4
comma-separated adjectives, max 8 words, no em-dashes). Drop it straight in.

Populate BOTH locations for backwards-compat with existing renderers:
- `brand.tone` ← `voice-niche.json`'s `tone`
- `brand.voice = { tone: <same string>, register, warmth }` — pass through
  `voice.register` and `voice.warmth` too so `/node-carousel:generate` can
  bias copy beyond the tone adjectives.

Fallback when `voice-niche.json.tone` is empty or
`voice-niche.json.confidence < 0.3`:
- Synthesize from `scan.meta.description` voice cues (e.g. "for builders",
  "no-nonsense", "editorial").
- Check `scan.textSamples.heroHeadline` / `heroSubheadline` — short + punchy
  or long + explanatory.
- Check `references.texture.overallFeel` if available.
- Keep it 3-4 comma-separated adjectives, max 8 words, no em-dashes.

Examples that are good:
- `direct, builder-voice, no fluff`
- `editorial, considered, premium`
- `playful, contrarian, opinionated`

Examples that are bad:
- `We help ambitious founders...` (sentence, not tone)
- `professional` (one word, no texture)

### brand.niche (optional)

If `voice-niche.json.confidence >= 0.5` and `niche.industry` is non-empty,
copy the niche block through:

```json
"niche": {
  "industry": "<voice-niche.json's industry>",
  "audience": "<voice-niche.json's audience>",
  "productType": "<voice-niche.json's productType>"
}
```

`/node-carousel:generate` reads this to bias slide copy (e.g. a dev-tool
brand gets technical angles; an agency gets case-study angles). Omit the
block if voice-niche confidence is too low or fields are empty.

### visual.colors

BrandFetch wins when available. Fall back to scan.

**If `scan.brandfetch.available === true` and `scan.brandfetch.data.colors`
is non-empty:**
- Match BrandFetch colors by `type`:
  - `type === 'light'` or `'background'` → `background`
  - `type === 'dark'` or `'text'` → `text`
  - `type === 'accent'` or `'brand'` → `accent` (pick the first)
  - If a second `accent`/`brand` entry exists → `accentSecondary`
- If BrandFetch is missing one of these roles, fall through to scan for
  the missing slot only.

**Otherwise (no BrandFetch, or BrandFetch didn't provide the slot):**
- `background` ← `scan.colors.background` (always take this if defined;
  it's the most reliable CSS signal).
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

Decide in this order (references beat vision beat preset default):

1. If `references.texture.hasGrain` → keep preset's solid/gradient + enable
   grain (handled in `grain` section below). Set `type = "solid"` unless
   preset's default is richer.
2. If `references.texture.hasGradient` and no shapes → `type = "gradient"`.
3. If `references.texture.hasShapes` → `type = "geometric-shapes"` (v0.4+).
4. If `vision-analysis.imagery.style === "abstract"` and references didn't
   set a type → `type = "mesh"` (gradient blobs / non-representational shapes
   usually render well as a mesh background).
5. If `vision-analysis.imagery.style === "type-only"` and
   `vision-analysis.whitespace` is `airy` or `editorial-spacious` → keep
   `type = "solid"`. Editorial brands want the headline to carry the slide.
6. If the scan OG image shows a mesh/blob background or references note
   "mesh" explicitly → `type = "mesh"`.
7. If none of the above → keep preset default.

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

Prefer BrandFetch's curated SVG over scan's extracted logo. Pick in this
order:

1. **BrandFetch SVG** — if `scan.brandfetch.available === true` and
   `scan.brandfetch.data.logos` contains an entry with
   `type === 'logo'` and `format === 'svg'`, use its `url` as the logo
   file.
2. **BrandFetch PNG/other** — if BrandFetch has any `type === 'logo'`
   entry but no SVG, use its `url`.
3. **Scan inline-svg** — if `scan.logo.type === 'inline-svg'`, use
   `scan.logo.path` (a local file path in the scan dir).
4. **Scan img** — if `scan.logo.type === 'img'`, use `scan.logo.path`.
5. **Scan favicon** — if `scan.logo.type === 'favicon'`, use
   `scan.logo.path`. Favicons are last-resort — low res, often cropped —
   but still better than no mark.
6. **None** — if `scan.logo.type === 'none'` and no BrandFetch logos,
   omit the `logo` field entirely. Don't invent placeholder paths.

When a logo source is picked, set:

```json
"logo": {
  "file": "<logo-path-or-url>",
  "position": "top-right",
  "size": 48
}
```

- `position` defaults to `"top-right"`. Valid alternatives:
  `"top-left"`, `"bottom-left"`, `"bottom-right"`. The user can override
  in `brand-profile.json` post-setup.
- `size` defaults to `48` (px). Renderer scales proportionally.
- Field is named `file` (not `path`) to match the brand-profile schema.

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
