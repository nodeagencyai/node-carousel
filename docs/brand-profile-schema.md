# brand-profile.json Schema

Every node-carousel project has a `brand-profile.json` at its root. Commands read this file to determine colors, fonts, typography, and dimensions. Created by `/node-carousel:setup`.

## Full example (v0.2 — all features)

```json
{
  "brand": {
    "name": "Node",
    "handle": "@nodeagency",
    "tone": "direct, confident, no fluff"
  },
  "visual": {
    "colors": {
      "background": "#0f0f0f",
      "text": "#FFFFFF",
      "accent": "#29F2FE",
      "accentSecondary": "#0B8AEE",
      "muted": "#999999"
    },
    "fonts": {
      "display": "Instrument Serif",
      "body": "Inter"
    },
    "background": {
      "type": "mesh",
      "color": "#0f0f0f",
      "gradient": { "from": "#0f0f0f", "to": "#29F2FE", "angle": 135 },
      "mesh": {
        "blobs": [
          { "cx": "20%", "cy": "30%", "r": "45%", "color": "#29F2FE", "opacity": 0.35 },
          { "cx": "80%", "cy": "70%", "r": "55%", "color": "#0B8AEE", "opacity": 0.4 },
          { "cx": "50%", "cy": "50%", "r": "35%", "color": "#6B3FA0", "opacity": 0.25 }
        ]
      },
      "radial": { "center": "50% 30%", "from": "#29F2FE", "to": "#0f0f0f", "stops": [0.2, 0.8] },
      "imagePath": null,
      "grain": { "enabled": true, "intensity": 0.12, "baseFrequency": 0.9 }
    },
    "numbering": { "style": "fraction-mono", "position": "bottom-right" },
    "decorations": {
      "cornerMarks": false,
      "accentRule": true,
      "numberBadges": false,
      "pullQuoteBlock": false,
      "oversizedMark": false
    },
    "dimensions": { "width": 1080, "height": 1350 }
  }
}
```

## Fields

### `brand` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | string | yes | — | Brand display name. Appears on some slide templates. |
| `handle` | string | yes | — | Social handle (with `@`). Appears on `title` and `cta` slides. |
| `tone` | string | yes | — | Free-form voice description (e.g. `"direct, builder-voice, no fluff"`). The strategy prompt uses this to match copy voice. |

### `visual.colors` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `background` | hex string | yes | `#0f0f0f` | Slide background fill when `background.type === "solid"`. |
| `text` | hex string | yes | `#FFFFFF` | Primary text color. |
| `accent` | hex string | yes | `#29F2FE` | Brand accent (used on stat numbers, CTA buttons, gradient starts). |
| `accentSecondary` | hex string | no | `#0B8AEE` | Secondary accent (used for gradient ends). Falls back to `accent` if omitted. |
| `muted` | hex string | yes | `#999999` | Secondary/muted text (captions, attributions, slide counters). |

### `visual.fonts` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `display` | string | yes | `Playfair Display` | Font family for headlines and large text. Must be a valid [Google Fonts](https://fonts.google.com) family name — fetched via `@import` in SVG. |
| `body` | string | yes | `Inter` | Font family for body text, bullets, and supporting copy. Must be a valid Google Fonts family name. |

Custom (non-Google) fonts are not supported in v0.2. Use web-safe fallbacks or pick the closest Google Fonts match.

### `visual.background` (object, required)

Controls how the slide background renders.

#### `background.type`

| Value | What it does |
|---|---|
| `"solid"` | Single flat color from `background.color`. Baseline, clean. |
| `"gradient"` | Linear gradient between `gradient.from` and `gradient.to` at `gradient.angle`. |
| `"mesh"` | 3–5 blurred circle "blobs" over a base color. Modern/soft feel (Stripe, Vercel, Framer). Configured via `background.mesh.blobs`. |
| `"radial"` | Radial gradient from `radial.center` (Apple keynote vignette feel). |
| `"image"` | Background image from `imagePath` with automatic dark overlay for readability. |
| `"dot-grid"` | Subtle SVG pattern of spaced dots over base color. Raycast / Stripe docs aesthetic. v0.4.1+. |
| `"geometric-shapes"` | 3–5 floating circles at low opacity for compositional rhythm. v0.4.1+. |
| `"glow-sphere"` | Radial gradient with off-canvas origin (e.g. `cy: -20%`) producing a half-glow. Apple-keynote hero vignette. v0.4.1+. |

