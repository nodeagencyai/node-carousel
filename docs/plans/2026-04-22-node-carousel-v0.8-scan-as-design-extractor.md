# Node Carousel v0.8 — Scan as Design Extractor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Shift scan from "pick one of 6 presets based on enum tags" to "extract the brand's actual design system (pixel-sampled colors, glow/effect parameters, layout proportions) and render the carousel with those extracted values" — so a carousel scanned from theproducerschool.com actually FEELS like TPS instead of a generic editorial-serif preset with a TPS blue accent slapped on top.

**Architecture:**
1. **Pixel-level color extraction** — sample hero.png at a 9-point grid + dominant-hue clustering via Puppeteer's native canvas API (no new npm deps)
2. **Structured vision fingerprint** — upgrade screenshot-analysis prompt from 6 abstract enums to precise measurements: color stops with positions, glow/blur effect parameters, composition coordinates
3. **Scan-derived background recipe** — new `visual.background.type: "scanned"` lets synthesizer emit custom gradient + filter configs directly from extracted signals instead of mapping to a preset
4. **Scan-first synthesis** — when scan confidence is high, scanned-recipe wins; preset becomes fallback for low-confidence scans
5. **Preset stays as opt-in** — users who want editorial-serif Lenny's vibe still pass `--preset editorial-serif`, which short-circuits the scan-first path

**Tech stack:** Existing (Puppeteer + Node stdlib + Claude runtime multimodal Read tool). Pixel sampling happens inside `page.evaluate` using `<canvas>.getContext('2d').getImageData()` — zero new dependencies. Filter composition in renderer uses existing SVG filter primitives (`feGaussianBlur`, `feTurbulence`, `feColorMatrix`).

**Constraints (non-negotiable):**
- DO NOT break v0.7.1 — existing brand-profiles with string-form fonts + preset-type backgrounds must render byte-identical
- DO NOT add npm deps — pixel sampling via Puppeteer's canvas, no `sharp`/`canvas`/`jimp`
- Preset-first path remains available via `--preset <name>` flag
- Scan-first path activates only when scan confidence ≥ 0.75 AND no forced preset
- Paper-aesthetic regression (`editorial-serif` preset) must render byte-identical
- `--merge-with` still wins Phase 0 — user's existing profile always outranks scan-derived recipe
- `--ask` preferences still sit at Phase 0.5 — above scan-derived but below mergeWith

**Research inputs:**
- TPS v0.7.1 verification today: user saw the paper-editorial output and said "it has not much to do with the brand" — preset-first fundamentally can't preserve brand aesthetic when the detected brand is cosmic-tech and the output is cream-paper-with-blue-accent
- v0.7.1's preferences layer revealed the limit: even with preferences, users can only pick from 6 canonical aesthetics — can't say "TPS's cosmic dark-with-blue-glow is the aesthetic, just more minimalist for carousels"
- Node Carousel memory: Niek's validated paper-aesthetic render is the `editorial-serif` preset with `noise-gradient grit on cream` — that stays available via `--preset editorial-serif`, but is no longer the default fallback

---

## Phase A: Pixel-level color extraction

Goal: replace CSS-frequency color ranking with actual pixel sampling from the hero screenshot. The dominant accent + glow + background from the rendered site, not from CSS declarations.

### Task A.1 — Grid sampling inside page.evaluate

**Files:**
- Modify: `scripts/scan-site.mjs` (extend the page.evaluate block that captures computed styles)
- Test: new test section in `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`

**Step 1: Add `samplePixelColors(page)` helper that runs inside the browser context**

Grid-sample hero viewport at 9 points (3×3 grid: 25%/50%/75% × 25%/50%/75%) + 5 bonus points (corners + dead center). Sample the computed canvas pixel values from a `<canvas>` element that captures the visible viewport. Return as an array of `{x, y, rgb}` objects.

Approach: use Puppeteer's `page.screenshot({clip: {...}, encoding: 'base64'})` to capture a tiny 1×1 region at each grid point, decode the base64 PNG in Node, extract the RGB. This avoids needing `<canvas>` injection into the page.

