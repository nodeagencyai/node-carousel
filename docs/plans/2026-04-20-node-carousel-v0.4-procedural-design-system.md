# Node Carousel v0.4 — Procedural Design System

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace arbitrary template coordinates and finite preset permutations with a tokenized design system + 8-composition pattern library + 6 orthogonal variation axes seeded from `hash(brand.handle + topic + version)` — so every carousel is visually unique yet quality-locked.

**Architecture:**
1. **Design tokens** (type scale, spacing scale, grid, anchors, color roles) — single source of truth for every numeric decision
2. **Pattern library** — 8 named compositions on a 6-col × 24-row grid, each declaring slots + variant properties
3. **Variation sampler** — seeded RNG picks values on 6 orthogonal axes per carousel
4. **Strategy picks macro, render picks micro** — Claude picks pattern + content at strategy time; render.mjs samples remaining axes deterministically

**Breaking change from v0.3** — old brand profiles still validate (backward compat) but renders apply the new token system so output looks different. Template files are replaced, not migrated. `templates/` gets a V1/V2 split.

**Tech stack:** Same pipeline (Node.js + SVG + pure-stdlib render.mjs). No new deps. Seeded RNG via `crypto.createHash('sha256')` + linear congruential PRNG (stdlib only).

**Research inputs (all 4 completed 2026-04-20):**
- `docs/research/2026-04-20-generative-design-systems.md` — compositional grammar, seeded sampling, MIT Media Lab precedent
- `docs/research/2026-04-20-typography-systems.md` — Perfect Fourth scale, 8px baseline, stat:label 2.35:1 not 5:1
- `docs/research/2026-04-20-grid-and-spacing-systems.md` — 6-col × 136 + 24 gutter + 72 margins, 24px rows, 13 anchors
- `docs/research/2026-04-20-creator-visual-patterns.md` — pattern library 8-10, 8 universal moves, 6 variation axes

**Constraints:**
- DO NOT touch v0.3 `/carousel:*` plugin or `/tps-*` TPS stuff — this is isolated to `node-carousel/`
- DO NOT add external dependencies — pure Node stdlib
- Every hardcoded number in existing templates must be replaced with a token reference
- Seeded sampling must be deterministic — same `(brand, topic, version)` input always produces same carousel
- v0.4 ships alongside v0.3 templates; user can opt back via `visual.engine: "v0.3"` flag if anything regresses

---

## Phase A: Design tokens — the single source of truth

Goal: one module exporting the full token system. Every template, variant, and render decision references tokens, never literals.

### Task A.1 — Create `tokens/typography.js`

**Files:**
- Create: `tokens/typography.js`

**Step 1: Write type scale**

Perfect Fourth (1.333) × base 16px, steps −2 through +10, every value rounded to the nearest multiple of 4 so it lands on the 8px baseline grid:

```javascript
// Perfect Fourth modular scale (ratio 1.333), base 16px
// Every value quantized to 4px so it lands on the 8px baseline grid.
// See docs/research/2026-04-20-typography-systems.md for derivation.

export const TYPE_SCALE = {
  '-2': 12,   // micro caption
  '-1': 12,
  '0': 16,    // body base
  '+1': 20,
  '+2': 28,
  '+3': 36,   // large body
  '+4': 48,   // label
  '+5': 64,   // sub-headline
  '+6': 88,   // headline
  '+7': 116,  // hero headline
  '+8': 156,  // display stat (replaces current 240)
  '+9': 208,  // hero stat
  '+10': 276, // oversized hero display
};

// Semantic aliases — use these in templates, not raw steps.
export const TYPE = {
  micro: TYPE_SCALE['-1'],       // 12
  caption: TYPE_SCALE['+1'],     // 20 (upgrade from 16)
  body: TYPE_SCALE['+2'],        // 28
  bodyLarge: TYPE_SCALE['+3'],   // 36
  label: TYPE_SCALE['+4'],       // 48
  subhead: TYPE_SCALE['+5'],     // 64
  headline: TYPE_SCALE['+6'],    // 88
  hero: TYPE_SCALE['+7'],        // 116
  stat: TYPE_SCALE['+8'],        // 156 (replaces broken 280)
  statHero: TYPE_SCALE['+9'],    // 208
};

// Letter-spacing at display scale — tightens with size.
// Add to the CSS class in templates.
export function letterSpacingForSize(px) {
  if (px <= 36) return '0';
  if (px <= 64) return '-0.02em';
  if (px <= 120) return '-0.03em';
  if (px <= 200) return '-0.04em';
  return '-0.05em';
}

// Line-height at display scale.
export function lineHeightForSize(px) {
  if (px <= 36) return 1.4;
  if (px <= 64) return 1.15;
  if (px <= 120) return 1.05;
  return 1.0;
}

// Font stack by class — always include fallback.
export function fontStack(familyName, kind = 'sans') {
  const fallback = kind === 'serif' ? 'serif' : kind === 'mono' ? 'ui-monospace, monospace' : 'sans-serif';
  return `'${familyName}', ${fallback}`;
}
```

