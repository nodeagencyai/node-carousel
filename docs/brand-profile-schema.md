# brand-profile.json Schema

Every node-carousel project has a `brand-profile.json` at its root. Commands read this file to determine colors, fonts, typography, background, noise, decorations, logo, numbering, and dimensions. Created by `/node-carousel:setup`.

## Full example (v0.4 — all features)

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
      "type": "noise-gradient",
      "color": "#0f0f0f",
      "gradient": { "from": "#0f0f0f", "to": "#29F2FE", "angle": 135 },
      "mesh": {
        "blobs": [
          { "cx": "20%", "cy": "30%", "r": "45%", "color": "#29F2FE", "opacity": 0.35 },
          { "cx": "80%", "cy": "70%", "r": "55%", "color": "#0B8AEE", "opacity": 0.4 }
        ]
      },
      "radial": { "center": "50% 30%", "from": "#29F2FE", "to": "#0f0f0f", "stops": [0.2, 0.8] },
      "imagePath": null,
      "dotGrid": { "spacing": 40, "dotSize": 1.5, "dotColor": "#29F2FE", "opacity": 0.25 },
      "shapes": [
        { "type": "circle", "cx": 200, "cy": 300, "r": 180, "fill": "none", "stroke": "#29F2FE", "strokeWidth": 2, "opacity": 0.25 }
      ],
      "glow": { "cx": "50%", "cy": "-20%", "r": "80%", "from": "#29F2FE", "to": "#0f0f0f", "opacity": 0.5 },
      "noiseGradient": { "from": "#0f0f0f", "to": "#1a2a3e", "angle": 135, "noiseType": "organic", "noiseIntensity": 0.2 },
      "noise": { "enabled": true, "type": "film", "intensity": 0.08, "scale": 1.0 }
    },
    "numbering": { "style": "fraction-mono", "position": "bottom-right" },
    "decorations": {
      "cornerMarks": false,
      "accentRule": true,
      "numberBadges": false,
      "pullQuoteBlock": false,
      "oversizedMark": false
    },
    "logo": { "file": "./assets/logo.svg", "position": "top-left", "size": 48 },
    "dimensions": { "width": 1080, "height": 1350 }
  }
}
```

## Fields

### `brand` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | string | yes | — | Brand display name. Appears on some slide patterns. |
| `handle` | string | yes | — | Social handle (with `@`). Appears on cover + CTA patterns. Also feeds the determinism seed. |
| `tone` | string | yes | — | Free-form voice description (e.g. `"direct, builder-voice, no fluff"`). The strategy prompt uses this to match copy voice. |

### `visual.colors` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `background` | hex string | yes | `#0f0f0f` | Slide background fill when `background.type === "solid"`. |
| `text` | hex string | yes | `#FFFFFF` | Primary text color. |
| `accent` | hex string | yes | `#29F2FE` | Brand accent (used on stat numbers, CTA buttons, gradient starts, icon strokes). |
| `accentSecondary` | hex string | no | `#0B8AEE` | Secondary accent (used for gradient ends, split-comparison right column, two-tone decorations). Falls back to `accent` if omitted. |
| `muted` | hex string | yes | `#999999` | Secondary/muted text (captions, attributions, slide counters). |

### `visual.fonts` (object, required)

Both `display` and `body` accept two forms: a legacy string (Google Fonts / Fontshare family name) or an object (v0.7.1+ self-hosted).

#### String form (legacy, Google Fonts)

```json
"display": "Inter"
```