ACTUALLY simpler: use `page.evaluate` with `html2canvas`-style pattern is heavy. Cleanest approach: `page.screenshot()` produces a PNG buffer → parse via `fs.readFileSync` + manual PNG IDAT decode? That requires a deflate library (pako, zlib). But Node has built-in `zlib` — we can decode PNG ourselves.

**Actual cleanest path** (no new deps): take 1×1 region screenshots via `page.screenshot({clip: {x, y, width: 1, height: 1}, encoding: 'base64'})` for each grid point. PNG with 1 pixel has a tiny fixed structure — the IDAT chunk contains the raw RGB after zlib inflation. Use Node's built-in `zlib.inflateSync` to extract.

Implementation sketch:

```javascript
import zlib from 'node:zlib';

function parsePngPixel(base64) {
  // A 1×1 PNG has: 8-byte signature, IHDR, IDAT (deflated), IEND
  // Find IDAT, inflate, read RGB/RGBA from first pixel
  const buf = Buffer.from(base64, 'base64');
  let offset = 8; // skip signature
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      const data = buf.slice(offset + 8, offset + 8 + length);
      const inflated = zlib.inflateSync(data);
      // Row 0: first byte is filter type, then RGB(A) bytes
      const pixelStart = 1;
      return {
        r: inflated[pixelStart],
        g: inflated[pixelStart + 1],
        b: inflated[pixelStart + 2],
      };
    }
    offset += 8 + length + 4; // length + type + data + CRC
  }
  return null;
}

async function samplePixelAt(page, x, y) {
  const base64 = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, encoding: 'base64' });
  return parsePngPixel(base64);
}
```

Write failing test FIRST:

```javascript
// run-fixture-tests.mjs addition
check('parsePngPixel extracts RGB from known PNG', () => {
  // Use pre-generated 1×1 red PNG (base64 hardcoded)
  const redPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pixel = parsePngPixel(redPng);
  return pixel.r === 255 && pixel.g === 0 && pixel.b === 0;
});

check('parsePngPixel handles blue', () => {
  const bluePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNkYPhfDwACEgF8m/GPdAAAAABJRU5ErkJggg==';
  const pixel = parsePngPixel(bluePng);
  return pixel.r === 0 && pixel.g === 0 && pixel.b === 255;
});
```

(Generate the base64 fixtures by creating tiny PNGs via Node `zlib.deflateSync` + manual PNG header construction, OR use online PNG-to-base64 tool, OR use `fs.readFileSync(path).toString('base64')` on a real 1×1 PNG.)

**Step 2: Run tests — expect fail**

```bash
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
```
Expected: FAIL with "parsePngPixel is not defined".

**Step 3: Create `scripts/sample-pixels.mjs`** with `parsePngPixel` + `samplePixelsFromHero(page, gridPoints)`.

**Step 4: Wire into scan flow**

In `scan-site.mjs`'s `scanPage()`, after hero.png is captured, call `samplePixelsFromHero(page, [...grid])`. Write result to scan.json as `colors.sampled`:

```json
{
  "colors": {
    "sampled": {
      "points": [
        {"x": 480, "y": 270, "rgb": [10, 10, 12], "hex": "#0A0A0C"},
        ...
      ],
      "dominant": [
        {"hex": "#070708", "count": 7, "role": "background"},
        {"hex": "#2767F6", "count": 2, "role": "accent"},
        {"hex": "#4A90E8", "count": 1, "role": "glow"}
      ]
    }
  }
}
```

**Step 5: Dominant clustering**

14 sampled points → cluster via ΔE (reuse existing `clusterColors` from extract-brand-signals.mjs, threshold 25 — wider than CSS clustering because pixel samples have more variance). Rank clusters by count. Assign roles:
- Largest cluster = background
- Most saturated cluster with count ≥ 2 = accent
- Second most saturated with highest luminance = glow (if present)

**Step 6: Tests — expect pass**

Add fixture test with a hand-constructed scan.json that has `colors.sampled` — verify clustering produces expected dominant list.

