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

If the URL is missing, tell the user the usage and stop.

## Behavior

### Step 1: Parse $ARGUMENTS and prepare scan dir

- Normalize the URL (add `https://` if missing).
- Parse `--references <dir>` if present. Resolve to an absolute path.
- Parse `--merge-with <path>` if present. Resolve to an absolute path.
  Don't validate schema — `scripts/scan-site.mjs` parses it as JSON and
  errors with a clear message if malformed.
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
```

The script writes `./.brand-scan/scan.json` plus `hero.png`, `full.png`,
`page.html`, `styles.css`. It exits 0 even on failure — always check
`scan.json` contents.

When `--merge-with` is passed, `scan.json` will have a `mergeWith` field
with `{ sourcePath, content }`. The synthesizer prompt (Step 7) picks this
up and applies `mergeProfile(existing, derived)` per the "existing wins
per leaf key" algorithm documented in `prompts/brand-synthesis.md` Phase 0.

Read `./.brand-scan/scan.json`. If:

- `scan.error` is set → tell the user the site couldn't be scanned and
  suggest `/node-carousel:setup` as the manual alternative. Stop.
- `scan.colors.confidence < 0.5` → warn the user:
  > Scan confidence was low (<0.5). The auto-detected colors/fonts may be
  > off. You can proceed and tweak in the edit loop, or bail with
  > `/node-carousel:setup`.
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
- **References dir empty or invalid**: `prepare-references.mjs` writes
  `ready: false` — skip analysis, proceed with site-only synthesis.
- **`brand-preview` dir already has files from a previous run**: overwrite
  is fine — slide-NN.svg names are deterministic.
- **User runs scan in a dir without write access**: let the Node script
  error surface; don't try to catch and retry elsewhere.
- **Plugin not installed (no `${CLAUDE_PLUGIN_ROOT}`)**: resolve from the
  directory containing `.claude-plugin/plugin.json` upward from CWD. If
  neither works, error with a clear message about installing the plugin.

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