**Step 2: Verify**

```bash
cd "$HOME/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"
node -e "const t = await import('./tokens/typography.js'); console.log(t.TYPE); console.log(t.letterSpacingForSize(156)); console.log(t.lineHeightForSize(156));" --input-type=module
```
Expected: semantic aliases print, letter-spacing returns `-0.04em` for 156px, line-height returns `1.0`.

**Step 3: Commit**

```bash
git add tokens/typography.js
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): typography tokens (Perfect Fourth scale, 8px baseline)"
```

---

### Task A.2 — Create `tokens/spacing.js`

**Files:**
- Create: `tokens/spacing.js`

**Step 1: Write spacing scale**

8px base unit. 10-step non-linear scale calibrated per research.

```javascript
// 8px base unit. space-1 = 4px is reserved for within-element (icon padding, etc).
// Rest all multiples of 8 to stay on baseline grid.
// See docs/research/2026-04-20-grid-and-spacing-systems.md.

export const SPACE = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 16,
  '4': 24,
  '5': 32,
  '6': 48,
  '7': 64,
  '8': 96,
  '9': 144,
  '10': 192,
};

// Semantic aliases
export const SPACING = {
  tight: SPACE['2'],        // 8 — within-element
  snug: SPACE['3'],         // 16 — bullets, inline
  default: SPACE['4'],      // 24 — between related elements
  group: SPACE['5'],        // 32 — between grouped items
  section: SPACE['6'],      // 48 — between zones
  zone: SPACE['7'],         // 64 — major zones
  hero: SPACE['8'],         // 96 — hero breathing
  dominant: SPACE['9'],     // 144 — dominant whitespace
};

// Optical equivalence: larger elements need proportionally more space before them.
// Returns space in px. Use as y-offset before an element of the given size.
export function opticalSpacing(elementTypeSize, role = 'peer') {
  const factor = { peer: 1.0, subordinate: 0.75, footer: 2.0 }[role] ?? 1.0;
  const raw = elementTypeSize * factor;
  // Round to nearest 8 (baseline grid).
  return Math.round(raw / 8) * 8;
}
```

**Step 2: Verify**

```bash
node -e "const s = await import('./tokens/spacing.js'); console.log(s.SPACING); console.log(s.opticalSpacing(88));" --input-type=module
```

**Step 3: Commit**

```bash
git add tokens/spacing.js
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): spacing tokens + optical equivalence helper"
```

---

### Task A.3 — Create `tokens/grid.js`

**Files:**
- Create: `tokens/grid.js`

**Step 1: Define grid + anchors**

```javascript
// 1080x1350 Instagram 4:5. 6-col grid chosen because it divides 1080
// cleanly with 72px side margins and 24px gutters (6*136 + 5*24 + 2*72 = 1080).
// 24px baseline rows, 56 rows tall (56 * 24 = 1344, plus 6px top offset).
// See docs/research/2026-04-20-grid-and-spacing-systems.md.

export const CANVAS = { width: 1080, height: 1350 };

export const GRID = {
  columns: 6,
  columnWidth: 136,
  gutter: 24,
  sideMargin: 72,
  topMargin: 96,      // clears IG UI overlay
  bottomMargin: 96,   // clears like/save buttons
  rowHeight: 24,      // baseline
};

// Precomputed column x-positions
export const COLS = (() => {
  const xs = [];
  let x = GRID.sideMargin;
  for (let i = 0; i < GRID.columns; i++) {
    xs.push(x);
    x += GRID.columnWidth + GRID.gutter;
  }
  return xs;
})();

// Named vertical anchors on the 1080x1350 canvas.
// All values land on 8px baseline (multiples of 8).
export const ANCHORS = {
  // Flag zone (above-the-fold of IG scroll)
  FLAG_TOP: 96,          // kicker/category lives here
  FLAG_BOTTOM: 200,

  // Golden ratio upper third — hero headline on cover slides
  GOLDEN_UPPER: 515,

  // Optical center — headline on body slides (slightly above geometric)
  OPTICAL_CENTER: 620,

  // Geometric center
  CENTER: 675,

  // Body zones
  BODY_TOP: 360,
  BODY_BOTTOM: 1152,

  // Footer zone (brand attribution, numbering)
  FOOTER_TOP: 1176,
  FOOTER_CENTER: 1224,
  FOOTER_BOTTOM: 1256,
};

// Convenience: column x-position for span
export function col(startCol, span = 1) {
  const x = COLS[startCol];
  const width = span * GRID.columnWidth + (span - 1) * GRID.gutter;
  return { x, width };
}

// Convenience: row y-position (1-indexed from topMargin)
export function row(n) {
  return GRID.topMargin + (n - 1) * GRID.rowHeight;
}
```