**Step 7: Commit**

```bash
git add scripts/sample-pixels.mjs scripts/scan-site.mjs test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.8): pixel-level color sampling from hero screenshot (9-point grid + dominant clustering)"
```

---

### Task A.2 — Glow / highlight detection

**Files:**
- Modify: `scripts/sample-pixels.mjs`
- Test: `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`

Detect whether the hero has an "accent glow" — a bright saturated region distinct from the background. If yes, record the glow color + rough position. This enables the renderer to reproduce the glow effect.

**Step 1: Glow detection heuristic**

A point is part of a glow if:
- Its luminance is ≥ 0.4
- Its saturation is ≥ 0.6
- It's within 100px of the hero centerline or a detected focal area

Aggregate glow-eligible points → cluster → report `glow.color` + `glow.position` (`center` | `top-left` | `top-right` | `bottom-left` | `bottom-right` | `flanking`).

**Step 2: Augment scan.json**

```json
{
  "colors": {
    "sampled": {
      ...,
      "glow": {
        "detected": true,
        "color": "#4A90E8",
        "position": "flanking",
        "confidence": 0.72
      }
    }
  }
}
```

**Step 3: Test**

Add 3 fixture tests with hand-built sample data:
- Dark site with bright blue glow at flanking positions → `glow.detected: true, position: "flanking"`
- Clean white site → `glow.detected: false`
- Subtle gradient with mild highlight → `glow.detected: false` (confidence too low)

**Step 4: Commit**

```bash
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.8): glow / highlight detection from sampled pixels"
```

---

## Phase B: Structured vision fingerprint

Goal: replace the 6-enum vision classification with a structured fingerprint that captures precise measurements — color stops with positions, composition coordinates, effect parameters.

### Task B.1 — Vision fingerprint prompt

**Files:**
- Create: `prompts/vision-fingerprint.md` (new, alongside existing `prompts/screenshot-analysis.md`)
- Modify: `commands/scan.md` (call fingerprint prompt in addition to screenshot-analysis)

The existing `screenshot-analysis.md` gives us 6 enum tags (hierarchy/whitespace/composition/imagery/density/mood). That's useful for mood routing but insufficient for "make the carousel feel like this site."

Write a new prompt that asks Claude to output STRUCTURED measurements:

**Step 1: Write prompts/vision-fingerprint.md**

Prompt structure:

