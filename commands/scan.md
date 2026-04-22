# /node-carousel:scan

Auto-detect a brand from a live website (and optionally a folder of reference
carousels), synthesize a complete `brand-profile.json`, preview it, and let
the user confirm before saving. Zero-question path for most users.

**User's request:** $ARGUMENTS

## Usage

```
/node-carousel:scan https://yourbrand.com
/node-carousel:scan https://yourbrand.com --references ./my-carousels/
/node-carousel:scan https://yourbrand.com --merge-with ./brand-profile.json
/node-carousel:scan https://yourbrand.com --preset technical-mono
/node-carousel:scan https://yourbrand.com --ask
```

- First positional argument: URL to scan (required).
- `--references <dir>`: optional path to a directory containing 1-5 reference
  carousel PNGs/JPGs. When provided, Claude visually analyzes them to extract
  composition, typography, color, and decoration patterns.
- `--merge-with <path>`: optional path to an existing `brand-profile.json`
  whose non-null fields should win over scan-derived values. Use this when
  your carousel brand differs from your marketing-site brand (e.g. different
  fonts / colors / background treatment) — the scan still gives you fresh
  text samples, meta, warnings, and vision analysis, but your hand-tuned
  identity is preserved. Merge semantics: field-level precedence ("existing
  wins per leaf key"). See `prompts/brand-synthesis.md` Phase 0 for details.
- `--preset <name>`: optional force flag (v0.7 A.4). Skips the synthesizer's
  weighted-signal preset matching and uses the named preset as
  `visual.preset` directly. Useful when the auto-match confidence is low
  (the synthesizer would warn) or when your carousel brand differs from
  your website brand. All other overrides (colors, fonts, logo, tone,
  niche) still run. Valid names (case-insensitive):
  `editorial-serif`, `neo-grotesk`, `technical-mono`,
  `display-serif-bold`, `utilitarian-bold`, `satoshi-tech`. Unknown names
  error before the scan runs. `--preset` and `--merge-with` can be combined.
- `--ask`: optional interactive questionnaire (v0.7.1). After the scan runs, before
  synthesis, Claude asks 5 quick questions about style preferences that can't be
  inferred from CSS (density, visual style, content weight, mood override, logo
  placement). Every question has a "Custom: type your own answer" escape for free
  text. Preferences get written to `./.brand-scan/preferences.json` and consumed by
  the synthesizer as a SIXTH input source. When not passed, scan proceeds zero-question
  (v0.7 behavior).

If the URL is missing, tell the user the usage and stop.

## Behavior

### Step 1: Parse $ARGUMENTS and prepare scan dir

- Normalize the URL (add `https://` if missing).
- Parse `--references <dir>` if present. Resolve to an absolute path.
- Parse `--merge-with <path>` if present. Resolve to an absolute path.
  Don't validate schema — `scripts/scan-site.mjs` parses it as JSON and
  errors with a clear message if malformed.
- Parse `--preset <name>` if present. Pass through to
  `scripts/scan-site.mjs` — that script validates against the 6 canonical
  preset names (`editorial-serif`, `neo-grotesk`, `technical-mono`,
  `display-serif-bold`, `utilitarian-bold`, `satoshi-tech`),
  case-insensitive, and exits with a clear error on unknown values.
- Parse `--ask` if present (boolean, no value). Pass through to
  `scripts/scan-site.mjs` — the script records
  `askPreferences: true` in `scan.json`. The interactive questionnaire
  itself runs at command-runtime in Step 6.5 below (scan-site.mjs never
  prompts).
- Create `./.brand-scan/` in CWD (this is a working directory — do not
  ship it anywhere).
- Resolve `PLUGIN_ROOT` from `${CLAUDE_PLUGIN_ROOT}` if set, otherwise the
  directory containing the `.claude-plugin/plugin.json` file.

### Step 2: Check for existing brand-profile.json

If `./brand-profile.json` already exists, ask:

```
A `brand-profile.json` already exists here. Overwrite it? (y/N)
```

Default no. If no, stop and tell them to delete it first or run
`/node-carousel:setup` to edit interactively.

### Step 3: Run the site scan

```bash
node "${PLUGIN_ROOT}/scripts/scan-site.mjs" <url> ./.brand-scan/
# OR, when --merge-with was passed:
node "${PLUGIN_ROOT}/scripts/scan-site.mjs" <url> ./.brand-scan/ --merge-with <abs-path-to-existing-brand-profile.json>
# OR, when --preset was passed:
node "${PLUGIN_ROOT}/scripts/scan-site.mjs" <url> ./.brand-scan/ --preset <name>
# OR, when --ask was passed:
node "${PLUGIN_ROOT}/scripts/scan-site.mjs" <url> ./.brand-scan/ --ask
# Flags can be combined — e.g. --merge-with ... --preset ... --ask
```

The script writes `./.brand-scan/scan.json` plus `hero.png`, `full.png`,
`page.html`, `styles.css`. It exits 0 even on failure — always check
`scan.json` contents.

When `--merge-with` is passed, `scan.json` will have a `mergeWith` field
with `{ sourcePath, content }`. The synthesizer prompt (Step 7) picks this
up and applies `mergeProfile(existing, derived)` per the "existing wins
per leaf key" algorithm documented in `prompts/brand-synthesis.md` Phase 0.

When `--preset <name>` is passed, `scan.json` will have a top-level
`forcedPreset: "<name>"` field (mirrored at `merged.forcedPreset`). The
synthesizer prompt skips its weighted-signal preset matching and uses the
forced preset directly as `visual.preset`. All other override rules
(colors, fonts, logo, tone, niche) still run. See
`prompts/brand-synthesis.md` → "Forced preset override (v0.7 A.4)".

Read `./.brand-scan/scan.json`. If:

- `scan.error` is set → tell the user the site couldn't be scanned and
  suggest `/node-carousel:setup` as the manual alternative. Stop.
- `scan.colors.confidence < 0.5` → warn the user:
  > Scan confidence was low (<0.5). The auto-detected colors/fonts may be
  > off. You can proceed and tweak in the edit loop, or bail with
  > `/node-carousel:setup`. See `docs/confidence-guide.md` for what to do
  > at your confidence level.
  Offer to proceed (y) or bail (n). Default y (the edit loop gives them
  a chance to fix it).
- `scan.warnings` has entries — surface them to the user as a plain list
  before continuing. Common ones: JS-rendered page, missing fonts, missing
  h1. None are fatal on their own.

### Step 4: Analyze the hero screenshot (always)

Follow `${PLUGIN_ROOT}/prompts/screenshot-analysis.md` precisely. That prompt
tells you to:

- Use your multimodal `Read` tool to load `./.brand-scan/hero.png` (or fall
  back to `full.png` if hero is missing). Claude Code's `Read` natively
  handles PNG, so you will actually see the image.
- Classify six signals: hierarchy, whitespace, composition, imagery,
  density, mood.
- Write `./.brand-scan/vision-analysis.json`.

This step always runs — every scan produces a screenshot, and the
synthesizer depends on these visual signals.

### Step 4a: Vision fingerprint (always)

After screenshot-analysis.md produces its abstract classification, also run the vision-fingerprint prompt to capture structured measurements the synthesizer + renderer consume directly.

Follow `${PLUGIN_ROOT}/prompts/vision-fingerprint.md` precisely. Writes `./.brand-scan/vision-fingerprint.json`. This runs alongside vision-analysis.json — the analysis gives abstract mood tags (hierarchy/whitespace/composition/imagery/density/mood enums), the fingerprint gives precise measurements (specific gradient stops, overlay positions, effect parameters). Both feed the synthesizer; scan-first synthesis (Phase 0.75) consumes the fingerprint.

If the hero screenshot is unavailable or vision can't confidently assess, the prompt writes a low-confidence fingerprint with null fields. The synthesizer handles that gracefully by falling back to preset.

### Step 5: Analyze voice + niche from copy (always)

Follow `${PLUGIN_ROOT}/prompts/voice-niche-analysis.md` precisely. That
prompt tells you to:

- Read `./.brand-scan/scan.json` and pull the `textContent` object
  (`headings`, `mainText`, `ctas`, `metaDescription`).
- Classify voice (register, energy, confidence, style, warmth) and niche
  (industry, audience, productType).
- Synthesize a single-line `tone` string (3-4 comma-separated adjectives,
  max 8 words, no em-dashes).
- Write `./.brand-scan/voice-niche.json`.

This also always runs. If `textContent` is empty (JS-heavy site with no
extractable copy), the prompt writes a low-confidence file with mostly
`uncertain` values — the synthesizer handles that fallback.

### Step 6: Prepare references (if `--references` passed)

```bash
node "${PLUGIN_ROOT}/scripts/prepare-references.mjs" <refs-dir> ./.brand-scan/
```

This writes `./.brand-scan/references-manifest.json` listing validated image
paths. Check `manifest.ready`:

- `ready: false` (zero valid images found) → tell the user no valid
  references were found and skip to Step 7 (synthesis without references).
  Surface any warnings from the manifest.
- `ready: true` → proceed to Step 6a.

#### Step 6a: Visually analyze references

Follow `${PLUGIN_ROOT}/prompts/reference-analysis.md` precisely. That prompt
tells you to:

- Read each image file from the manifest using your multimodal `Read` tool
  (Claude Code's `Read` natively handles PNG/JPG — you will actually see
  each image).
- Synthesize observations into a valid `references.json` at
  `./.brand-scan/references.json`.

Do not skip reading the images — the whole point is visual analysis.

### Step 6.5: Ask preferences (if `--ask` passed)

If `scan.json.askPreferences === true` (set when user passed `--ask`), run the interactive questionnaire BEFORE synthesis. This captures style preferences that scan/vision/voice can't infer from CSS.

**Use the `AskUserQuestion` tool — don't ask inline.** The tool renders visual option-pickers (same UX as `/plan`), auto-adds an "Other" free-text escape on every question, and avoids making the user type numbers.

Max 4 questions per `AskUserQuestion` call, so this runs in TWO calls:

#### Call 1 — four questions in one batch

```
AskUserQuestion({
  questions: [
    {
      header: "Density",
      question: "How much content per slide?",
      multiSelect: false,
      options: [
        { label: "Minimalist", description: "Big type, lots of space, 2-3 lines per slide" },
        { label: "Standard", description: "Preset default — balanced" },
        { label: "Dense", description: "More content per slide, smaller type" }
      ]
    },
    {
      header: "Visual style",
      question: "What's the background feel?",
      multiSelect: false,
      options: [
        { label: "Clean gradient", description: "Smooth two-stop color wash" },
        { label: "Paper (editorial)", description: "Warm noise + grit texture, Lenny's Newsletter vibe" },
        { label: "Mesh (blurred blobs)", description: "3-4 soft color blobs, Stripe-style" },
        { label: "Match the scan", description: "Use what was auto-detected from the site" }
      ]
    },
    {
      header: "Content weight",
      question: "Text-heavy or visual-heavy?",
      multiSelect: false,
      options: [
        { label: "Text-heavy", description: "Headlines do the work, sparse visuals" },
        { label: "Balanced", description: "Mix of text and visual elements" },
        { label: "Icon + number heavy", description: "Data-viz style, stats and icons dominate" }
      ]
    },
    {
      header: "Mood",
      question: "Override the detected mood?",
      multiSelect: false,
      options: [
        { label: "Editorial", description: "Premium, considered, warm — editorial-serif preset" },
        { label: "Clinical", description: "Stark, minimal, no-nonsense — utilitarian-bold preset" },
        { label: "Playful", description: "Energetic, bold, electric — satoshi-tech preset" },
        { label: "Match scan", description: "Use vision-detected mood (recommended if you don't have strong opinion)" }
      ]
    }
  ]
})
```

#### Call 2 — the 5th question

```
AskUserQuestion({
  questions: [
    {
      header: "Logo position",
      question: "Where should the brand logo sit on cover + CTA slides?",
      multiSelect: false,
      options: [
        { label: "Top-right", description: "Default — logo in the upper-right corner" },
        { label: "Top-left", description: "Logo in the upper-left corner" },
        { label: "Bottom-right", description: "Logo in the lower-right corner" },
        { label: "None", description: "Don't render a logo (omit visual.logo block)" }
      ]
    }
  ]
})
```

#### Mapping user answers to canonical enum values

The tool returns `answers: { "<question text>": "<label or Other text>" }`. Map labels → enums before writing preferences.json:

| Question | Selected label | Canonical value |
|---|---|---|
| Density | "Minimalist" | `minimalist` |
| Density | "Standard" | `standard` |
| Density | "Dense" | `dense` |
| Visual style | "Clean gradient" | `gradient` |
| Visual style | "Paper (editorial)" | `paper` |
| Visual style | "Mesh (blurred blobs)" | `mesh` |
| Visual style | "Match the scan" | `match-scan` |
| Content weight | "Text-heavy" | `text-heavy` |
| Content weight | "Balanced" | `balanced` |
| Content weight | "Icon + number heavy" | `icon-heavy` |
| Mood | "Editorial" | `editorial` |
| Mood | "Clinical" | `clinical` |
| Mood | "Playful" | `playful` |
| Mood | "Match scan" | `match-scan` |
| Logo position | "Top-right" | `top-right` |
| Logo position | "Top-left" | `top-left` |
| Logo position | "Bottom-right" | `bottom-right` |
| Logo position | "None" | `none` |

#### Handling "Other" (free-text)

When the user selects "Other" on any question, the tool returns their typed text as the answer. Treat this as the `Custom: <text>` form:
- Set the field value to `"custom"`
- Write the free text to `customNotes.<field>`
- Pass the full raw object (including the `Custom:` prefix) to `parsePreferences` so the parser handles normalization uniformly — e.g. raw input `{ density: "Custom: notebook paper vibes" }` → parsed `{ density: "custom", customNotes: { density: "notebook paper vibes" } }`

**Tip for Other-handling:** before calling `parsePreferences`, convert Other answers to the `Custom: ...` string form:
```javascript
const raw = {};
if (answer1 matched canonical label) raw.density = canonicalValue;
else raw.density = `Custom: ${answer1}`;  // Other / free text path
// ... repeat for each field
```

#### Finalize

Use `scripts/preferences.mjs` `parsePreferences` to validate + normalize:
```javascript
import { parsePreferences } from '<PLUGIN_ROOT>/scripts/preferences.mjs';
const parsed = parsePreferences(raw);
writeFileSync('./.brand-scan/preferences.json', JSON.stringify(parsed, null, 2));
```

Enum value reference (what the synthesizer expects):
- density: `minimalist` | `standard` | `dense` | `custom`
- visualStyle: `gradient` | `paper` | `geometric` | `photo` | `mesh` | `match-scan` | `custom`
- contentWeight: `text-heavy` | `balanced` | `icon-heavy` | `custom`
- moodOverride: `playful` | `premium` | `clinical` | `scrappy` | `editorial` | `match-scan` | `custom`
- logoPlacement: `top-right` | `top-left` | `bottom-right` | `none` | `custom`

(Note: some canonical enum values — `geometric`, `photo`, `premium`, `scrappy` — aren't in the primary question options. Users who want those pick "Other" and type them. The parser accepts the canonical value directly: e.g. `Custom: scrappy` would be captured as `customNotes: { moodOverride: "scrappy" }` — the synthesizer reads the note and uses it as guidance.)

If the user skips a question (tool returns empty/null for that question), default the field to the canonical "match scan" equivalent: `match-scan` for mood/visualStyle, `standard` for density, `balanced` for content weight, `top-right` for logo. The `parsePreferences` DEFAULTS handle this automatically when the raw object omits the key.

If the user passed `--no-ask` OR the flag is absent, don't write preferences.json. Synthesizer proceeds without this sixth input.

### Step 7: Synthesize brand-profile.json

Follow `${PLUGIN_ROOT}/prompts/brand-synthesis.md` precisely. The synthesizer
now consumes FIVE inputs:

1. `./.brand-scan/scan.json` — fonts, colors, meta, text samples,
   multi-page `textContent`, `logo` descriptor, optional `brandfetch`
   payload.
2. `./.brand-scan/vision-analysis.json` — hierarchy, composition,
   whitespace, mood (always present after Step 4).
3. `./.brand-scan/voice-niche.json` — voice classification + `tone` string
   + niche (always present after Step 5).
4. `./.brand-scan/references.json` — reference carousel patterns (optional,
   only if Step 6 produced one).
5. BrandFetch data nested inside `scan.brandfetch.data` (optional, only
   when API key is set and the brand is in BrandFetch's DB).

The synthesizer prompt handles source priority (BrandFetch > vision >
voice > references > scan), preset re-weighting based on vision + voice
signals, logo mapping, and tone integration. It writes
`./brand-profile.json` when done.

### Step 8: Render the 2-slide preview

```bash
mkdir -p ./brand-preview
node "${PLUGIN_ROOT}/scripts/render-v0.4.mjs" \
  ./brand-profile.json \
  "${PLUGIN_ROOT}/test/fixtures/brand-preview-strategy.json" \
  ./brand-preview/
node "${PLUGIN_ROOT}/scripts/preview.mjs" ./brand-preview/
```

If the render fails, surface the error verbatim (the script has
user-facing messages). Common causes: brand-profile.json missing
`brand.name`, or an invalid hex code.

### Step 9: Open preview

```bash
open ./brand-preview/preview.html     # macOS
xdg-open ./brand-preview/preview.html # Linux
```

If opening fails silently, print the absolute path and tell the user to open
it manually.

### Step 10: Confirm

Show a plain-English summary of what was synthesized (see
`prompts/brand-synthesis.md` Step 4 for the exact format), then ask:

```
Keep this profile? (y/n/edit)
```

Handle the response:

- **y / yes / empty** → Confirm. Tell the user:
  > Saved to `./brand-profile.json`. Run
  > `/node-carousel:generate <topic>` to build your first carousel.
  Done.
- **n / no** → Fall back to the wizard:
  > No problem — run `/node-carousel:setup` for the interactive voice-first
  > wizard. Your scanned `brand-profile.json` is still on disk; you can
  > reuse it as a starting point or delete it.
  Done.
- **edit / e** → Enter the refinement loop (Step 11).

### Step 11: Inline refinement loop (on "edit")

Repeat until the user says y or n:

1. Ask: "What should change?"
2. Accept targeted edits:
   - Color: "make the accent purple" → look up named color or ask for hex.
   - Font: "use Geist for display" → set `visual.fonts.display`.
   - Preset swap: "switch to neo-grotesk" → reload that preset and
     re-apply identity + any previous edits the user explicitly made.
   - Background: "drop the grain" / "use a mesh gradient" / "solid only".
   - Tone: "tone should be 'playful, opinionated'".
   - Decorations: "no corner marks" / "add pull quotes".
3. Rewrite `./brand-profile.json` with the updated profile.
4. Rerun the render + preview:
   ```bash
   node "${PLUGIN_ROOT}/scripts/render-v0.4.mjs" \
     ./brand-profile.json \
     "${PLUGIN_ROOT}/test/fixtures/brand-preview-strategy.json" \
     ./brand-preview/
   ```
   (Skip `preview.mjs` on repeat iterations — the HTML just references the
   SVGs, which get overwritten.)
5. Tell the user to refresh their browser.
6. Re-ask "Keep this profile? (y/n/edit)".

## Edge cases

- **URL missing**: print usage, stop. Don't silently default to a domain.
- **Non-http URL (e.g. `file://`)**: reject — tell user to scan a live site.
- **Scan fails entirely** (`scan.error` set): fall back to
  `/node-carousel:setup` suggestion. Stop.
- **Low scan confidence** (`colors.confidence < 0.5`): warn, let user
  decide to proceed or bail. Don't silently generate a bad profile.
- **Missing hero headline / no h1**: `scan.textSamples.heroHeadline` will
  be null. Synthesis falls back to meta description for tone. Add a
  warning.
- **Existing `brand-profile.json`**: ask y/N overwrite. Default N to
  protect existing work.
- **No `--references` flag**: site-only scan. Skip Step 6 entirely.
  Steps 4 (vision) + 5 (voice) still run — they only need scan outputs.
- **No `--ask` flag**: skip Step 6.5 entirely; synthesis uses 5 inputs
  (v0.7 behavior). `preferences.json` is NOT written.
- **User skips all questions** (hits enter through the questionnaire):
  `preferences.json` written with DEFAULTS; synthesizer treats as "no
  strong preferences" (match-scan everywhere).
- **User picks "Custom" on a question**: captured under
  `customNotes.<key>`; synthesizer uses as guidance, not hard override.
- **Preferences conflict with scan signals**: preferences sit BELOW
  `mergeWith` but ABOVE scan/vision/voice in the source priority tiers.
- **References dir empty or invalid**: `prepare-references.mjs` writes
  `ready: false` — skip analysis, proceed with site-only synthesis.
- **`brand-preview` dir already has files from a previous run**: overwrite
  is fine — slide-NN.svg names are deterministic.
- **User runs scan in a dir without write access**: let the Node script
  error surface; don't try to catch and retry elsewhere.
- **Plugin not installed (no `${CLAUDE_PLUGIN_ROOT}`)**: resolve from the
  directory containing `.claude-plugin/plugin.json` upward from CWD. If
  neither works, error with a clear message about installing the plugin.
- **Scan detected unknown font source** (e.g. Gilroy on a site that
  self-hosts it): synthesizer emits `visual.fonts.display` as object form
  with `file: null` and a `font-self-hosted-required` warning. Drop the
  font file in `./brand-fonts/` (in the same dir as `brand-profile.json`)
  and fill in the path before running `/node-carousel:generate`. See
  `docs/custom-fonts.md` for the full workflow.

## Design principles

- **Zero questions on the happy path** — scan, synthesize, preview,
  confirm. The only prompt is y/n/edit.
- **Surface warnings but don't block** — a partial scan is still useful
  as a starting point for the edit loop.
- **Non-destructive on fallback** — "n" never deletes `brand-profile.json`.
  Setup wizard can overwrite it explicitly if the user runs that next.
- **Edit loop beats regeneration** — the refinement loop updates one field
  at a time instead of rerunning the whole scan.
- **Preview is the source of truth** — users confirm based on what they
  see, not the JSON summary.

## Do not

- Write anything outside CWD (`./.brand-scan/`, `./brand-profile.json`,
  `./brand-preview/`).
- Modify files under `${CLAUDE_PLUGIN_ROOT}`. The plugin is read-only.
- Touch `~/.claude/` or existing plugin installations.
- Skip the visual analysis of references when `--references` is passed and
  valid — Claude's multimodal `Read` is the whole reason this command
  exists.
- Save a `brand-profile.json` with empty `brand.name` — that blocks the
  renderer. Derive from hostname if meta title is blank.
- Prompt for dimensions or aspect ratio — all presets lock to 1080×1350.