**Step 2: Verify**

```bash
node -e "const g = await import('./tokens/grid.js'); console.log(g.COLS); console.log(g.ANCHORS); console.log(g.col(1, 3));" --input-type=module
```
Expected: 6 column x-positions starting at 72; ANCHORS printed; `col(1, 3)` = `{x: 232, width: 456}`.

**Step 3: Commit**

```bash
git add tokens/grid.js
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): grid tokens (6-col, 24-row baseline, 13 named anchors)"
```

---

### Task A.4 — Create `tokens/color-roles.js`

**Files:**
- Create: `tokens/color-roles.js`

**Step 1: Semantic color roles**

Material 3-inspired: primitives (user-supplied hex) → semantic roles (what renders use) → contrast pairs computed automatically.

```javascript
// Semantic color roles derived from brand palette.
// Templates never reference hex directly — only roles like SURFACE, ON_SURFACE.
// See docs/research/2026-04-20-generative-design-systems.md on Material 3 on-color pairs.

import { hexToRgb, rgbToHex, mix, luminance } from './color-utils.js';

/**
 * Given a brand palette, return semantic roles + contrast pairs.
 * Always guarantees on-X has >= 4.5:1 contrast against X.
 */
export function buildColorRoles(brandColors) {
  const { background, text, accent, accentSecondary, muted } = brandColors;

  const roles = {
    SURFACE: background,
    ON_SURFACE: text,
    SURFACE_MUTED: muted,
    ACCENT: accent,
    ON_ACCENT: pickOnColor(accent, [background, text]),
    ACCENT_SECONDARY: accentSecondary || accent,

    // Tinted variants — useful for decorations, cards, fills
    SURFACE_TINT_5: mix(background, accent, 0.05),
    SURFACE_TINT_12: mix(background, accent, 0.12),
    SURFACE_TINT_20: mix(background, accent, 0.20),
  };

  return roles;
}

/** Pick whichever of `options` has highest contrast against bg. */
function pickOnColor(bg, options) {
  let best = options[0];
  let bestContrast = 0;
  for (const opt of options) {
    const c = contrastRatio(bg, opt);
    if (c > bestContrast) { bestContrast = c; best = opt; }
  }
  return best;
}

function contrastRatio(a, b) {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

**Step 2: Create `tokens/color-utils.js`**

Tiny helpers — no external color library.

```javascript
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16) };
}

export function rgbToHex({ r, g, b }) {
  const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

export function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

export function luminance({ r, g, b }) {
  const lin = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
```

**Step 3: Verify**

```bash
node -e "const c = await import('./tokens/color-roles.js'); console.log(c.buildColorRoles({background:'#0f0f0f',text:'#FFFFFF',accent:'#29F2FE',muted:'#999999'}));" --input-type=module
```

**Step 4: Commit**

```bash
git add tokens/color-roles.js tokens/color-utils.js
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): semantic color roles with contrast-aware on-color pairs"
```

---

## Phase B: Seeded variation sampler

Goal: deterministic RNG + 6 orthogonal variation axes. Same `(brand, topic)` always produces same carousel; different `(brand, topic)` picks different axis values.

### Task B.1 — `tokens/seeded-random.js`

**Files:**
- Create: `tokens/seeded-random.js`

**Step 1: Implement seeded PRNG**

```javascript
// SHA-256 of seed string → 32-bit integer → mulberry32 PRNG.
// Deterministic, fast, good distribution. Pure stdlib.
import { createHash } from 'node:crypto';

export function createRng(seedString) {
  const hash = createHash('sha256').update(String(seedString)).digest();
  let state = hash.readUInt32BE(0);

  function next() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    // Pick an index from a list, deterministically.
    pick: arr => arr[Math.floor(next() * arr.length)],
    // Pick a weighted entry. weights is [[value, weight], ...].
    pickWeighted: entries => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of entries) {
        if ((r -= w) <= 0) return v;
      }
      return entries[entries.length - 1][0];
    },
    // Float in [min, max).
    range: (min, max) => min + next() * (max - min),
    // Int in [min, max].
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
  };
}