```markdown
# Vision Fingerprint Prompt

You are looking at a screenshot of a website's hero. Produce a STRUCTURED FINGERPRINT of the visual design — specific enough that another designer could reproduce the feel without seeing the original.

## Inputs

1. Read `<scan-output-dir>/hero.png` via multimodal Read tool
2. Read `<scan-output-dir>/scan.json` for context (specifically `colors.sampled.dominant` + `colors.sampled.glow`)

## What to extract

### 1. Background composition

Identify the dominant background pattern:
- **Flat color** — uniform fill
- **Linear gradient** — from color A to color B at angle θ
- **Radial gradient** — centered at (x%, y%) from inner color to outer color
- **Mesh / blobs** — multiple soft color regions, report 2-4 blob positions + colors
- **Textured** — noise, grain, or pattern overlay — report texture type + intensity
- **Photographic** — hero image or 3D render dominates the bg
- **Cosmic / particle** — starfield, vortex, or scattered-point effect

For gradients: estimate color stops with positions (`"#070708 at 0%"`, `"#1F3C6B at 100%"`).

### 2. Focal element positioning

Where are visual anchors?
- Headline centerline: (x%, y%)
- Primary CTA position: (x%, y%) + size (small/medium/large)
- Decorative elements (3D renders, illustrations, icons): list with (x%, y%) + approximate width%

### 3. Effect parameters

- Glow / bloom: present? color? radius (px)? position?
- Blur layers: present? which elements?
- Grain / noise: present? intensity (subtle/moderate/heavy)? texture feel (film / digital / paper / ink)?

### 4. Color atmosphere

Beyond the sampled pixels, describe the OVERALL atmosphere:
- Temperature: warm / neutral / cool / icy
- Contrast: high / medium / low
- Vibrancy: muted / balanced / saturated / electric

## Output

Write to `<scan-output-dir>/vision-fingerprint.json`:

```json
{
  "background": {
    "type": "cosmic-dark",
    "base": "#070708",
    "gradient": {
      "from": "#070708",
      "to": "#1F3C6B",
      "angle": 0,
      "stops": [[0, "#070708"], [100, "#1F3C6B"]]
    },
    "overlays": [
      { "type": "starfield", "density": "low", "opacity": 0.15 },
      { "type": "vortex", "position": "top-center", "color": "#2767F6", "opacity": 0.25, "blur": 120 }
    ]
  },
  "focalElements": [
    { "role": "headline", "x": 50, "y": 45, "size": "large" },
    { "role": "cta", "x": 50, "y": 75, "size": "medium" },
    { "role": "decorative-3d", "x": 15, "y": 50, "widthPct": 20, "description": "glassy blue keyboard" },
    { "role": "decorative-3d", "x": 85, "y": 50, "widthPct": 20, "description": "glassy blue groovebox" }
  ],
  "effects": {
    "glow": { "present": true, "color": "#4A90E8", "radius": 80, "position": "flanking" },
    "grain": { "present": false },
    "blur": { "present": true, "elements": "flanking-3d-renders" }
  },
  "atmosphere": {
    "temperature": "cool",
    "contrast": "high",
    "vibrancy": "electric"
  },
  "observations": "Dark cosmic-tech hero with flanking 3D music hardware in glassy electric blue. Centered headline anchors the composition with a glowing pill CTA below. Minimal grain, heavy bloom on 3D elements."
}
```

Don't invent details. For any uncertain field, emit `null` or `"uncertain"` + a note in observations.
```

**Step 2: Wire into commands/scan.md**

After the existing Step 4 (screenshot-analysis.md), add Step 4a:

> **Step 4a: Vision fingerprint (always)**
> Follow `${PLUGIN_ROOT}/prompts/vision-fingerprint.md` precisely. Writes `./.brand-scan/vision-fingerprint.json`. This is a SEPARATE output from vision-analysis.json — the fingerprint is structured measurements, the analysis is abstract enums. Both feed the synthesizer.

**Step 3: Commit**

```bash
git add prompts/vision-fingerprint.md commands/scan.md
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.8): structured vision fingerprint prompt — precise measurements beyond enum tags"
```

---

## Phase C: Scan-derived background recipe

Goal: introduce a new `visual.background.type: "scanned"` that the synthesizer emits when scan + vision produce a coherent recipe. The renderer reads the scanned config and composes SVG filters directly.

### Task C.1 — Schema: new "scanned" background type

**Files:**
- Modify: `docs/brand-profile-schema.md`

**Step 1: Document the new type**

```markdown
#### `background.scanned` (used when `type === "scanned"`) — v0.8+

Data-driven background recipe composed from scan signals. Renderer emits SVG filters + gradient primitives directly — no preset lookup. Use this when scan confidence is high AND you want the carousel to match the scanned brand's actual aesthetic vs picking a canonical preset.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `scanned.baseColor` | hex | yes | — | Dominant background color (from pixel sampling). |
| `scanned.gradient` | object or null | no | null | If set, `{from, to, angle, stops}` — pixel-extracted gradient. |
| `scanned.overlays` | array | no | `[]` | Ordered list of overlay layers (starfield, vortex, blob, grain). Each has `type` + type-specific params. |
| `scanned.glow` | object or null | no | null | Bloom effect: `{color, radius, position, opacity}`. |
| `scanned.atmosphere` | object | no | preset-derived | `{temperature, contrast, vibrancy}` — used by renderer to tune overall filter parameters. |

Overlay types supported in v0.8:
- `starfield` — scattered bright points, `{density: "low"|"medium"|"high", opacity, color}`
- `vortex` — blurred circular gradient, `{position, color, radius, opacity}`
- `blob` — soft radial, `{cx, cy, r, color, opacity, blur}`
- `grain` — noise texture, `{type: "film"|"digital"|"paper"|"ink", intensity}`

When `type: "scanned"` renders fall back to preset-type handling if any required field is missing.
```

