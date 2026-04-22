# Node Carousel v0.7.1 — Interactive Preferences + Custom Fonts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two user-directed features so the plugin works for real designers: (1) a 5-question interactive preference pass after scan but before synthesis — every question has a "Custom" escape for free-text input, (2) support for self-hosted font files (`.woff2`/`.woff`/`.ttf`/`.otf`) that get base64-embedded into rendered SVGs so licensed brand fonts like Gilroy actually render.

**Architecture:**
1. Preserve v0.7 zero-question happy path — preferences are opt-in via a `--ask` flag; `--no-ask` (or absence) skips the questionnaire
2. Preferences live in a new JSON file `./.brand-scan/preferences.json` that the synthesizer consumes as a SIXTH input source after mergeWith/vision/voice/references/scan/brandfetch
3. Font schema evolves: `visual.fonts.{display,body}` accepts either a string (existing — Google Fonts family name) OR an object `{family, file, weight?, style?}` — synthesizer writes the object form when a file is specified
4. Renderer detects font-object form and switches from `@import` to inline `@font-face` with base64 data URI embedded in the SVG — making the output fully self-contained and portable
5. Brand-fonts directory convention: `./brand-fonts/` in CWD for user drops, with absolute-path fallback supported

**Tech stack:** Existing (Puppeteer + Node stdlib). Node's native `fs.readFileSync` + `Buffer.toString("base64")` for font embedding. No new npm deps.

**Constraints (non-negotiable):**
- DO NOT break v0.7 CLI — existing `/node-carousel:scan <url>` and all flags must continue working unchanged
- DO NOT touch `patterns/`, `tokens/`, or the 6 presets — frozen feature surfaces
- Font schema must remain backwards-compatible — existing brand-profiles with string fonts (e.g. `"display": "JetBrains Mono"`) must render byte-identically
- Preferences are ALWAYS optional — pressing enter through questions or passing `--no-ask` skips them with sensible defaults
- Font files are embedded as base64 data URIs — no external file references in emitted SVGs (must be self-contained for social-platform upload)
- Every question has a "Custom: type your own answer" escape; synthesizer prompt accepts free text and uses it as guidance not a strict enum
- Max font file size: 500 KB per file (warn at 250 KB). Enforce cap to prevent runaway SVG bloat.
- Preserve paper-aesthetic `editorial-serif` regression render — Niek's validated "engaging already" output

