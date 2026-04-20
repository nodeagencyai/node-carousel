# brand-profile.json Schema

Every node-carousel project has a `brand-profile.json` at its root. Commands read this file to determine colors, fonts, typography, and dimensions. Created by `/node-carousel:setup`.

## Full example

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
      "display": "Playfair Display",
      "body": "Inter"
    },
    "background": {
      "type": "solid",
      "color": "#0f0f0f",
      "gradient": {
        "from": "#0f0f0f",
        "to": "#29F2FE",
        "angle": 135
      },
      "imagePath": null
    },
    "dimensions": {
      "width": 1080,
      "height": 1350
    }
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

Custom (non-Google) fonts are not supported in v0.1.0. Use web-safe fallbacks or pick the closest Google Fonts match.

### `visual.background` (object, required)

Controls how the slide background renders.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | `"solid"` \| `"gradient"` \| `"image"` | yes | `"solid"` | Which background mode to use. |
| `color` | hex string | required when `type === "solid"` | `#0f0f0f` | Solid fill color. |
| `gradient` | object | required when `type === "gradient"` | — | See below. |
| `gradient.from` | hex string | yes (when used) | — | Start color of gradient. |
| `gradient.to` | hex string | yes (when used) | — | End color of gradient. |
| `gradient.angle` | number | no | `135` | Gradient angle in degrees. `0` = left-to-right, `90` = top-to-bottom, `135` = diagonal. |
| `imagePath` | string \| null | required when `type === "image"` | `null` | Path to background image file. Relative to project root or absolute. PNG/JPG recommended. Will be scaled with `preserveAspectRatio="xMidYMid slice"` (like CSS `background-size: cover`). |

### `visual.dimensions` (object, required)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `width` | number | yes | `1080` | Slide width in pixels. |
| `height` | number | yes | `1350` | Slide height in pixels. |

**Default dimensions are `1080 × 1350`** — Instagram's 4:5 portrait ratio, the highest-engagement feed format. Other common options:
- `1080 × 1080` — square feed post
- `1080 × 1920` — story / reel cover

## Validation

The `render.mjs` script reads this file as-is. No schema validation happens at runtime. Malformed JSON will surface as a `JSON.parse` error. Missing fields may render empty strings (by design — keeps the render forgiving).

If a template references a color/font that isn't in `brand-profile.json`, it renders empty (e.g. `fill=""`). Check your SVG output in a browser if slides look wrong — missing placeholders are the most common cause.