**Step 2: Commit**

```bash
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "docs(v0.8): document visual.background.type=scanned schema"
```

---

### Task C.2 — Renderer: scanned-background SVG filter composition

**Files:**
- Modify: `scripts/render-v0.4.mjs`
- Modify: `scripts/shared-render.mjs` (if backgrounds live there — check)
- Possibly create: `scripts/render-scanned-bg.mjs` for the new code path

**Step 1: Read current background rendering**

Find how existing background types (mesh, gradient, noise-gradient, etc.) emit their SVG. The pattern is probably a switch/dispatch in `shared-render.mjs` or `render-v0.4.mjs`.

**Step 2: Add `scanned` handler**

Compose SVG filters from the scanned recipe. Each overlay type maps to a set of SVG primitives:

```javascript
function buildScannedBackground(bg) {
  const layers = [];

  // Base fill
  layers.push(`<rect width="100%" height="100%" fill="${bg.baseColor}"/>`);

  // Gradient (if present)
  if (bg.gradient) {
    const { from, to, angle } = bg.gradient;
    const rad = (angle * Math.PI) / 180;
    const x1 = 50 - 50 * Math.sin(rad);
    const y1 = 50 + 50 * Math.cos(rad);
    const x2 = 50 + 50 * Math.sin(rad);
    const y2 = 50 - 50 * Math.cos(rad);
    layers.push(`
      <defs>
        <linearGradient id="scannedGrad" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
          <stop offset="0%" stop-color="${from}"/>
          <stop offset="100%" stop-color="${to}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#scannedGrad)"/>
    `);
  }

  // Overlays
  for (const overlay of (bg.overlays || [])) {
    if (overlay.type === 'vortex') {
      layers.push(buildVortexLayer(overlay));
    } else if (overlay.type === 'starfield') {
      layers.push(buildStarfieldLayer(overlay));
    } else if (overlay.type === 'blob') {
      layers.push(buildBlobLayer(overlay));
    } else if (overlay.type === 'grain') {
      layers.push(buildGrainLayer(overlay));
    }
  }

  // Glow (if present)
  if (bg.glow && bg.glow.present) {
    layers.push(buildGlowLayer(bg.glow));
  }

  return layers.join('\n');
}
```

Implement each `build*Layer` helper. Reuse existing filter functions from `shared-render.mjs` where possible (e.g. `feTurbulence` for grain already exists for `noise-gradient` type).

**Step 3: Vortex layer example**

```javascript
function buildVortexLayer({ position, color, radius = 120, opacity = 0.25 }) {
  const positions = {
    'top-center': { cx: '50%', cy: '0%' },
    'center': { cx: '50%', cy: '50%' },
    'top-left': { cx: '20%', cy: '10%' },
    'flanking': { cx: '15%', cy: '50%' }, // first of a pair; second added separately if position === 'flanking'
  };
  const { cx, cy } = positions[position] || positions.center;
  return `
    <defs>
      <radialGradient id="vortex-${cx}-${cy}" cx="${cx}" cy="${cy}" r="60%">
        <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#vortex-${cx}-${cy})" filter="blur(${radius / 4}px)"/>
  `;
}
```

**Step 4: Starfield layer**