#### Core fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | enum (above) | yes | `"solid"` | Which background mode to use. |
| `color` | hex string | required when `type === "solid"` or `"mesh"` (base layer) | `#0f0f0f` | Base fill. For `mesh` type, this is the base color under the blobs. |
| `imagePath` | string \| null | required when `type === "image"` | `null` | Path to PNG/JPG. Relative to project root or absolute. Rendered with `xMidYMid slice` (cover). |

#### `background.gradient` (used when `type === "gradient"`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `gradient.from` | hex string | — | Start color of gradient. |
| `gradient.to` | hex string | — | End color of gradient. |
| `gradient.angle` | number | `135` | Angle in degrees. `0` = left-to-right, `90` = top-to-bottom, `135` = diagonal. |

#### `background.mesh` (used when `type === "mesh"`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `mesh.blobs` | array | — | 1–5 blob objects. More than 5 are ignored. Each blob blurs heavily (120px stdDeviation) so edges dissolve into the base. |
| `mesh.blobs[n].cx` / `cy` | string | — | Position as percentage string (e.g. `"20%"`) OR pixel number. SVG viewBox-relative. |
| `mesh.blobs[n].r` | string | — | Radius as percentage string OR pixel number. |
| `mesh.blobs[n].color` | hex string | — | Blob fill color. |
| `mesh.blobs[n].opacity` | number 0–1 | `0.35` | Blob opacity before blur. Lower = subtler. |

#### `background.radial` (used when `type === "radial"`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `radial.center` | string | `"50% 50%"` | Center of radial gradient in `"X% Y%"` format. |
| `radial.from` | hex string | — | Color at center (stop 1). |
| `radial.to` | hex string | — | Color at edge (stop 2). |
| `radial.stops` | `[number, number]` | `[0, 1]` | Offset of each stop (0 = center, 1 = edge). `[0.2, 0.8]` creates a softer falloff. |

#### `background.dotGrid` (used when `type === "dot-grid"`) — v0.4.1+

Renders a dot pattern over the base color via SVG `<pattern>`. All fields optional — safe defaults ship a subtle accent-colored grid.

| Field | Type | Default | Notes |
|---|---|---|---|
| `dotGrid.spacing` | number | `40` | Pixel distance between dot centers. Smaller = denser grid. |
| `dotGrid.dotSize` | number | `1.5` | Circle radius in pixels. `1` = pixel-dot, `3` = tactile. |
| `dotGrid.dotColor` | hex string | `visual.colors.accent` | Dot fill color. |
| `dotGrid.opacity` | number 0–1 | `0.25` | Dot opacity. `0.1` = barely-there, `0.4` = prominent. |

#### `background.shapes` (used when `type === "geometric-shapes"`) — v0.4.1+

Array of 3–5 abstract shape objects (currently circles only — lines/rects are v0.5 scope). Shapes render at low opacity so they add rhythm without competing with text. Positions are author-specified — no randomness.

| Field | Type | Default | Notes |
|---|---|---|---|
| `shapes[n].type` | string | `"circle"` | Currently only `"circle"` supported. Future: `"line"`, `"rect"`. |
| `shapes[n].cx` / `cy` | number | — | Center in canvas pixels. 1080×1350 default canvas. |
| `shapes[n].r` | number | — | Radius in pixels. |
| `shapes[n].fill` | hex string or `"none"` | `"none"` | Fill color. Use `"none"` for outline-only shapes. |
| `shapes[n].stroke` | hex string or `"none"` | `"none"` | Stroke color. |
| `shapes[n].strokeWidth` | number | `0` | Stroke width in px. Set > 0 for outline shapes. |
| `shapes[n].opacity` | number 0–1 | `0.4` | Per-shape opacity. Keep low (`0.15`–`0.5`) so text stays readable. |