**Research inputs:**
- TPS scan test today surfaced two real problems: scan misfired on Gilroy (licensed font → fell back to Manrope substitute), and no way for user to express style preference (Framer 3D hardware aesthetic isn't what carousels should look like even if it IS what the site looks like)
- User's direct ask: "also give them the ability to load fonts or something in to the plugin? font files if it is not online on google fonts?"
- v0.7 validated that scan+synthesize misfires are inevitable when website brand ≠ carousel brand — preferences are the missing expression layer

---

## Phase A: Preference questionnaire

Goal: an optional interactive pass that captures style preferences no amount of CSS scraping can surface.

### Task A.1 — preferences.json schema + pure parser

**Files:**
- Create: `scripts/preferences.mjs` (new pure-JS module, no Puppeteer dep)
- Test: `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs` (add cases)

**Step 1: Write failing tests for parser**

Add test cases in `run-fixture-tests.mjs`:

```javascript
import { parsePreferences, validatePreferences, DEFAULTS } from '../../../scripts/preferences.mjs';

// Test 1: empty input returns defaults
const empty = parsePreferences({});
check('empty returns defaults', empty.density === 'standard');

// Test 2: canonical enum values pass through
const canonical = parsePreferences({ density: 'minimalist', visualStyle: 'paper', contentWeight: 'text-heavy' });
check('canonical values preserved', canonical.density === 'minimalist' && canonical.visualStyle === 'paper');

// Test 3: "Custom: foo" escapes pass as free text under `customNotes`
const custom = parsePreferences({ density: 'Custom: tight-but-breathable' });
check('custom escape captured', custom.density === 'custom' && custom.customNotes.density === 'tight-but-breathable');

// Test 4: unknown enum falls back to default + warning
const invalid = parsePreferences({ density: 'explosive' });
check('unknown falls back', invalid.density === 'standard' && invalid.warnings.includes('density: unknown value "explosive"'));

// Test 5: validation rejects nonsense shapes
const err = validatePreferences({ density: 123 });
check('rejects non-string', err.length > 0);
```

**Step 2: Run tests — expect fail**

```bash
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
```
Expected: FAIL with "parsePreferences is not defined".

**Step 3: Implement parser**

```javascript
// scripts/preferences.mjs
export const DEFAULTS = {
  density: 'standard',
  visualStyle: 'match-scan',
  contentWeight: 'balanced',
  moodOverride: 'match-scan',
  logoPlacement: 'top-right',
};

const ENUMS = {
  density: ['minimalist', 'standard', 'dense'],
  visualStyle: ['gradient', 'paper', 'geometric', 'photo', 'mesh', 'match-scan'],
  contentWeight: ['text-heavy', 'balanced', 'icon-heavy'],
  moodOverride: ['playful', 'premium', 'clinical', 'scrappy', 'editorial', 'match-scan'],
  logoPlacement: ['top-right', 'top-left', 'bottom-right', 'none'],
};

export function parsePreferences(input) {
  const out = { ...DEFAULTS, customNotes: {}, warnings: [] };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    const raw = input[key];
    if (raw == null || raw === '') continue;
    if (typeof raw !== 'string') {
      out.warnings.push(`${key}: non-string input ignored`);
      continue;
    }
    // Custom escape: "Custom: <free text>"
    const customMatch = raw.match(/^\s*custom\s*:\s*(.+)$/i);
    if (customMatch) {
      out[key] = 'custom';
      out.customNotes[key] = customMatch[1].trim();
      continue;
    }
    const normalized = raw.toLowerCase().trim();
    if (ENUMS[key].includes(normalized)) {
      out[key] = normalized;
    } else {
      out.warnings.push(`${key}: unknown value "${raw}"`);
      // Leaves default in place
    }
  }
  return out;
}

export function validatePreferences(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('preferences must be an object');
    return errors;
  }
  for (const [key, val] of Object.entries(input)) {
    if (!(key in DEFAULTS) && key !== 'customNotes' && key !== 'warnings') {
      errors.push(`unknown key: ${key}`);
    }
    if (val != null && typeof val !== 'string' && typeof val !== 'object') {
      errors.push(`${key}: must be string or object`);
    }
  }
  return errors;
}
```

**Step 4: Run tests — expect pass**

Expected: PASS all 5 preference tests + existing 143+ suite.

**Step 5: Commit**

```bash
git add scripts/preferences.mjs test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7.1): preferences parser with enum validation + Custom: escape"
```

---

### Task A.2 — `/node-carousel:scan --ask` interactive prompt

**Files:**
- Modify: `commands/scan.md` (add `--ask` flag + interactive step)
- Modify: `scripts/scan-site.mjs` (pass-through `--ask` flag into scan.json for consumer signal)
- Test: no unit test — interactive UX is validated by smoke run

**Step 1: Update commands/scan.md**

Add to the usage block:
```
/node-carousel:scan https://yourbrand.com --ask
```

Add a section between Step 5 (voice-niche) and Step 7 (synthesis):

```markdown
### Step 6.5: Ask preferences (if `--ask` passed)

If the user passed `--ask`, run the interactive questionnaire BEFORE synthesis. This captures style preferences that scan/vision/voice can't infer from CSS.

Questions (ask one at a time, present as numbered list with "Custom" option):

1. **Density** — how much content per slide?
   - 1. Minimalist (big type, lots of space, 2-3 lines per slide)
   - 2. Standard (default)
   - 3. Dense (more content per slide, smaller type)
   - 4. Custom: type your own direction

2. **Visual style** — what's the background feel?
   - 1. Clean gradient (smooth color wash)
   - 2. Paper (warm noise texture, editorial)
   - 3. Geometric (shapes, grids, technical)
   - 4. Photo-heavy (hero imagery)
   - 5. Mesh (blurred color blobs)
   - 6. Match the scan (use what was auto-detected)
   - 7. Custom: type your own direction

3. **Content weight** — text or visual priority?
   - 1. Text-heavy (headlines do the work)
   - 2. Balanced
   - 3. Icon + number heavy (data viz, stats, icons)
   - 4. Custom

4. **Mood override** (optional, press enter to skip):
   - 1. Playful / 2. Premium / 3. Clinical / 4. Scrappy / 5. Editorial / 6. Match scan / 7. Custom

5. **Logo placement**:
   - 1. Top-right (default) / 2. Top-left / 3. Bottom-right / 4. None / 5. Custom

Collect answers. Write `./.brand-scan/preferences.json`:

```json
{
  "density": "minimalist",
  "visualStyle": "paper",
  "contentWeight": "text-heavy",
  "moodOverride": "editorial",
  "logoPlacement": "top-right",
  "customNotes": {
    "density": "actually I want a specific aesthetic like Lenny's Newsletter"
  }
}
```

If the user skips all questions or passes `--no-ask`, don't write preferences.json — synthesis proceeds without this sixth input.
```

Update "Edge cases" section:
- **No `--ask` flag**: skip the questionnaire entirely, synthesis uses 5 inputs (v0.7 behavior)
- **User presses enter on every question**: write preferences.json with all defaults — synthesizer treats this as "no strong preferences"
- **User picks "Custom" on a question**: record free-text under `customNotes[key]` and set the main value to `"custom"` — synthesizer uses the note as guidance

**Step 2: Extend scripts/scan-site.mjs CLI parser**

In `parseArgv()`, add `--ask` as a boolean flag (no value). Store as `askPreferences: true/false` on the parsed args. Write to scan.json as `askPreferences` at top level (useful for downstream tooling to know this run was interactive).

Wire into main so the flag is passed to scan.json output even though scan-site itself doesn't execute the prompt (that happens at command-runtime inside commands/scan.md).

Add 2 test cases:
- `parseArgv(['--ask', 'url', 'out'])` → `askPreferences: true`
- `parseArgv(['url', 'out'])` → `askPreferences: false`

**Step 3: Run tests**

```bash
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
```
Expected: pass 2 new tests + existing.

**Step 4: Smoke test the CLI flag**

```bash
node scripts/scan-site.mjs https://nodeagency.ai /tmp/v071-ask-test --ask
```

Verify `/tmp/v071-ask-test/scan.json` has `askPreferences: true`. (The questionnaire itself runs at command-runtime, not in this script — so this smoke only verifies pass-through.)

**Step 5: Commit**

```bash
git add commands/scan.md scripts/scan-site.mjs test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7.1): --ask flag for interactive preference questionnaire"
```

---

### Task A.3 — Synthesizer consumes preferences

**Files:**
- Modify: `prompts/brand-synthesis.md`

**Step 1: Add a new section "Phase 0.5 — Preferences override (v0.7.1)"**

Place after Phase 0 (mergeWith) and before the source-priority section. Rule:

- If `./.brand-scan/preferences.json` exists, it's a SIXTH input source
- Preferences express USER INTENT, which outranks scan-derived inference for the specific field they control
- BUT preferences sit BELOW mergeWith — if user has both an existing profile AND answered preferences, existing profile still wins for fields it specifies (e.g. if existing.visual.background.type = "noise-gradient" and preferences.visualStyle = "gradient", existing wins; preferences only fills fields the existing profile left empty)
- `customNotes` entries are guidance, not hard overrides — synthesizer uses them to inform preset and background choices but doesn't try to pattern-match free text

Document mapping from preferences → brand-profile fields:
- `density: minimalist` → `visual.background.noise.intensity` ≤ 0.08, larger type scale step
- `density: dense` → tighter line heights, smaller type scale
- `visualStyle: paper` → `visual.background.type: "noise-gradient"` with `noiseType: "grit"`, cream-ish bg
- `visualStyle: geometric` → `visual.background.type: "geometric-shapes"` or `"dot-grid"`
- `visualStyle: mesh` → `visual.background.type: "mesh"` with 3-4 blobs
- `visualStyle: gradient` → `visual.background.type: "gradient"` solid two-stop
- `visualStyle: photo` → no direct mapping yet; warn + fallback to `mesh`
- `contentWeight: text-heavy` → prefer patterns `quote-pulled`, `stat-dominant`, deprioritize `list-bullet`
- `contentWeight: icon-heavy` → enable `numberBadges` decoration, prefer `list-numbered`/`stat-dominant`
- `moodOverride: editorial` → favor `editorial-serif` preset (weight +3)
- `moodOverride: clinical` → favor `utilitarian-bold` preset (weight +3)
- `moodOverride: playful` → favor `satoshi-tech` preset + lime accent
- `logoPlacement: none` → omit `visual.logo` block entirely

**Step 2: Document custom-note handling**

Custom notes under `preferences.customNotes.<key>` are free-text. Example: `density.custom = "actually I want the Lenny's Newsletter density"`. Synthesizer should:
1. Read the note
2. Use it as context when picking preset/background/fonts
3. Emit in resolution notes: `"density applied from custom note: 'Lenny's Newsletter density' — mapped to minimalist density + editorial-serif preset"`

Do NOT try to regex-extract specific values — just treat the note as guidance.

**Step 3: Update source priority tier list**

Change priority tiers to 6 levels:
1. mergeWith (Phase 0 — existing profile)
2. preferences (Phase 0.5 — new)
3. BrandFetch (authoritative for logos + colors when available)
4. vision-analysis (visual hierarchy + mood)
5. voice-niche (tone)
6. references + scan

**Step 4: Commit**

```bash
git add prompts/brand-synthesis.md
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7.1): synthesizer consumes preferences.json as 6th input with customNotes guidance"
```

---

## Phase B: Custom fonts

Goal: users can self-host `.woff2`/`.woff`/`.ttf`/`.otf` fonts and have them embedded into rendered SVGs as base64 data URIs.

### Task B.1 — Font schema: accept object form

**Files:**
- Modify: `docs/brand-profile-schema.md`
- Modify: `prompts/brand-synthesis.md` (describe when to emit object form)

**Step 1: Document new schema**

Update `docs/brand-profile-schema.md` `visual.fonts` section:

```markdown
### visual.fonts.{display,body}

Two forms supported:

**String (legacy, Google Fonts):**
```json
"display": "Inter"
```
Renderer emits `@import url('https://fonts.googleapis.com/css2?family=Inter')`.

**Object (v0.7.1+, self-hosted):**
```json
"display": {
  "family": "Gilroy",
  "file": "./brand-fonts/Gilroy-Bold.woff2",
  "weight": 700,
  "style": "normal"
}
```
Renderer base64-embeds the font file as `@font-face` data URI inside the SVG. Makes output portable and self-contained.

Fields:
- `family` (required): CSS font-family name used in text elements
- `file` (required): relative or absolute path to font file; relative paths resolve from brand-profile.json location
- `weight` (optional, default 700 for display / 400 for body): CSS font-weight
- `style` (optional, default "normal"): CSS font-style, accepts "normal" or "italic"

Supported file formats: `.woff2` (recommended), `.woff`, `.ttf`, `.otf`. Other extensions rejected.

Max file size: 500 KB (warn at 250 KB). Larger files bloat every slide SVG.

Licensing: users are responsible for font license compliance. The plugin just embeds what you provide.
```

**Step 2: Update brand-synthesis.md**

Add to the fonts-picking section: when synthesizer detects scan.fonts.displaySource === "unknown" AND scan doesn't have a viable Google/Fontshare fallback, emit `visual.fonts.display` as object with `{family: scan-detected-name, file: null}` and a warning telling the user to drop the font file in `./brand-fonts/` and update the profile.

**Step 3: Commit**

```bash
git add docs/brand-profile-schema.md prompts/brand-synthesis.md
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "docs(v0.7.1): document font object form in brand-profile schema"
```

---

### Task B.2 — Font loader + base64 embedder

**Files:**
- Create: `scripts/load-font.mjs` (new module)
- Test: new fixtures + tests in `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`
- Fixture: `test/fixtures/custom-fonts/test-font.woff2` (need a tiny sample font for tests)

**Step 1: Write failing tests**

```javascript
import { loadFont, embedFontAsDataUri, inferFontFormat } from '../../../scripts/load-font.mjs';
import { writeFileSync, readFileSync } from 'node:fs';

// Test 1: infer format from extension
check('woff2 detected', inferFontFormat('/tmp/foo.woff2') === 'woff2');
check('ttf detected', inferFontFormat('/tmp/foo.ttf') === 'truetype');
check('otf detected', inferFontFormat('/tmp/foo.otf') === 'opentype');
check('woff detected', inferFontFormat('/tmp/foo.woff') === 'woff');
check('uppercase extension works', inferFontFormat('/tmp/FOO.WOFF2') === 'woff2');
check('unknown extension throws', (() => { try { inferFontFormat('/tmp/foo.pdf'); return false; } catch { return true; } })());

// Test 2: loadFont reads + validates size
const tinyBuffer = Buffer.from('fake-font-bytes');
const tmpPath = '/tmp/test-font-tiny.woff2';
writeFileSync(tmpPath, tinyBuffer);
const loaded = loadFont(tmpPath);
check('loaded returns buffer', Buffer.isBuffer(loaded.buffer));
check('format populated', loaded.format === 'woff2');
check('size under warn threshold', !loaded.warnings.some(w => w.includes('size')));

// Test 3: size warning at >250KB
const medBuffer = Buffer.alloc(260 * 1024, 0);
writeFileSync('/tmp/test-font-med.woff2', medBuffer);
const med = loadFont('/tmp/test-font-med.woff2');
check('size warning at 260KB', med.warnings.some(w => w.includes('large')));

// Test 4: size error at >500KB (rejected)
const bigBuffer = Buffer.alloc(600 * 1024, 0);
writeFileSync('/tmp/test-font-big.woff2', bigBuffer);
try {
  loadFont('/tmp/test-font-big.woff2');
  check('rejects >500KB', false);
} catch (err) {
  check('rejects >500KB', err.message.includes('500'));
}

// Test 5: embedFontAsDataUri produces valid @font-face CSS
const css = embedFontAsDataUri({ family: 'Test', file: tmpPath, weight: 700, style: 'normal' });
check('emits @font-face', css.includes('@font-face'));
check('emits font-family', css.includes("font-family: 'Test'"));
check('emits weight', css.includes('font-weight: 700'));
check('emits base64 data URI', css.includes('data:font/woff2;base64,'));
check('emits format hint', css.includes("format('woff2')"));
```

**Step 2: Run tests — expect fail**

**Step 3: Implement load-font.mjs**

```javascript
// scripts/load-font.mjs
import { readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const MAX_BYTES = 500 * 1024;
const WARN_BYTES = 250 * 1024;

const FORMAT_MAP = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
};

const MIME_MAP = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  opentype: 'font/otf',
};

export function inferFontFormat(path) {
  const ext = extname(path).toLowerCase();
  if (!FORMAT_MAP[ext]) {
    throw new Error(`Unsupported font format: ${ext}. Expected .woff2, .woff, .ttf, or .otf`);
  }
  return FORMAT_MAP[ext];
}

export function loadFont(path) {
  const abs = resolve(path);
  const format = inferFontFormat(abs);
  const stats = statSync(abs);
  const warnings = [];
  if (stats.size > MAX_BYTES) {
    throw new Error(`Font file ${path} is ${Math.round(stats.size / 1024)}KB, exceeds 500KB limit`);
  }
  if (stats.size > WARN_BYTES) {
    warnings.push(`font ${path} is large (${Math.round(stats.size / 1024)}KB) — bloats every SVG`);
  }
  const buffer = readFileSync(abs);
  return { buffer, format, mime: MIME_MAP[format], size: stats.size, path: abs, warnings };
}

export function embedFontAsDataUri({ family, file, weight = 400, style = 'normal' }) {
  const loaded = loadFont(file);
  const base64 = loaded.buffer.toString('base64');
  return [
    '@font-face {',
    `  font-family: '${family}';`,
    `  src: url('data:${loaded.mime};base64,${base64}') format('${loaded.format}');`,
    `  font-weight: ${weight};`,
    `  font-style: ${style};`,
    `  font-display: swap;`,
    '}',
  ].join('\n');
}
```

**Step 4: Create test fixture**

Create a tiny valid .woff2 fixture for tests. Download a minimal open-source font file (e.g. a single-glyph Space Mono subset from Google Fonts CDN) and save to `test/fixtures/custom-fonts/test-font.woff2`. Target size: < 5 KB.

Alternative: synthesize a fake-but-size-correct buffer at test-time. Since `loadFont` doesn't parse font internals, byte content doesn't matter for unit tests — only size + extension.

Update tests to use the pre-made fixture instead of `/tmp` paths for reproducibility.

**Step 5: Run tests — expect pass**

```bash
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
```

**Step 6: Commit**

```bash
git add scripts/load-font.mjs test/fixtures/scan-site-fixtures/run-fixture-tests.mjs test/fixtures/custom-fonts/
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7.1): font loader + base64 data-URI embedder with size validation"
```

---

### Task B.3 — Renderer emits @font-face when font is object form

**Files:**
- Modify: `scripts/render-v0.4.mjs`

**Step 1: Locate font import logic**

In `render-v0.4.mjs`, find where `@import` URLs are generated for Google Fonts (search for `fonts.googleapis`). Current behavior: reads `brand.visual.fonts.display` as a string family name, builds Google Fonts URL.

**Step 2: Branch on font value type**

Refactor that block:

```javascript
import { embedFontAsDataUri } from './load-font.mjs';

function buildFontDeclarations(brand, brandProfileDir) {
  const { display, body } = brand.visual.fonts;
  const googleFamilies = [];
  const embedded = [];

  for (const font of [display, body]) {
    if (typeof font === 'string') {
      // Legacy: Google Fonts name
      if (!googleFamilies.includes(font)) googleFamilies.push(font);
    } else if (font && typeof font === 'object' && font.file) {
      // v0.7.1: Self-hosted, base64 embed
      const resolvedPath = path.resolve(brandProfileDir, font.file);
      embedded.push(embedFontAsDataUri({ ...font, file: resolvedPath }));
    } else if (font && typeof font === 'object' && font.family && !font.file) {
      // Object form without file — treat family name as Google Fonts lookup
      if (!googleFamilies.includes(font.family)) googleFamilies.push(font.family);
    }
  }

  const parts = [];
  if (googleFamilies.length > 0) {
    const params = googleFamilies.map(f => `family=${encodeURIComponent(f)}:wght@400;500;600;700;800`).join('&');
    parts.push(`@import url('https://fonts.googleapis.com/css2?${params}&display=swap');`);
  }
  parts.push(...embedded);
  return parts.join('\n');
}
```

**Step 3: Update call site**

Wherever the old `@import` line was emitted into the SVG `<style>` block, replace with `buildFontDeclarations(brand, brandProfileDir)`. Compute `brandProfileDir` once at the top of render-v0.4.mjs as `path.dirname(resolve(brandProfilePath))`.

**Step 4: Update font-family references in SVG**

When emitting `font-family: '${font}'`, handle both string and object forms:

```javascript
function fontFamilyName(font) {
  if (typeof font === 'string') return font;
  if (font && typeof font === 'object' && font.family) return font.family;
  return 'sans-serif';
}
```

Replace all `font-family: '${brand.visual.fonts.display}'` with `font-family: '${fontFamilyName(brand.visual.fonts.display)}'`.

**Step 5: Test with TPS case**

Copy a Gilroy .woff2 (user would drop this — for now use any .woff2 fixture as a stand-in, or Niek provides one):

```bash
mkdir -p /tmp/brand-fonts-test
cp test/fixtures/custom-fonts/test-font.woff2 /tmp/brand-fonts-test/test.woff2
```

Edit `/Users/niekhuggers/tps-scan/brand-profile.json` to change:
```json
"fonts": {
  "display": { "family": "TestFont", "file": "/tmp/brand-fonts-test/test.woff2", "weight": 700 },
  "body": "Inter"
}
```

Re-render:
```bash
cd /Users/niekhuggers/tps-scan && rm -rf brand-preview && mkdir -p brand-preview && node /Users/niekhuggers/.claude/plugins/cache/node-carousel/node-carousel/0.7.0/scripts/render-v0.4.mjs ./brand-profile.json /Users/niekhuggers/.claude/plugins/cache/node-carousel/node-carousel/0.7.0/test/fixtures/brand-preview-strategy.json ./brand-preview/
```

Verify:
```bash
grep -c "@font-face" brand-preview/slide-01.svg   # Expect ≥ 1
grep -c "data:font/woff2" brand-preview/slide-01.svg  # Expect ≥ 1
grep -c "@import" brand-preview/slide-01.svg   # Expect ≥ 1 (for Inter body)
```

Open the preview — the display font should load from the embedded font (will render whatever glyphs the test .woff2 contains; a real Gilroy would show correctly).

**Step 6: Regression check — paper aesthetic**

```bash
cd "/Users/niekhuggers/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"
rm -rf /tmp/v071-paper-regress && node scripts/render-v0.4.mjs examples/2-minute-crm-audit/brand-profile.json examples/2-minute-crm-audit/strategy.json /tmp/v071-paper-regress && node scripts/preview.mjs /tmp/v071-paper-regress && open /tmp/v071-paper-regress/preview.html
```

Paper preset uses string-form fonts (Instrument Serif + Inter). Must render byte-identically to v0.7.0. Verify via `diff`:

```bash
diff -r /tmp/v071-paper-regress examples/2-minute-crm-audit/output-v070-reference/
```

(Will need to generate the v0.7.0 reference output first — capture before starting this task.)

**Step 7: Commit**

```bash
git add scripts/render-v0.4.mjs
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7.1): renderer emits @font-face base64 for self-hosted fonts"
```

---

### Task B.4 — Brand-fonts directory convention + docs

**Files:**
- Create: `docs/custom-fonts.md`
- Modify: `README.md` (link to custom-fonts guide)
- Modify: `commands/scan.md` (mention `./brand-fonts/` convention in edge-cases)

**Step 1: Write docs/custom-fonts.md**

Topics:
- Why: some fonts (Gilroy, proprietary, internal) aren't on Google Fonts / Fontshare
- Where to drop files: `./brand-fonts/<Family>-<Weight>.woff2` in your working dir
- How to declare in brand-profile.json: object form with relative path
- Format support + size cap
- Licensing disclaimer
- Two workflows:
  1. Manual: edit brand-profile.json to point at the file
  2. Scan-flagged: scan detected an unknown font → synthesizer emits object form with `file: null` and a warning → user drops the file + updates the profile

**Step 2: Update README.md**

Add one-line callout near the Quick Start:
```
Using a licensed or self-hosted font? See `docs/custom-fonts.md` for how to drop it into your brand profile.
```

**Step 3: Update commands/scan.md edge cases**

Add edge case:
```
- **Scan detected "unknown" font source**: The font isn't on Google Fonts or Fontshare. Synthesizer will emit `visual.fonts.display` as object form with `file: null` and a warning. Drop the font file in `./brand-fonts/` and fill in the path. See `docs/custom-fonts.md`.
```

**Step 4: Commit**

```bash
git add docs/custom-fonts.md README.md commands/scan.md
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "docs(v0.7.1): custom-fonts.md — how to self-host licensed brand fonts"
```

---

## Phase C: End-to-end integration + ship

### Task C.1 — Full pipeline smoke test

**Files:** none (runs commands)

**Step 1: Run `/node-carousel:scan <url> --ask` on a test URL**

Hard to automate the interactive prompt from bash. Instead: manually type through the questionnaire for TPS:

```
/node-carousel:scan https://theproducerschool.com --ask
```

Pick varied answers — e.g. "Custom: notebook paper aesthetic like a music production journal" for visualStyle. Verify:
- preferences.json is written to `.brand-scan/preferences.json`
- customNotes has the free-text entry
- Synthesizer produces a brand-profile.json influenced by the custom note (mentions "notebook" or similar in resolution notes)
- Render succeeds

**Step 2: Manual font test end-to-end**

Niek provides a .woff2 (e.g. the real Gilroy if he has a license copy locally). Edit the TPS brand-profile.json to point at it. Re-render. Verify the font actually shows up in the preview.

If Niek doesn't have a Gilroy file handy for this test, use any open-source woff2 (Manrope from Google Fonts → download → embed via the path). The point is to verify the mechanism, not the specific font.

**Step 3: Regression battery**

```bash
cd "/Users/niekhuggers/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs   # All fixture tests
rm -rf /tmp/v071-regress && node scripts/scan-site.mjs https://nodeagency.ai /tmp/v071-regress   # Vanilla v0.7 scan still works
rm -rf /tmp/v071-regress2 && node scripts/scan-site.mjs https://nodeagency.ai /tmp/v071-regress2 --merge-with examples/5-signs-overengineered/brand-profile.json   # merge-with still works
```

All three must produce valid scan.json with no regressions.

### Task C.2 — Version bump + README

- `.claude-plugin/plugin.json` → `"version": "0.7.1"`
- `scripts/package.json` → `"version": "0.7.1"`
- `package.json` (root, added in v0.7 hotfix) → `"version": "0.7.1"`
- README: add "What's new in v0.7.1" callout — bullet for interactive preferences + custom fonts + link to new doc

### Task C.3 — Tag + push

```bash
git tag -a v0.7.1 -m "v0.7.1 — Interactive preferences + custom fonts

- /node-carousel:scan --ask: 5-question interactive preference pass with Custom: free-text escape on every question
- Self-hosted fonts: visual.fonts accepts {family, file, weight} for licensed brand fonts
- Renderer: base64-embeds .woff2/.woff/.ttf/.otf as @font-face data URIs (self-contained SVGs)
- docs/custom-fonts.md: how to drop licensed fonts into brand-profile.json

Deferred to v0.8+: icon file upload, font auto-discovery from brand-fonts/, font variation axes"

git push origin main
git push origin v0.7.1
gh release create v0.7.1 --title "v0.7.1 — Interactive preferences + custom fonts" --notes "..."
```

DO NOT push automatically — user approves after regression battery passes.

---

## Success criteria

- [ ] `/node-carousel:scan <url> --ask` presents 5 questions with Custom: escape; preferences.json written correctly
- [ ] `/node-carousel:scan <url>` (no --ask) behaves byte-identically to v0.7.0 — zero regression on the zero-question happy path
- [ ] preferences.json parsed by `parsePreferences` with correct enum validation + customNotes capture
- [ ] Synthesizer incorporates preferences (verify via resolution notes mentioning them)
- [ ] Font object form `{family, file, weight}` emits @font-face + base64 data URI in rendered SVG
- [ ] Font string form still works unchanged (Google Fonts @import path intact)
- [ ] Paper-aesthetic regression render (`editorial-serif` preset) looks byte-identical to v0.7.0
- [ ] Font file >500KB rejected with clear error
- [ ] Font file 250-500KB renders with size warning
- [ ] Unsupported extension (.pdf, .png) rejected
- [ ] docs/custom-fonts.md published + linked from README
- [ ] 143+X tests pass (X = new test count, expected +15 or so)

## Scope boundary — what's v0.7.1 vs v0.8+

**In v0.7.1 (this plan):**
- `--ask` flag + 5-question interactive preference pass with Custom: escape
- preferences.json schema + parser
- Synthesizer Phase 0.5 integration
- Font object form `{family, file, weight, style}`
- `scripts/load-font.mjs` + base64 embedder
- Renderer `@font-face` path
- `docs/custom-fonts.md`
- Version bump to 0.7.1

**Deferred to v0.8+:**
- Auto-discover `brand-fonts/*.woff2` (vs explicit path declaration)
- Font variation axis support (multi-weight single file)
- OpenType feature controls (`ss01`, `salt`, etc.)
- Icon file upload beyond what v0.4 already supports
- Image/logo uploads beyond scan-extracted
- Pre-flight license check (font metadata parsing to warn on embargo bits)
- Font subsetting to reduce embed size
- `--preferences <path>` flag to re-use a saved preferences.json across scans

## Parallelism opportunities

- A.1 (preferences parser) + B.2 (font loader) are independent pure-JS modules — parallel-safe
- A.3 (synthesizer doc) + B.1 (schema doc) are prompt/doc edits — parallel-safe with A.1/B.2
- A.2 (scan.md CLI plumbing) + B.3 (renderer) touch scripts/scan-site.mjs and scripts/render-v0.4.mjs respectively — independent, parallel-safe
- B.4 (docs) can happen anytime after B.1/B.2/B.3 settle

Build order:
1. **Wave 1 parallel:** A.1 (preferences parser) + B.2 (font loader)
2. **Wave 2 parallel:** A.2 (scan CLI) + B.3 (renderer) + A.3 (synthesizer doc) + B.1 (schema doc)
3. **Wave 3:** B.4 (docs) + C.1 (smoke) + C.2 (bump) + C.3 (ship)

Estimated total: 4-5 hours agent time. Wall-clock with 4-parallel wave ≈ 2 hours.

## Process rules (non-negotiable)

1. **Preserve v0.7.0 behavior** — any user not passing `--ask` or not using object-form fonts must get byte-identical output vs v0.7.0
2. **Paper-aesthetic regression render at end of Phase B** — editorial-serif must still look right
3. **Zero new npm deps** — stdlib only
4. **Font licensing disclaimer in docs** — remind users the plugin just embeds what they provide; they own the license compliance
5. **Custom: escape on every question** — never force a user into a canonical enum; free-text is always acceptable