```javascript
function buildStarfieldLayer({ density = 'low', opacity = 0.3, color = '#FFFFFF' }) {
  const counts = { low: 30, medium: 80, high: 180 };
  const count = counts[density];
  const stars = [];
  // Seeded RNG from the existing tokens/seeded-random.js so stars are deterministic
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(Math.random() * 1080);
    const cy = Math.floor(Math.random() * 1350);
    const r = Math.random() * 1.5 + 0.5;
    stars.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${opacity}"/>`);
  }
  return stars.join('');
}
```

Use the seeded-random util already in the codebase so starfields are deterministic per brand+topic.

**Step 5: Fallback**

If `bg.baseColor` missing OR `overlays` is an array with unknown types, emit a warning comment in the SVG + fall back to solid background using whatever color is available.

**Step 6: Tests**

Unit-test each `build*Layer` helper with hand-built recipe input. Verify SVG output contains expected elements (`<linearGradient>` for gradient, `<circle>` for starfield, etc.).

**Step 7: Regression check**

Render the paper-aesthetic example to confirm it still works (it uses `noise-gradient` type, not `scanned` — should be unaffected):
```bash
rm -rf /tmp/v08-paper-regress && node scripts/render-v0.4.mjs examples/2-minute-crm-audit/brand-profile.json examples/2-minute-crm-audit/strategy.json /tmp/v08-paper-regress
diff -r /tmp/v08-paper-regress /tmp/v070-paper-reference
# Expected: empty
```

**Step 8: Commit**

```bash
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.8): renderer supports type=scanned with dynamic SVG filter composition"
```

---

## Phase D: Scan-first synthesis

Goal: synthesizer prefers scanned-recipe over preset-match when scan confidence is high. Preset becomes fallback.

### Task D.1 — Update brand-synthesis.md

**Files:**
- Modify: `prompts/brand-synthesis.md`

**Step 1: Add "Scan-first synthesis" decision tree**

After Phase 0 + Phase 0.5 (existing), insert a new Phase 0.75:

```markdown
## Phase 0.75 — Scan-first synthesis (v0.8)

When the scan produced a high-confidence, coherent visual fingerprint, the synthesizer emits a `visual.background.type: "scanned"` recipe built from scan + vision signals directly — NO preset mapping for the background layer.

### When does scan-first fire?

ALL of:
1. `scan.colors.sampled.dominant.length >= 3` (pixel sampling produced a real palette, not a single flat color)
2. `vision-fingerprint.json` exists AND its confidence fields are ≥ 0.7
3. No `--preset` forced
4. `preferences.visualStyle` is NOT one of `gradient | paper | geometric | mesh` (those are explicit preset choices — user wants the canonical recipe)

If ALL match → emit `visual.background.type: "scanned"` with a `scanned` object built from:
- `scanned.baseColor` ← `scan.colors.sampled.dominant[0].hex`
- `scanned.gradient` ← `vision-fingerprint.background.gradient` (if type is gradient-like)
- `scanned.overlays` ← `vision-fingerprint.background.overlays`
- `scanned.glow` ← `scan.colors.sampled.glow` OR `vision-fingerprint.effects.glow`
- `scanned.atmosphere` ← `vision-fingerprint.atmosphere`

### When does preset-fallback fire?

If ANY of:
- Scan confidence too low
- Vision fingerprint unavailable or uncertain
- User passed `--preset`
- User preferences specify a canonical style

Fall back to existing preset-match flow (Step 1 onward).

### Document in resolution notes

```json
"resolution": {
  "background": {
    "from": "scan-first",  // or "preset"
    "reason": "sampled 4 dominant colors + glow detected; vision fingerprint high-confidence",
    "scannedRecipe": { ... }
  }
}
```
```

**Step 2: Update the source-priority tier list**

Elevate scan + vision when confidence is high:

1. **mergeWith** (Phase 0 — existing profile always wins per-leaf-key)
2. **preferences** (Phase 0.5 — user intent)
3. **scanned recipe** (Phase 0.75 — when confidence thresholds met)
4. **BrandFetch** (authoritative for logos + colors when available AND scan-first didn't fire)
5. **vision-analysis** (abstract mood tags — informs preset-fallback)
6. **voice-niche** (tone routing)
7. **scan CSS-derived** (fallback for non-background fields even when scan-first fires)

**Step 3: Preserve preset fonts/tone/decorations even when scan-first fires**

Scan-first only governs the BACKGROUND layer. Preset still contributes:
- `visual.fonts` (unless scan detected a recognizable family)
- `visual.decorations` defaults
- `visual.numbering` style

Document this. The preset is a "scaffolding" for the parts scan can't confidently produce; scan-first takes over where scan has strong signal.

**Step 4: Commit**

```bash
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.8): synthesizer Phase 0.75 — scan-first background when confidence high"
```

---

## Phase E: Regression + ship v0.8.0

### Task E.1 — End-to-end smoke on TPS

Run the full v0.8 pipeline on theproducerschool.com WITHOUT `--ask`:

```bash
cd /Users/niekhuggers/tps-scan
rm -rf .brand-scan brand-profile.json brand-preview
# (Assuming user already has the updated plugin cache)
```

Re-run scan via `/node-carousel:scan https://theproducerschool.com/`.