Unused slots (fewer than 5 shapes) render at `r=0, opacity=0` — invisible.

#### `background.glow` (used when `type === "glow-sphere"`) — v0.4.1+

Radial gradient over base color. Differs from `radial` in that the gradient **origin can sit outside the canvas** (e.g. `cy: "-20%"`), producing a partial / half-glow effect rather than a full centered vignette.

| Field | Type | Default | Notes |
|---|---|---|---|
| `glow.cx` | string | `"50%"` | Horizontal center of glow (as viewBox percentage or pixel string). |
| `glow.cy` | string | `"-20%"` | Vertical center. Use negative values (e.g. `"-20%"`) to place origin off-canvas top — you only see the bottom half of the glow. |
| `glow.r` | string | `"80%"` | Gradient radius. Larger = softer falloff across the canvas. |
| `glow.from` | hex string | `visual.colors.accent` | Color at gradient center. |
| `glow.to` | hex string | `background.color` | Color at gradient edge (fades to 0 alpha). Usually matches base. |
| `glow.opacity` | number 0–1 | `0.5` | Intensity at center. Keep ≤ `0.6` to avoid washing out text. |

#### `background.grain` (optional — works on ALL background types)

Film-grain texture overlay. Single biggest premium upgrade. Works on any `type` by adding a noise layer on top.

| Field | Type | Default | Notes |
|---|---|---|---|
| `grain.enabled` | boolean | `false` | Turn grain on/off. |
| `grain.intensity` | number 0–1 | `0.12` | Opacity of the grain overlay. `0.05` = barely visible, `0.15` = obviously textured. Stay under `0.2` or text becomes hard to read. |
| `grain.baseFrequency` | number 0.3–2.0 | `0.9` | Frequency of `feTurbulence`. Higher = finer grain. `0.6` = chunky film grain, `1.2` = tight digital noise. |

### `visual.numbering` (object, optional)

Slide counter style on mid-deck slides (not shown on title or CTA slides).

| Field | Type | Default | Notes |
|---|---|---|---|
| `numbering.style` | `"fraction-mono"` \| `"dot"` \| `"bar"` \| `"none"` | `"fraction-mono"` | Visual style. |
| `numbering.position` | `"bottom-right"` \| `"bottom-center"` \| `"top-right"` | `"bottom-right"` | Where on the slide the counter appears (applies to `fraction-mono` only; `dot` is always bottom-center, `bar` spans the width). |

Visual descriptions:
- **`fraction-mono`** — `03 / 08` in monospace, small, muted. The 2026-premium default.
- **`dot`** — Filled + outlined dots centered at the bottom, one per slide. Current slide filled in accent color. Nice for short decks.
- **`bar`** — Thin progress bar across the bottom. Accent-colored portion fills as deck progresses.
- **`none`** — No counter. Intentional choice when slides should feel standalone.

### `visual.decorations` (object, optional — v0.3+)

Optional decorative elements layered above the background but below text content. Each field is a boolean — set to `true` to enable the decoration on every mid-deck slide that uses it. Missing field or missing `decorations` block entirely → all decorations default to `false` (backward-compatible with v0.1/v0.2 brand profiles).