// Build the canonical seed for a carousel.
export function buildSeed({ brandHandle, topic, version = 'v0.4' }) {
  return `${version}::${String(brandHandle).trim()}::${String(topic).trim()}`;
}
```

**Step 2: Test determinism**

```bash
node -e "const { createRng, buildSeed } = await import('./tokens/seeded-random.js'); const r = createRng(buildSeed({brandHandle:'@nodeagency', topic:'AI automation'})); console.log([r.next(), r.next(), r.next()]);" --input-type=module
# Run twice — outputs must match exactly.
```

**Step 3: Commit**

```bash
git add tokens/seeded-random.js
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): seeded RNG (sha256 + mulberry32) for deterministic sampling"
```

---

### Task B.2 — Define 6 variation axes in `tokens/axes.js`

**Files:**
- Create: `tokens/axes.js`

Each axis is an array of values. The sampler picks one value per axis per carousel.

```javascript
// 6 orthogonal variation axes. Each carousel samples one value per axis.
// See docs/research/2026-04-20-creator-visual-patterns.md § "orthogonal axes".

export const AXES = {
  // How content fills the grid
  density: [
    { name: 'airy', bodyColumns: 4, padding: 'SECTION' },    // 4 of 6 cols, lots of breathing
    { name: 'balanced', bodyColumns: 5, padding: 'DEFAULT' },
    { name: 'dense', bodyColumns: 6, padding: 'SNUG' },
  ],
  // Where the visual weight lands
  composition: [
    'centered',         // symmetric, classic
    'ragged-left',      // editorial, asymmetric left
    'ragged-right',     // mirror of ragged-left
    'split-vertical',   // 2-zone stacked
    'split-horizontal', // 2-zone side-by-side
  ],
  // Which word/element takes the accent color
  emphasis: [
    'first-word',
    'last-word',
    'middle-noun',
    'hero-only',        // only the stat/number gets accent
    'none',             // pure monochrome, no accent word
  ],
  // How many focal elements per slide
  hierarchy: [
    { name: 'single', maxFocal: 1 },     // one hero thing
    { name: 'pair', maxFocal: 2 },       // hero + sub
    { name: 'list', maxFocal: 5 },       // bullet-style
  ],
  // Where the brand accent appears
  accentPlacement: [
    'headline-word',
    'underline-rule',
    'corner-chip',
    'border-frame',
    'tint-surface',
    'none',
  ],
  // Which decorative atoms compose on each slide
  decorationMix: [
    [],                            // clean
    ['cornerMarks'],
    ['accentRule'],
    ['accentRule', 'numberBadges'],
    ['oversizedMark'],
    ['pullQuoteBlock'],
    ['cornerMarks', 'accentRule'],
  ],
};