Verify:
- `colors.sampled.dominant` has ≥ 3 entries
- `colors.sampled.glow.detected` reflects the actual site (TPS has flanking blue glow → should detect)
- `vision-fingerprint.json` exists with structured measurements
- Final `brand-profile.json` has `visual.background.type: "scanned"` (scan-first fired)
- Render uses cosmic-dark + flanking glow + TPS blue — feels like TPS, not editorial paper
- Confidence documented in resolution notes

### Task E.2 — Regression battery

```bash
cd "/Users/niekhuggers/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"

# Fixture tests
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
# Expect: 200+/200+ (v0.7.1 was 189, +~15 for pixel sampling + fingerprint tests)

# Paper regression — MUST stay byte-identical
rm -rf /tmp/v08-paper && node scripts/render-v0.4.mjs examples/2-minute-crm-audit/brand-profile.json examples/2-minute-crm-audit/strategy.json /tmp/v08-paper
diff -r /tmp/v08-paper /tmp/v070-paper-reference
# Expected: empty

# v0.7 --merge-with still works
rm -rf /tmp/v08-merge && node scripts/scan-site.mjs https://nodeagency.ai /tmp/v08-merge --merge-with examples/5-signs-overengineered/brand-profile.json
# Expected: mergeWith.content fields present

# v0.7 --preset still forces preset-match path
rm -rf /tmp/v08-preset && node scripts/scan-site.mjs https://theproducerschool.com /tmp/v08-preset --preset editorial-serif
# Expected: forcedPreset: "editorial-serif" in scan.json, scan-first did NOT fire
```

### Task E.3 — Version bump

- `.claude-plugin/plugin.json` → `"version": "0.8.0"`
- `scripts/package.json` → `"version": "0.8.0"`
- `package.json` (root) → `"version": "0.8.0"`

### Task E.4 — README v0.8 callout

Write a section explaining the architectural shift:

```
## v0.8 — Scan as design extractor

Prior versions mapped your scanned site to one of 6 canonical presets. v0.8 extracts the actual design system — pixel-sampled colors, glow/effect parameters, composition measurements — and renders those directly. The preset becomes a fallback for low-confidence scans, not the default.

Effect: carousels scanned from theproducerschool.com now render with actual cosmic-dark + flanking blue glow (not cream paper editorial). Carousels scanned from vercel.com render with Vercel's actual dark-mono look (not generic neo-grotesk).

To force preset-first behavior (editorial-serif paper aesthetic etc.), pass `--preset <name>` at scan time.
```

### Task E.5 — Tag + push

```bash
git tag -a v0.8.0 -m "v0.8.0 — Scan as design extractor

Shift from preset-first to scan-first synthesis. Carousels now inherit actual design-system features from scanned brands rather than mapping to 1 of 6 canonical recipes.

- Pixel-level color sampling from hero.png (9-point grid + dominant clustering)
- Glow / highlight detection from pixel samples
- Structured vision fingerprint (precise measurements vs abstract enums)
- New visual.background.type: 'scanned' with SVG filter composition
- Synthesizer Phase 0.75: scan-first when confidence >= 0.7

Backwards-compatible:
- --preset <name> still forces preset-first
- --merge-with still wins Phase 0
- v0.7 profiles with preset background types render byte-identical
- Paper-aesthetic editorial-serif regression passes

Deferred to v0.9+: layout replication (3D element positioning), imagery generation, multi-page aesthetic synthesis, typography treatment extraction (letter-spacing, weight distribution)."

git push origin main
git push origin v0.8.0
gh release create v0.8.0 --title "v0.8.0 — Scan as design extractor" --notes "..."
```