| Field | Type | Default | Description | When to use |
|---|---|---|---|---|
| `cornerMarks` | boolean | `false` | Four small `L`-shaped brackets at each corner of the canvas (40px arms, 3px stroke, accent color, 60px inset). | Technical, utility, "bracketed screenshot" aesthetic — pairs well with mono fonts. |
| `accentRule` | boolean | `false` | Short horizontal line (120×3px) below the kicker at y=210. Subtle editorial emphasis mark. | Editorial, magazine-style decks. The original title-asymmetric inline rule, extracted as a reusable decoration. |
| `numberBadges` | boolean | `false` | Oversized slide number top-right as a low-opacity (0.18) watermark in accent color. 180px display font. | Numbered-sequence content ("5 lessons", "10 steps") where big numerals reinforce the ordinal nature. |
| `pullQuoteBlock` | boolean | `false` | Colored rectangle (accent color, 15% opacity) behind a phrase at y=880–944 with text at y=920. Requires per-slide `PULL_QUOTE_TEXT` for the text content. | Drawing the eye to a highlighted quote or key phrase on a bullet/stat slide. |
| `oversizedMark` | boolean | `false` | Huge decorative punctuation (420px font, 15% opacity accent) top-right as visual anchor. Default char is `"`; override via slideData `OVERSIZED_MARK_CHAR`. | Display-serif brands (DM Serif Display, Playfair) where large punctuation reads as expressive typography rather than literal punctuation. |

**Per-slide overrides.** `slideData.decorations` on any slide in `strategy.json` overrides the brand default for that slide:
- Array form — `"decorations": ["cornerMarks", "pullQuoteBlock"]` — enables exactly those decorations, all others disabled.
- Object form — `"decorations": { "pullQuoteBlock": true }` — overlays fields on top of brand defaults.

**Pull-quote layout values** — overridable per-slide in `slideData`:
- `PULL_QUOTE_TEXT` — the phrase (required when `pullQuoteBlock: true`; otherwise empty).
- `PULL_QUOTE_Y_OFFSET` — top of rect (default `880`).
- `PULL_QUOTE_Y` — baseline of text inside rect (default `920`).
- `PULL_QUOTE_WIDTH` — rect width (default `600`).

**Oversized mark** — `OVERSIZED_MARK_CHAR` in slideData overrides the default `"` (double-quote). Try `!`, `?`, or `#` for topic-matched variants.

**Pull-quote block gating.** When `pullQuoteBlock` is enabled but the slide does not provide a `PULL_QUOTE_TEXT`, the decoration is skipped for that slide (no empty rect artifact). Enable it at the brand level and sprinkle `PULL_QUOTE_TEXT` onto specific slides that should carry the highlight.

**Note on `title-asymmetric`.** The `title-asymmetric.svg` template has an always-on accent rule inline under the kicker (baked into the template, not the decoration system). Turning `accentRule: true` in decorations only adds the line to other templates (bullet, stat, quote, cta) — on title-asymmetric you will get the inline rule either way. This is intentional: the inline rule predates the decoration system and is preserved for backward compatibility with v0.2 brand profiles.

### `visual.dimensions` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `width` | number | yes | `1080` | Slide width in pixels. |
| `height` | number | yes | `1350` | Slide height in pixels. |

**Default dimensions are `1080 × 1350`** — Instagram's 4:5 portrait ratio, the highest-engagement feed format. Templates in v0.2 are optimized for this ratio. Other dimensions render but may produce layout issues (a warning prints once per render run).

## Validation

The `render.mjs` script runs shape validation at render time via `validateBrand()`. Missing required fields raise clear errors like:
```
Invalid brand-profile.json: missing required field "visual.dimensions.width" (expected number).
```

See `templates/brand-profile.default.json` for a complete valid example with all v0.2 fields populated.

## Backward compatibility (v0.1 → v0.2 → v0.3)

All post-v0.1 additions are optional. A v0.1 brand profile with just `solid`/`gradient`/`image` backgrounds, no `grain`, no `numbering`, and no `decorations` renders identically in v0.3.

- Missing `grain`? → treated as `{ enabled: false }`
- Missing `numbering`? → defaults to `{ style: "fraction-mono", position: "bottom-right" }`
- Missing `mesh` / `radial`? → only used when `type` points to them
- Missing `decorations`? → treated as all `false` — no decoration rendered (v0.1/v0.2 behaviour preserved)

## Presets (setup wizard)

The `/node-carousel:setup` wizard starts from one of 5 aesthetic presets, then overlays your brand identity. Preset choice drives font pairing, color palette, background style, and grain defaults. See `prompts/setup-presets.md` for the preset library.