Renderer emits `@import url('https://fonts.googleapis.com/css2?family=Inter')`. Only works for families available on [Google Fonts](https://fonts.google.com) or [Fontshare](https://fontshare.com) (for `Satoshi` in the `satoshi-tech` preset).

#### Object form (v0.7.1+, self-hosted)

```json
"display": {
  "family": "Gilroy",
  "file": "./brand-fonts/Gilroy-Bold.woff2",
  "weight": 700,
  "style": "normal"
}
```

Renderer base64-embeds the font file as `@font-face` data URI inside the SVG. Makes output portable and self-contained (no external font loading at view-time).

Fields:
- `family` (required): CSS font-family name used in text elements.
- `file` (required for object form): relative or absolute path to font file; relative paths resolve from the `brand-profile.json`'s directory (NOT CWD). When `file` is `null`, the renderer falls back to the Google Fonts `@import` using `family` as the lookup name — which fails cleanly for truly unknown fonts but at least surfaces the error.
- `weight` (optional, default `400` for body / `700` for display): CSS font-weight. Must match the font file's actual weight.
- `style` (optional, default `"normal"`): `"normal"` or `"italic"`.

Supported file formats: `.woff2` (recommended), `.woff`, `.ttf`, `.otf`. Other extensions are rejected.

Max file size: **500 KB** (rejected above this). Warns at **250 KB**. Larger files bloat every slide SVG.

Licensing: users are responsible for font-license compliance. The plugin embeds what you provide — verify your font's license allows embedding in distributed documents before shipping carousels.

See `docs/custom-fonts.md` for the full walkthrough.

### `visual.background` (object, required)

Controls how the slide background renders. Must specify `type`; each type has its own sub-config block.

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
| `"glow-sphere"` | Radial gradient with off-canvas origin producing a half-glow. Apple-keynote hero vignette. v0.4.1+. |
| `"noise-gradient"` | Linear gradient with noise texture baked in via `mix-blend-mode: multiply`. Premium dark-aesthetic default. v0.4.3+. |

#### Core fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | enum (above) | yes | `"solid"` | Which background mode to use. |
| `color` | hex string | required when `type === "solid"` or `"mesh"` (base layer) | `#0f0f0f` | Base fill. For `mesh`, `dot-grid`, `glow-sphere`, and `noise-gradient` types, this is the base color under the overlay. |
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
| `mesh.blobs[n].cx` / `cy` | string \| number | — | Position as percentage string (e.g. `"20%"`) OR pixel number. SVG viewBox-relative. |
| `mesh.blobs[n].r` | string \| number | — | Radius as percentage string OR pixel number. |
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

#### `background.noiseGradient` (used when `type === "noise-gradient"`) — v0.4.3+

Linear gradient with a noise texture baked in via `mix-blend-mode: multiply`. Different from stacking `gradient` + `noise` overlay: the noise shares the gradient's hue range instead of sitting as a separate black-grain layer on top. Produces the "premium dark editorial" look (Linear, Vercel, newer Stripe marketing).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `noiseGradient.from` | hex string | yes | — | Gradient start color. |
| `noiseGradient.to` | hex string | yes | — | Gradient end color. |
| `noiseGradient.angle` | number | no | `135` | Gradient angle in degrees. |
| `noiseGradient.noiseType` | enum (see below) | no | `"organic"` | Which of the 6 noise texture families to bake into the gradient. |
| `noiseGradient.noiseIntensity` | number 0–1 | no | `0.18` | Opacity of the noise layer inside the gradient. Keep ≤ `0.25` — higher makes text harder to read. |

#### `background.noise` (optional — works on ALL background types) — v0.4.3+

Noise / grain texture overlay on top of any background type. Replaces the v0.4.2 `grain` block with a richer 6-texture vocabulary. Both blocks are still accepted — `grain` is auto-mapped to `noise.type = "film"` for backward compatibility.

| Field | Type | Default | Notes |
|---|---|---|---|
| `noise.enabled` | boolean | `false` | Turn noise on/off. |
| `noise.type` | enum | `"film"` | One of: `"film"` (classic fractal grain), `"static"` (coarse TV turbulence), `"organic"` (soft cloudy fractal), `"grit"` (tight digital fractal), `"ink-wash"` (blurred painterly fractal), `"dither"` (1-bit pixelation via discrete transfer). |
| `noise.intensity` | number 0–1 | `0.12` | Opacity of the noise overlay. `0.05` = barely visible, `0.15` = obviously textured. Stay under `0.2` or text becomes hard to read. |
| `noise.scale` | number > 0 | `1.0` | Multiplier on the noise type's base `baseFrequency`. Higher = finer/tighter grain, lower = chunkier. `1.0` = neutral. |

#### `background.grain` (legacy — v0.3/v0.4.2 alias for `noise.type = "film"`)

Accepted for backward compatibility. If present and `noise` is not set, it is auto-converted to `{ enabled: true, type: "film", intensity: grain.intensity, scale: grain.baseFrequency / 0.9 }`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `grain.enabled` | boolean | `false` | Legacy enable flag. |
| `grain.intensity` | number 0–1 | `0.12` | Legacy opacity. |
| `grain.baseFrequency` | number 0.3–2.0 | `0.9` | Legacy turbulence frequency. |

New profiles should use `noise` instead.

### `visual.numbering` (object, optional)

Slide counter style on mid-deck slides (not shown on cover or CTA slides).

| Field | Type | Default | Notes |
|---|---|---|---|
| `numbering.style` | `"fraction-mono"` \| `"dot"` \| `"bar"` \| `"none"` | `"fraction-mono"` | Visual style. |
| `numbering.position` | `"bottom-right"` \| `"bottom-center"` \| `"top-right"` | `"bottom-right"` | Where on the slide the counter appears (applies to `fraction-mono` only; `dot` is always bottom-center, `bar` spans the width). |

Visual descriptions:
- **`fraction-mono`** — `03 / 08` in monospace, small, muted. The v0.4 premium default.
- **`dot`** — Filled + outlined dots centered at the bottom, one per slide. Current slide filled in accent color. Nice for short decks.
- **`bar`** — Thin progress bar across the bottom. Accent-colored portion fills as deck progresses.
- **`none`** — No counter. Intentional choice when slides should feel standalone.

### `visual.decorations` (object, optional — v0.3+)

Optional decorative elements layered above the background but below text content. Each field is a boolean — set to `true` to enable the decoration on every mid-deck slide that uses it. Missing field or missing `decorations` block entirely → all decorations default to `false` (backward-compatible with v0.1/v0.2 brand profiles).

| Field | Type | Default | Description | When to use |
|---|---|---|---|---|
| `cornerMarks` | boolean | `false` | Four small `L`-shaped brackets at each corner of the canvas (40px arms, 3px stroke, accent color, 60px inset). | Technical, utility, "bracketed screenshot" aesthetic — pairs well with mono fonts. |
| `accentRule` | boolean | `false` | Short horizontal line (120×3px) below the kicker at y=210. Subtle editorial emphasis mark. | Editorial, magazine-style decks. |
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

### `visual.logo` (object, optional — v0.4.2+)

Brand-wide logo rendered on cover + CTA patterns (`cover-asymmetric`, `cover-centered`, `cta-stacked`). Body patterns (list, stat, quote, split) intentionally skip the logo — they're too busy visually.

Missing field or missing `logo.file` → no logo rendered (backward compatible with v0.4.1 brand profiles).

| Field | Type | Default | Notes |
|---|---|---|---|
| `logo.file` | string | — | Path to an SVG file, resolved relative to the `strategy.json` directory (not the plugin install dir). File must be a 24×24 viewBox SVG using `stroke="currentColor"`. Passes the same safe-bounds validation as icons — no `<script>`, no hardcoded hex, ≤ 8KB. |
| `logo.position` | `"top-left"` \| `"top-right"` \| `"bottom-left"` \| `"bottom-right"` | `"top-left"` | Which corner. 72px inset from both edges (matches cover-asymmetric kicker inset). |
| `logo.size` | number | `48` | Logo height/width in pixels. Source SVG is assumed to use a 24×24 viewBox (Lucide convention) — scale factor is `size / 24`. |

Logo color defaults to `visual.colors.text` (via the `ON_SURFACE` role) so it reads on both light and dark brand surfaces.

**How `visual.logo` gets populated (v0.6+).** The `/node-carousel:scan` command auto-populates this block when it finds a logo on your site, so you usually don't hand-write it.

- `logo.file` — written by the scan's 4-stage extractor: inline `<svg>` in header → `<img>` logo element → `<link rel="icon">` favicon → apple-touch-icon. File lands in the scan output dir (e.g. `scan-logo.svg`, or `favicon.ico` for the favicon fallback). When BrandFetch augmentation is enabled (`BRANDFETCH_API_KEY` set) and returns a higher-fidelity SVG, that URL is preferred over the self-hosted extraction.
- `logo.position` — defaults to `"top-right"` in scan-generated profiles (moves out of the way of the kicker at top-left). Override freely.
- `logo.size` — defaults to `48`. Override freely if the source logo is narrower or wider than a square.

When scan fails to find any logo (rare — the favicon fallback almost always succeeds), the whole `visual.logo` block is omitted and no logo is rendered. You can drop your own SVG in afterwards and set `logo.file` manually.

### `visual.dimensions` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `width` | number | yes | `1080` | Slide width in pixels. |
| `height` | number | yes | `1350` | Slide height in pixels. |

**Default dimensions are `1080 × 1350`** — Instagram's 4:5 portrait ratio, the highest-engagement feed format. Patterns in v0.4 are optimized for this ratio. Other dimensions render but may produce layout issues (a warning prints once per render run).

## Validation

The `render-v0.4.mjs` script runs shape validation at render time via `validateBrand()`. Missing required fields raise clear errors like:
```
Invalid brand-profile.json: missing required field "visual.dimensions.width" (expected number).
```

See `templates/brand-profile.default.json` for a complete valid example with all v0.4 fields populated.

## Backward compatibility (v0.1 → v0.2 → v0.3 → v0.4)

All post-v0.1 additions are optional. A v0.1 brand profile with just `solid`/`gradient`/`image` backgrounds, no `grain`, no `numbering`, and no `decorations` renders identically in v0.4.

- Missing `grain` / `noise`? → treated as no-op (no overlay)
- `grain` present but `noise` absent? → auto-mapped to `noise.type = "film"` with equivalent parameters
- Missing `numbering`? → defaults to `{ style: "fraction-mono", position: "bottom-right" }`
- Missing `mesh` / `radial` / `dotGrid` / `shapes` / `glow` / `noiseGradient`? → only used when `type` points to them
- Missing `decorations`? → treated as all `false` — no decoration rendered (v0.1/v0.2 behaviour preserved)
- Missing `logo` or `logo.file`? → no logo rendered (v0.4.1 behaviour preserved)

## Presets (setup wizard)

The `/node-carousel:setup` wizard starts from one of 6 aesthetic presets, then overlays your brand identity. Preset choice drives font pairing, color palette, background style, and noise defaults. See `templates/presets/*.json` for the preset library (`editorial-serif`, `neo-grotesk`, `technical-mono`, `display-serif-bold`, `utilitarian-bold`, `satoshi-tech`).