DO NOT push automatically — user approves after regression battery passes.

---

## Success criteria

- [ ] `scripts/sample-pixels.mjs` exported, parses PNG via stdlib zlib, no new deps
- [ ] Pixel-sampled colors written to `scan.json.colors.sampled.dominant`
- [ ] Glow detection fires on TPS (flanking blue glow) but NOT on flat sites
- [ ] `prompts/vision-fingerprint.md` produces structured JSON with measurements
- [ ] `visual.background.type: "scanned"` renders without errors, composes SVG filters dynamically
- [ ] TPS re-scan renders cosmic-dark with blue glow (not paper)
- [ ] `--preset <name>` short-circuits scan-first (preset-path still available)
- [ ] `--merge-with` still wins Phase 0
- [ ] Paper-aesthetic editorial-serif regression render byte-identical to v0.7.1
- [ ] 200+/200+ fixture tests pass (+~15 new for pixel sampling + fingerprint)
- [ ] Synthesizer emits resolution note documenting scan-first vs preset-fallback decision

## Scope boundary — what's v0.8 vs v0.9+

**In v0.8 (this plan):**
- Pixel sampling (9-point grid + clustering)
- Glow / highlight detection
- Vision fingerprint with structured measurements (background type, focal elements, effects, atmosphere)
- `visual.background.type: "scanned"` renderer support
- 4 overlay types: starfield / vortex / blob / grain
- Synthesizer Phase 0.75: scan-first when confidence thresholds met
- Preset-first preserved via `--preset <name>` flag

**Deferred to v0.9+:**
- Layout replication (carousel mirrors hero element positioning — 3D renders at 15%/85% etc.)
- Imagery generation (produce 3D-render-style decorative elements in the carousel)
- Typography treatment extraction (letter-spacing, weight distribution, size scale ratios)
- Photography-type backgrounds (`type: "photographic"`)
- Multi-page aesthetic synthesis (sample across /, /about, /pricing — produce a richer fingerprint)
- User-controlled fingerprint override (edit `vision-fingerprint.json` by hand between scan and synthesis)
- Preset retirement (v0.9+ may retire presets entirely once scan-first is proven — or keep them as curated starting points)

## Parallelism opportunities

- Phase A.1 (pixel sampling) + A.2 (glow detection) can be combined into one agent (sequential code in same module)
- Phase B (vision fingerprint) is prompt authoring + commands/scan.md edit — isolated, parallel-safe with A + C
- Phase C.1 (schema docs) + C.2 (renderer) sequential — docs first, then renderer implementation
- Phase D (synthesizer update) must follow A + B + C (needs all three to reference)

Build order:
1. **Wave 1 parallel:** A (pixel sampling + glow) + B (vision fingerprint prompt)
2. **Wave 2 parallel:** C.1 (schema docs) + C.2 (renderer)
3. **Wave 3:** D (synthesizer scan-first)
4. **Wave 4:** E (regression + ship)

Estimated total: 6-8 hours agent time. Wall-clock with 2-parallel wave ≈ 4 hours.

## Process rules (non-negotiable)

1. **Paper-aesthetic regression render at every phase gate** — editorial-serif + noise-gradient + grit on cream must stay byte-identical. If any commit changes it, that's a regression.
2. **Zero new npm deps** — pixel sampling uses stdlib zlib, renderer uses SVG filter primitives, no `sharp` / `canvas` / `jimp`
3. **Scan-first doesn't auto-activate on low confidence** — better to fall back to preset than produce an incoherent scanned recipe
4. **Preset path remains first-class** — `--preset editorial-serif` should continue to produce Niek's validated "engaging already" output
5. **Glow detection must not false-positive** — a clean minimalist site shouldn't get a fake glow appended. Confidence threshold + luminance/saturation gates matter.
6. **Document EVERY scan-first decision in resolution notes** — users need to see why their carousel looks the way it does, especially for aesthetic debugging.