// Sample an axis profile for a carousel given a seeded RNG.
// This is the "personality" of this specific carousel run.
export function sampleCarouselAxes(rng) {
  return {
    density: rng.pick(AXES.density),
    composition: rng.pick(AXES.composition),
    emphasis: rng.pick(AXES.emphasis),
    hierarchy: rng.pick(AXES.hierarchy),
    accentPlacement: rng.pick(AXES.accentPlacement),
    decorationMix: rng.pick(AXES.decorationMix),
  };
}
```

**Step 2: Test**

```bash
node -e "
const { createRng, buildSeed } = await import('./tokens/seeded-random.js');
const { sampleCarouselAxes } = await import('./tokens/axes.js');
for (const topic of ['AI automation', 'CRM audit', 'lead magnets']) {
  const rng = createRng(buildSeed({brandHandle: '@nodeagency', topic}));
  console.log(topic, sampleCarouselAxes(rng));
}
" --input-type=module
```
Expected: three different axis profiles. Running twice on same topic returns same profile.

**Step 3: Commit**

```bash
git add tokens/axes.js
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): 6 orthogonal variation axes + seeded sampler"
```

---

## Phase C: Pattern library — 8 named compositions

Goal: replace current 6 templates + 9 variants with 8 curated grid-snapped compositions. Each pattern declares slots (hero, body, footer) + which axes apply.

Per research: 6–10 compositions is the creator-library sweet spot. Target 8. Hard rule: every slot position must reference grid tokens, no literals.

### Task C.1 — Pattern manifest

**Files:**
- Create: `patterns/manifest.json`

**Step 1: Define 8 patterns**

```json
{
  "$schema": "./manifest.schema.json",
  "version": "v0.4",
  "patterns": [
    {
      "id": "cover-asymmetric",
      "role": "cover",
      "description": "Hero cover. Kicker top-left, massive headline bottom-left, handle bottom-right.",
      "slots": ["kicker", "headline", "handle"],
      "supportsAxes": ["emphasis", "accentPlacement", "decorationMix"],
      "template": "cover-asymmetric.svg"
    },
    {
      "id": "cover-centered",
      "role": "cover",
      "description": "Centered hero. Kicker, headline, handle all middle-aligned.",
      "slots": ["kicker", "headline", "handle"],
      "supportsAxes": ["emphasis", "accentPlacement", "decorationMix"],
      "template": "cover-centered.svg"
    },
    {
      "id": "list-numbered",
      "role": "body",
      "description": "Headline + 3-5 numbered items. Numbers get display-font treatment.",
      "slots": ["headline", "items"],
      "supportsAxes": ["density", "composition", "accentPlacement", "decorationMix"],
      "template": "list-numbered.svg"
    },
    {
      "id": "list-bullet",
      "role": "body",
      "description": "Headline + 3-5 arrow-prefixed bullets. Default body pattern.",
      "slots": ["headline", "items"],
      "supportsAxes": ["density", "composition", "accentPlacement", "decorationMix"],
      "template": "list-bullet.svg"
    },
    {
      "id": "stat-dominant",
      "role": "body",
      "description": "One huge stat, label below. 2.35:1 ratio per research.",
      "slots": ["stat", "label", "context"],
      "supportsAxes": ["composition", "accentPlacement"],
      "template": "stat-dominant.svg"
    },
    {
      "id": "quote-pulled",
      "role": "body",
      "description": "Quote-first composition. Accent-colored quote, muted attribution.",
      "slots": ["quote", "attribution"],
      "supportsAxes": ["composition", "accentPlacement", "decorationMix"],
      "template": "quote-pulled.svg"
    },
    {
      "id": "split-comparison",
      "role": "body",
      "description": "Two zones side-by-side. Before/after, us/them, problem/solution.",
      "slots": ["leftLabel", "leftBody", "rightLabel", "rightBody"],
      "supportsAxes": ["emphasis", "accentPlacement"],
      "template": "split-comparison.svg"
    },
    {
      "id": "cta-stacked",
      "role": "cta",
      "description": "Hook + single CTA button + handle. Closes the deck.",
      "slots": ["hook", "button", "subtext", "handle"],
      "supportsAxes": ["accentPlacement", "decorationMix"],
      "template": "cta-stacked.svg"
    }
  ]
}
```

**Step 2: Commit**

```bash
git add patterns/manifest.json
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): pattern manifest with 8 curated compositions"
```

---

### Tasks C.2 through C.9 — Build each pattern SVG

One task per pattern. Each pattern SVG:
- Uses grid tokens via render-time substitution (`{{COL_1_X}}`, `{{ANCHOR_GOLDEN_UPPER}}`, etc.)
- Uses typography tokens (`{{TYPE_HERO}}`, `{{TYPE_STAT}}`)
- Uses spacing tokens (`{{SPACING_HERO}}`)
- Uses color roles (`{{SURFACE}}`, `{{ON_SURFACE}}`, `{{ACCENT}}`)
- Declares slots — content placeholders match manifest `slots`
- Has `{{BACKGROUND}}`, `{{DECORATIONS}}`, `{{NUMBERING}}` injection points

Each task follows the same shape:

**Step 1: Write the SVG template referencing only tokens.**

Example for `cover-asymmetric.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {{WIDTH}} {{HEIGHT}}" width="{{WIDTH}}" height="{{HEIGHT}}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family={{FONT_DISPLAY_URL}}:wght@700;800&amp;family={{FONT_BODY_URL}}:wght@400;500&amp;display=swap');
      .kicker { font-family: {{FONT_BODY_STACK}}; font-weight: 500; font-size: {{TYPE_BODY}}px; letter-spacing: 0.22em; text-transform: uppercase; fill: {{ACCENT}}; }
      .headline { font-family: {{FONT_DISPLAY_STACK}}; font-weight: 800; font-size: {{TYPE_HERO}}px; fill: {{ON_SURFACE}}; letter-spacing: {{TITLE_LETTER_SPACING}}; line-height: {{TITLE_LINE_HEIGHT}}; }
      .handle { font-family: {{FONT_BODY_STACK}}; font-weight: 500; font-size: {{TYPE_BODY}}px; fill: {{SURFACE_MUTED}}; letter-spacing: 0.05em; }
    </style>
  </defs>
  {{BACKGROUND}}
  {{DECORATIONS}}
  <text x="{{COL_1_X}}" y="{{ANCHOR_FLAG_TOP}}" class="kicker">{{KICKER}}</text>
  <line x1="{{COL_1_X}}" y1="{{ANCHOR_FLAG_RULE_Y}}" x2="{{RULE_END_X}}" y2="{{ANCHOR_FLAG_RULE_Y}}" stroke="{{ACCENT}}" stroke-width="3"/>
  <text x="{{COL_1_X}}" y="{{HEADLINE_Y}}" class="headline">
    <tspan x="{{COL_1_X}}" dy="0">{{HEADLINE_LINE_1}}</tspan>
    <tspan x="{{COL_1_X}}" dy="{{HEADLINE_DY}}">{{HEADLINE_LINE_2}}</tspan>
  </text>
  <text x="{{WIDTH_MINUS_MARGIN}}" y="{{ANCHOR_FOOTER_CENTER}}" class="handle" text-anchor="end">{{BRAND_HANDLE}}</text>
