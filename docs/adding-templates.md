# Adding a New Pattern

This guide covers adding a new slide **pattern** to node-carousel. Examples today: `cover-asymmetric`, `list-bullet`, `stat-dominant`, `quote-pulled`, `split-comparison`, `cta-stacked`, and so on.

> **Naming note.** In v0.3 these were called "templates" and lived in `templates/` alongside `scripts/render.mjs`. As of v0.4 they are called **patterns** and live in `patterns/`, rendered by `scripts/render-v0.4.mjs`. The old v0.3 template system is **frozen** — do not add new files to `templates/` or extend `scripts/render.mjs`. All new work goes through the patterns pipeline.

## How patterns work

A carousel is a sequence of slides. Each slide picks a **pattern** by id (e.g. `"pattern": "list-bullet"`) and supplies a `data` object whose keys fill the `{{UPPERCASE}}` placeholders in that pattern's SVG.

Patterns are parameterized SVGs. They are:
- **Token-driven** — colors, fonts, spacing, grid anchors, and typography sizes come from `tokens/` (typography.js, spacing.js, grid.js, color-roles.js). Patterns reference tokens like `{{ACCENT}}`, `{{TYPE_HERO}}`, `{{COL_1_X}}`, `{{ANCHOR_BODY_TOP}}` — never hardcoded hex/px values.
- **Composable** — the renderer injects a background, decorations, optional logo, and slide numbering into every pattern via `{{BACKGROUND}}`, `{{DECORATIONS}}`, `{{LOGO}}`, `{{NUMBERING}}`.
- **Deterministic** — `render-v0.4.mjs` seeds an RNG from `(brand, topic)` and samples variation axes (emphasis, density, composition, accentPlacement, decorationMix) so the same inputs produce byte-identical SVGs.

### Render flow (at a glance)

`scripts/render-v0.4.mjs`:
1. Reads `patterns/manifest.json` and indexes patterns by id.
2. For each slide in the strategy, loads `patterns/<template>.svg`.
3. Computes token values + samples axes per slide.
4. Fills `{{PLACEHOLDERS}}` (tokens, axis-derived values, slide `data`).
5. Writes `slide-NN.svg` to the output directory.

## Required placeholders (every pattern)

Every pattern SVG must include:

- `viewBox="0 0 {{WIDTH}} {{HEIGHT}}"` and `width="{{WIDTH}}" height="{{HEIGHT}}"` on the root `<svg>` (canvas is 1080×1350 by default).
- `{{BACKGROUND}}` — the renderer injects the chosen background here (solid / gradient / mesh / radial / image / dot-grid / geometric-shapes / glow-sphere / noise-gradient).
- `{{FONT_IMPORTS}}` inside `<defs><style>` — the renderer expands this to the correct Google Fonts `@import` lines based on the brand profile.
- `{{DECORATIONS}}`, `{{NUMBERING}}` — always emit these even if the current variant decides to render nothing. Put `{{DECORATIONS}}` near the top of the z-stack (after `{{BACKGROUND}}`) and `{{NUMBERING}}` wherever your slide counter belongs.
- `{{LOGO}}` on cover / cta patterns (body patterns usually don't need it).

## Commonly used placeholders

### Canvas / grid
| Placeholder | Source |
|---|---|
| `{{WIDTH}}`, `{{HEIGHT}}` | `tokens/grid.js` CANVAS |
| `{{CENTER_X}}`, `{{CENTER_Y}}` | computed |
| `{{COL_1_X}}` … `{{COL_N_X}}` | `tokens/grid.js` COLS |
| `{{ANCHOR_FLAG_TOP}}`, `{{ANCHOR_BODY_TOP}}`, `{{ANCHOR_FOOTER_CENTER}}` | `tokens/grid.js` ANCHORS |
| `{{WIDTH_MINUS_MARGIN}}` | computed from SPACING |

### Color roles
| Placeholder | Source |
|---|---|
| `{{SURFACE}}` / `{{SURFACE_MUTED}}` / `{{ON_SURFACE}}` | `tokens/color-roles.js` |
| `{{ACCENT}}` | brand accent color |
| `{{BG_COLOR}}` | current background fill (for button text etc.) |

### Typography
| Placeholder | Source |
|---|---|
| `{{FONT_DISPLAY_STACK}}`, `{{FONT_BODY_STACK}}` | `tokens/typography.js` fontStack() |
| `{{TYPE_HERO}}`, `{{TYPE_DISPLAY}}`, `{{TYPE_SUBHEAD}}`, `{{TYPE_BODY_LARGE}}`, `{{TYPE_BODY}}`, `{{TYPE_LABEL}}` | `tokens/typography.js` TYPE |
| `{{TITLE_LETTER_SPACING}}`, `{{SUBHEAD_LETTER_SPACING}}` | `tokens/typography.js` letterSpacingForSize |

### Slide content
Whatever keys the pattern declares in `patterns/manifest.json → slots`. Convention: `UPPERCASE_WITH_UNDERSCORES`.

## Steps to add a pattern

### 1. Design the layout

Sketch on paper or in Figma. Remember:
- Canvas: 1080×1350.
- Safe zone: 80–100px from edges (Instagram UI overlays the corners).
- Text readable at phone size: body ≥ 32px, labels ≥ 24px, headlines 56–120px (hero 140–220px).
- Lean on tokens. If you reach for a hardcoded hex or px, check if a token already exists.

### 2. Create `patterns/<id>.svg`

Use `patterns/list-bullet.svg` or `patterns/cover-asymmetric.svg` as the structural reference. Keep it clean:
- No comments inside `<svg>` (they survive substitution and clutter output).
- No hardcoded colors, fonts, or font sizes — use token placeholders.
- No `<script>` (stripped by Instagram regardless).
- Use `&amp;` not `&` in attribute values (SVG is XML).

### 3. Register in `patterns/manifest.json`

Add an entry to the `patterns` array:

```json
{
  "id": "your-pattern-id",
  "role": "body",
  "description": "One sentence. What the pattern shows, what it's for.",
  "slots": ["HEADLINE", "ITEM_1", "ITEM_2"],
  "computedSlots": ["ARROW_1", "ARROW_2"],
  "supportsAxes": ["density", "composition", "accentPlacement", "decorationMix"],
  "template": "your-pattern-id.svg"
}
```

Fields:
- `id` — kebab-case, unique. Used in strategy `pattern` field.
- `role` — `cover`, `body`, or `cta`.
- `description` — one sentence. Seen by Claude when selecting patterns.
- `slots` — content keys the strategy writer provides inside `data`.
- `computedSlots` (optional) — placeholders the renderer fills, not the strategy.
- `supportsAxes` — which variation axes affect this pattern. Valid: `emphasis`, `density`, `composition`, `accentPlacement`, `decorationMix`.
- `template` — filename inside `patterns/` (must match `<id>.svg`).

If the manifest entry is missing, `render-v0.4.mjs` silently ignores the pattern and Claude won't know it exists.

### 4. Add strategy guidance in `prompts/strategy-system.md`

Two sections need updates:

**Pattern selection table (§3)** — add a row:
```
| `your-pattern-id` | body | When to reach for it in one line |
```

**Pattern slot schemas (§4)** — add a subsection with the JSON shape, word/char limits per slot, and a worked example:

```markdown
### `your-pattern-id`
One-line description of what it shows.

\`\`\`json
{
  "pattern": "your-pattern-id",
  "data": {
    "HEADLINE": "…",
    "ITEM_1": "…"
  }
}
\`\`\`

- `HEADLINE` — 2-5 words, ≤ 32 chars.
- `ITEM_1` — 3-8 words, ≤ 52 chars.
```

Without these updates, Claude won't pick your pattern (or worse, picks it with the wrong slot shape).

### 5. Visual test

Create a fixture under `test/fixtures/` that uses the new pattern, then run:

```bash
node scripts/render-v0.4.mjs test/fixtures/brand.json test/fixtures/strategy-<name>.json /tmp/pattern-test/
open /tmp/pattern-test/slide-*.svg
```

Verify:
- No `{{UNFILLED}}` placeholders in output.
- Text doesn't clip or overflow.
- Renders correctly across all 9 background types (try editing the fixture brand's `background.type`).
- Phone-size readable at 100% browser zoom.

Then run the full test suite:

```bash
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
```

## Concrete example: adding a `feature-grid` pattern

Goal: 4 feature boxes in a 2×2 grid. Each box has an icon slot, a label, and a short description.

### Step 1 — create `patterns/feature-grid.svg`

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {{WIDTH}} {{HEIGHT}}" width="{{WIDTH}}" height="{{HEIGHT}}">
  <defs>
    <style>
      {{FONT_IMPORTS}}
      .headline { font-family: {{FONT_DISPLAY_STACK}}; font-weight: 700; font-size: {{TYPE_SUBHEAD}}px; fill: {{ON_SURFACE}}; letter-spacing: {{SUBHEAD_LETTER_SPACING}}; }
      .cell-label { font-family: {{FONT_BODY_STACK}}; font-weight: 600; font-size: {{TYPE_BODY_LARGE}}px; fill: {{ON_SURFACE}}; }
      .cell-desc  { font-family: {{FONT_BODY_STACK}}; font-weight: 400; font-size: {{TYPE_BODY}}px; fill: {{SURFACE_MUTED}}; }
      .divider    { stroke: {{SURFACE_MUTED}}; stroke-width: 1; opacity: 0.35; }
      .handle     { font-family: {{FONT_BODY_STACK}}; font-weight: 500; font-size: 26px; fill: {{SURFACE_MUTED}}; }
    </style>
  </defs>
  {{BACKGROUND}}
  {{DECORATIONS}}
  {{NUMBERING}}
  <text x="{{COL_1_X}}" y="{{ANCHOR_BODY_TOP}}" class="headline">{{HEADLINE}}</text>

  <!-- 2x2 grid dividers, anchored to grid center -->
  <line x1="{{COL_1_X}}" y1="{{GRID_MID_Y}}" x2="{{WIDTH_MINUS_MARGIN}}" y2="{{GRID_MID_Y}}" class="divider"/>
  <line x1="{{CENTER_X}}" y1="{{GRID_TOP_Y}}" x2="{{CENTER_X}}" y2="{{GRID_BOTTOM_Y}}" class="divider"/>

  <!-- Cell 1 (top-left) -->
  <g transform="translate({{COL_1_X}}, {{GRID_TOP_Y}})">
    <g color="{{ACCENT}}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{{ICON_1}}</g>
    <text x="0" y="72" class="cell-label">{{LABEL_1}}</text>
    <text x="0" y="112" class="cell-desc">{{DESC_1}}</text>
  </g>

  <!-- Cells 2-4 follow same shape, offset by CENTER_X / GRID_MID_Y -->

  <text x="{{WIDTH_MINUS_MARGIN}}" y="{{ANCHOR_FOOTER_CENTER}}" class="handle" text-anchor="end">{{BRAND_HANDLE}}</text>
</svg>
```

Notes:
- `{{GRID_MID_Y}}`, `{{GRID_TOP_Y}}`, `{{GRID_BOTTOM_Y}}` would need to be exported from `tokens/grid.js` ANCHORS if not already present. If you add new anchors, extend `tokens/grid.js` first — don't inline magic numbers.
- `{{ICON_N}}` is rendered via the icon library (see `tokens/icon-library.js`) when the strategy supplies an `icon` field on the slide.

### Step 2 — register in `patterns/manifest.json`

```json
{
  "id": "feature-grid",
  "role": "body",
  "description": "Four feature cells in a 2x2 grid. Each cell has an icon, a 1-3 word label, and a 6-12 word description.",
  "slots": [
    "HEADLINE",
    "LABEL_1", "DESC_1",
    "LABEL_2", "DESC_2",
    "LABEL_3", "DESC_3",
    "LABEL_4", "DESC_4",
    "BRAND_HANDLE"
  ],
  "computedSlots": ["ICON_1", "ICON_2", "ICON_3", "ICON_4"],
  "supportsAxes": ["density", "accentPlacement", "decorationMix"],
  "template": "feature-grid.svg"
}
```

### Step 3 — add to `prompts/strategy-system.md`

Selection table (§3):
```
| `feature-grid` | body | 4 parallel features/benefits worth equal weight. Good for feature lists, principles, pillars |
```

Slot schema (§4):

```markdown
### `feature-grid`
Four-cell 2x2 grid. Use when 4 items are parallel in weight and each needs a micro-description (not just a name).

\`\`\`json
{
  "pattern": "feature-grid",
  "data": {
    "HEADLINE": "What ships with every build",
    "LABEL_1": "Type system",
    "DESC_1": "Strict TypeScript, zero any",
    "LABEL_2": "Tests",
    "DESC_2": "Unit + e2e, 80% coverage floor",
    "LABEL_3": "CI/CD",
    "DESC_3": "GitHub Actions, preview deploys",
    "LABEL_4": "Docs",
    "DESC_4": "Autogenerated from JSDoc",
    "BRAND_HANDLE": "@nodeagency"
  }
}
\`\`\`

- `HEADLINE` — 3-6 words, ≤ 32 chars.
- `LABEL_N` — 1-3 words, ≤ 18 chars. Noun phrases, parallel form.
- `DESC_N` — 4-8 words, ≤ 42 chars. Keep parallel grammar across all 4 cells.
```

### Step 4 — visual test

Fixture at `test/fixtures/strategy-feature-grid.json`:

```json
{
  "topic": "What ships with every build",
  "slides": [
    { "pattern": "cover-centered", "data": { "KICKER": "FIELD NOTES", "HEADLINE_LINE_1": "What ships with", "HEADLINE_LINE_2": "every build", "BRAND_HANDLE": "@nodeagency" } },
    { "pattern": "feature-grid",   "data": { "HEADLINE": "Non-negotiables", "LABEL_1": "…", "DESC_1": "…", "LABEL_2": "…", "DESC_2": "…", "LABEL_3": "…", "DESC_3": "…", "LABEL_4": "…", "DESC_4": "…", "BRAND_HANDLE": "@nodeagency" } },
    { "pattern": "cta-stacked",    "data": { "HOOK_LINE_1": "…", "HOOK_LINE_2": "…", "BUTTON": "Talk to us", "SUBTEXT": "…", "BRAND_HANDLE": "@nodeagency" } }
  ]
}
```

Run `render-v0.4.mjs` and eyeball `slide-02.svg`.

## Conventions

- **Placeholder names:** `UPPERCASE_WITH_UNDERSCORES`. No spaces, hyphens, or nested keys.
- **No hardcoded colors/fonts/sizes.** Everything goes through tokens. If you need a value that's not in a token file, add it to the appropriate `tokens/*.js` first, then reference it as `{{TOKEN_NAME}}` in the SVG.
- **Preserve the infrastructure slots.** `{{BACKGROUND}}`, `{{DECORATIONS}}`, `{{NUMBERING}}`, `{{LOGO}}`, `{{FONT_IMPORTS}}` must be present where appropriate even if a given axis decides to render them empty.
- **Typography ranges** (from `tokens/typography.js`): hero 140–220px, display 96–130px, subhead 56–80px, body-large 38–48px, body 30–36px, label 22–28px.
- **Margin:** 80–100px from canvas edges for critical content.

## Footguns

- **SVG is XML.** `&` → `&amp;`, `<` → `&lt;` inside text content. The renderer XML-escapes `data` values automatically, but hand-written CSS/defs/labels in your pattern file must be XML-safe.
- **Missing manifest entry.** If a pattern file exists in `patterns/` but isn't in `manifest.json`, the renderer never loads it and Claude never picks it — silent failure.
- **Hardcoded values.** These break visual consistency when the brand profile changes. If `render-v0.4.mjs` output looks identical no matter what brand profile you feed it, you probably hardcoded colors or fonts.
- **Unused `computedSlots`.** If you declare a computed slot in the manifest but the renderer doesn't know how to fill it, you'll ship `{{SLOT_NAME}}` literals in output. Either fill it in `render-v0.4.mjs` or drop it from the manifest.
- **Fonts take time to load.** Any weight you use must be listed in `{{FONT_IMPORTS}}` (the renderer includes a fixed set). If you need a new weight, extend the font-import builder in `scripts/shared-render.mjs` rather than forcing it per-pattern.

## PR checklist

- [ ] `patterns/<id>.svg` exists and uses only token placeholders (no hardcoded hex/px/font-family).
- [ ] `patterns/manifest.json` has an entry with `id`, `role`, `description`, `slots`, `supportsAxes`, `template`.
- [ ] `prompts/strategy-system.md` §3 (selection table) + §4 (slot schema with worked example) updated.
- [ ] Test fixture renders cleanly across multiple background types (no unfilled placeholders, no clipped text).
- [ ] `node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs` still passes.
- [ ] Phone-size visual check at 100% zoom.