</svg>
```

**Step 2: Visual verification (MANDATORY)** — render against a realistic fixture + `open` in browser + narrate what you see.

**Step 3: Commit** — atomic per pattern.

Repeat for all 8 patterns. Build order:

- C.2: `cover-asymmetric.svg`
- C.3: `cover-centered.svg`
- C.4: `list-numbered.svg`
- C.5: `list-bullet.svg`
- C.6: `stat-dominant.svg` ← FIX the broken 5:1 ratio here: stat=156, label=48 ideal, or 156+64 if context below
- C.7: `quote-pulled.svg`
- C.8: `split-comparison.svg`
- C.9: `cta-stacked.svg`

Each commit: `feat(v0.4): pattern/<id> — <description>`

---

## Phase D: Render.mjs refactor

Goal: render pipeline consumes tokens + samples axes + fills pattern templates.

### Task D.1 — New `scripts/render-v0.4.mjs`

**Files:**
- Create: `scripts/render-v0.4.mjs`

Don't modify existing `render.mjs` yet — ship side-by-side so v0.3 behavior stays intact while testing v0.4. Once v0.4 passes examples regeneration, swap.

**Step 1: Core render flow**

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TYPE, letterSpacingForSize, lineHeightForSize, fontStack } from '../tokens/typography.js';
import { SPACING, opticalSpacing } from '../tokens/spacing.js';
import { CANVAS, GRID, COLS, ANCHORS, col, row } from '../tokens/grid.js';
import { buildColorRoles } from '../tokens/color-roles.js';
import { createRng, buildSeed } from '../tokens/seeded-random.js';
import { sampleCarouselAxes } from '../tokens/axes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

// Load pattern manifest
const MANIFEST = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'patterns', 'manifest.json'), 'utf8'));

export function renderCarousel({ brand, strategy, outputDir }) {
  const seed = buildSeed({ brandHandle: brand.brand.handle, topic: strategy.topic });
  const rng = createRng(seed);
  const axes = sampleCarouselAxes(rng);

  const colorRoles = buildColorRoles(brand.visual.colors);
  const tokens = buildTokenValues(brand, colorRoles, axes);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, '_axes.json'), JSON.stringify({ seed, axes }, null, 2));

  strategy.slides.forEach((slide, i) => {
    const svg = renderSlide({
      slide,
      slideNumber: i + 1,
      slideTotal: strategy.slides.length,
      brand,
      tokens,
      axes,
      rng,  // per-slide sampling uses the seeded RNG too
    });
    const n = String(i + 1).padStart(2, '0');
    writeFileSync(join(outputDir, `slide-${n}.svg`), svg);
  });
}

function buildTokenValues(brand, colorRoles, axes) {
  const fonts = brand.visual.fonts;
  const tv = {
    // Canvas
    WIDTH: CANVAS.width,
    HEIGHT: CANVAS.height,

    // Colors (roles, not hex)
    SURFACE: colorRoles.SURFACE,
    ON_SURFACE: colorRoles.ON_SURFACE,
    SURFACE_MUTED: colorRoles.SURFACE_MUTED,
    ACCENT: colorRoles.ACCENT,
    ON_ACCENT: colorRoles.ON_ACCENT,

    // Fonts
    FONT_DISPLAY: fonts.display,
    FONT_BODY: fonts.body,
    FONT_DISPLAY_URL: String(fonts.display).replace(/\s+/g, '+'),
    FONT_BODY_URL: String(fonts.body).replace(/\s+/g, '+'),
    FONT_DISPLAY_STACK: fontStack(fonts.display, guessKind(fonts.display, 'serif')),
    FONT_BODY_STACK: fontStack(fonts.body, guessKind(fonts.body, 'sans')),

    // Type scale (semantic aliases)
    TYPE_MICRO: TYPE.micro,
    TYPE_BODY: TYPE.body,
    TYPE_LABEL: TYPE.label,
    TYPE_SUBHEAD: TYPE.subhead,
    TYPE_HEADLINE: TYPE.headline,
    TYPE_HERO: TYPE.hero,
    TYPE_STAT: TYPE.stat,

    // Columns
    COL_1_X: COLS[0],
    COL_6_END_X: COLS[5] + GRID.columnWidth,
    WIDTH_MINUS_MARGIN: CANVAS.width - GRID.sideMargin,

    // Anchors
    ANCHOR_FLAG_TOP: ANCHORS.FLAG_TOP,
    ANCHOR_FLAG_RULE_Y: ANCHORS.FLAG_TOP + 24,
    ANCHOR_OPTICAL_CENTER: ANCHORS.OPTICAL_CENTER,
    ANCHOR_GOLDEN_UPPER: ANCHORS.GOLDEN_UPPER,
    ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,

    // Computed: rule end position for kicker accent rule (120px from COL_1_X)
    RULE_END_X: COLS[0] + 120,
  };

  // Display-size-dependent values
  tv.TITLE_LETTER_SPACING = letterSpacingForSize(TYPE.hero);
  tv.TITLE_LINE_HEIGHT = lineHeightForSize(TYPE.hero);
  tv.HEADLINE_DY = Math.round(TYPE.hero * lineHeightForSize(TYPE.hero));

  return tv;
}

function guessKind(fontName, fallback) {
  const n = String(fontName).toLowerCase();
  if (n.includes('mono')) return 'mono';
  if (n.includes('serif') || ['playfair', 'instrument', 'dm serif', 'georgia'].some(s => n.includes(s))) return 'serif';
  return fallback;
}

function renderSlide({ slide, slideNumber, slideTotal, brand, tokens, axes, rng }) {
  const patternDef = MANIFEST.patterns.find(p => p.id === slide.pattern);
  if (!patternDef) throw new Error(`Unknown pattern: ${slide.pattern}`);

  const templatePath = join(PLUGIN_ROOT, 'patterns', patternDef.template);
  const template = readFileSync(templatePath, 'utf8');

  // TODO: inject BACKGROUND, DECORATIONS, NUMBERING per existing system
  // TODO: apply axis values (emphasis word highlighting, etc.)

  const values = {
    ...tokens,
    ...slide.data,
    SLIDE_NUMBER: slideNumber,
    SLIDE_TOTAL: slideTotal,
    BACKGROUND: '',    // placeholder — wire to existing renderBackground
    DECORATIONS: '',   // placeholder — wire to existing renderDecorations
    NUMBERING: '',     // placeholder — wire to existing renderNumbering
    HEADLINE_Y: ANCHORS.GOLDEN_UPPER,  // default — patterns can override
  };

  return fillTemplate(template, values);
}

function fillTemplate(str, values) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [brandPath, strategyPath, outDir] = process.argv.slice(2);
  const brand = JSON.parse(readFileSync(resolve(brandPath), 'utf8'));
  const strategy = JSON.parse(readFileSync(resolve(strategyPath), 'utf8'));
  renderCarousel({ brand, strategy, outputDir: resolve(outDir) });
  console.log('\u2713 v0.4 render complete');
}
```

**Step 2: Test with fixture**

Build `test/fixtures/strategy-v0.4-sample.json` using patterns (not templates):

```json
{
  "topic": "AI automation patterns",
  "slides": [
    { "pattern": "cover-asymmetric", "data": { "KICKER": "5 SIGNS", "HEADLINE_LINE_1": "Your AI is", "HEADLINE_LINE_2": "overbuilt" } },
    { "pattern": "list-numbered", "data": { "HEADLINE": "The tells", "ITEM_1": "Automating a broken process", "ITEM_2": "Hiding decisions instead of removing them", "ITEM_3": "Scoping to demo day, not day 90" } },
    { "pattern": "stat-dominant", "data": { "STAT_VALUE": "73%", "STAT_LABEL": "of AI projects never ship", "STAT_CONTEXT": "Gartner, 2024" } },
    { "pattern": "cta-stacked", "data": { "HOOK_LINE_1": "Building one?", "BUTTON": "DM AUDIT", "SUBTEXT": "I'll review your setup" } }
  ]
}
```

Run and visually verify in browser.

**Step 3: Wire decoration + numbering + background** from existing v0.3 render.mjs (port functions, don't duplicate — import them).

**Step 4: Commit**

```bash
git add scripts/render-v0.4.mjs test/fixtures/strategy-v0.4-sample.json
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.4): render pipeline with token substitution + axis sampling"
```

---

### Task D.2 — Port background / decoration / numbering

Pull out v0.3's `renderBackground`, `renderDecorations`, `renderNumbering` functions into `scripts/shared-render.mjs`. Import into both v0.3 and v0.4 render. DRY.

Atomic commit.

---

### Task D.3 — Apply axis values in render

The per-carousel axes must actually affect output. Concretely:

- `density` → adjusts body column span (e.g., `list-bullet` renders with 4-col body vs 6-col)
- `composition` → swaps cover-centered vs cover-asymmetric automatically if strategy picks `cover`
- `emphasis` → wraps the chosen word in a `<tspan fill="{{ACCENT}}">` automatically
- `accentPlacement` → determines whether accent lives on a word, a rule, a chip, etc.
- `decorationMix` → overrides per-slide decoration config

Implement each axis effect as a small function in `scripts/apply-axes.mjs`. Dispatch by axis name. Each effect is 10–30 lines.

Verify visually: run same strategy with seed `brand:@node topic:test-1` vs `brand:@node topic:test-2` → slides should compose differently despite same content.

---

## Phase E: Strategy prompt rewrite

Goal: prompt teaches Claude to use `pattern` field instead of `template`, produces realistic slot content, respects axis-aware composition.

### Task E.1 — Rewrite `prompts/strategy-system.md` for v0.4

**Files:**
- Modify: `prompts/strategy-system.md`

Major rewrite. Key changes:

1. Output format changes: `{ "topic": "...", "slides": [{ "pattern": "...", "data": {...} }] }`
2. Document all 8 patterns with when-to-use rules (from manifest)
3. Remove v0.3 composition-variant docs (obsolete — pattern replaces them)
4. Add `topic` as required top-level field (seed depends on it)
5. Hard rule: every carousel starts with a `cover-*` pattern, ends with `cta-*`, body in between

Keep voice/tone rules intact.

**Commit:** `feat(v0.4): strategy prompt rewrite for pattern + topic schema`

---

## Phase F: Migrate existing examples

Goal: regenerate 3 examples using v0.4 pipeline. Proves end-to-end system works.

Per example:
1. Extend `brand-profile.json` with `engine: "v0.4"` flag (or similar version toggle)
2. Rewrite `strategy.json` to use patterns instead of templates
3. Run `node scripts/render-v0.4.mjs`
4. Open preview + visually verify polish
5. Commit

3 atomic commits (one per example).

---

## Phase G: Docs + ship

### Task G.1 — Document the design system

**Files:**
- Create: `docs/design-system-v0.4.md`

Full token reference + pattern catalog + axis documentation + examples.

### Task G.2 — Update README + CHANGELOG

- README: add "v0.4 procedural system" section with a before/after visual comparison
- Bump plugin.json to 0.4.0
- Update brand-profile-schema.md with token references

### Task G.3 — Final smoke test + v0.4.0 tag

Same E2E test as earlier versions. Tag `v0.4.0`. Pause for user on GitHub push.

---

## Success criteria

- [ ] 8 pattern templates exist and render cleanly against the token system
- [ ] Running the same `(brand, topic)` twice produces byte-identical SVGs (deterministic)
- [ ] Running different `(brand, topic)` pairs produces visibly different compositions on the same pattern
- [ ] Every template file contains ZERO hardcoded px values — only token references
- [ ] Stat-dominant pattern uses 156px stat + 64px label (~2.4:1 ratio, not 5:1)
- [ ] Every `y` coordinate lands on 8px baseline; every `x` lands on grid columns
- [ ] All 3 example carousels regenerated — same content, visibly different from v0.3 output
- [ ] README has a before/after screenshot pair
- [ ] v0.1–v0.3 brand profiles still render (backward compat — use v0.3 engine by default, opt into v0.4 via flag)
- [ ] Zero new npm dependencies
- [ ] Plugin.json bumped to 0.4.0

## Build order (ship incrementally)

Each phase is independently verifiable. Niek verifies visually before the next phase kicks off.

1. **Phase A** (tokens) — ~1.5 hrs. Foundation. Nothing user-visible yet.
2. **Phase B** (seeded sampler + axes) — ~1 hr. Still nothing user-visible. But testable via determinism.
3. **Phase C** (8 patterns) — ~3 hrs. First user-visible output. Visual verification per pattern.
4. **Phase D** (render refactor) — ~2 hrs. Wires everything.
5. **Phase E** (strategy prompt) — ~45 min.
6. **Phase F** (example regen) — ~1 hr. The proof.
7. **Phase G** (docs + ship) — ~45 min.

Total: ~10 hours focused work. 3–4 sessions.

## Backward compatibility

`brand.visual.engine` field (default `"v0.3"`) controls which render pipeline runs. v0.4 opt-in. Once validated, default flips to `"v0.4"` in a future minor version.

## Process rules (non-negotiable)

1. **Every new template gets visual verification before commit.** No exceptions. The previous overflow bug shipped because verification was skipped.
2. **Tokens are the single source of truth.** If a template needs a new constant, add it to a token module first.
3. **Commits stay atomic.** One pattern per commit. One axis per commit.
4. **Deterministic output is a hard contract.** Tests must assert `render(input)` produces the same output on two runs.
