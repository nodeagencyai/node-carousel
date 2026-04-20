# Adding a New Template

This guide covers adding a new slide template to node-carousel. Examples: `timeline`, `comparison`, `checklist`, `cover-image`, etc.

## How templates work

Every slide template is an SVG file in `templates/` with `{{PLACEHOLDERS}}` that `scripts/render.mjs` fills from:
1. Computed layout values (width, height, center positions) — automatic
2. Brand profile values (colors, fonts, handle) — automatic
3. Slide-specific content — comes from the `data` object in `strategy.json`

The render script does two passes:
1. Fills the selected background snippet (`_background-solid.svg` / `_background-gradient.svg` / `_background-image.svg`)
2. Injects that into the main template's `{{BACKGROUND}}` slot, then fills all remaining placeholders

## Required placeholders

Every template MUST include:
- `viewBox="0 0 {{WIDTH}} {{HEIGHT}}"` and `width="{{WIDTH}}" height="{{HEIGHT}}"` on the root `<svg>`
- `{{BACKGROUND}}` somewhere inside the `<svg>` — the render script injects the filled background snippet here
- The Google Fonts `@import` in a `<style>` block at the top:
  ```xml
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family={{FONT_DISPLAY_URL}}:wght@700;800&amp;family={{FONT_BODY_URL}}:wght@400;500&amp;display=swap');
      /* your template's classes here */
    </style>
  </defs>
  ```
  Note `&amp;` not `&` (SVG is XML).

## Available placeholders

### Layout (computed from `brand.visual.dimensions`)
| Placeholder | Meaning |
|---|---|
| `{{WIDTH}}` | canvas width |
| `{{HEIGHT}}` | canvas height |
| `{{CENTER_X}}` | `Math.round(width / 2)` |
| `{{CENTER_Y}}` | `Math.round(height / 2)` |
| `{{CENTER_Y_MINUS_120}}` | `CENTER_Y - 120` |
| `{{CENTER_Y_PLUS_60}}` | `CENTER_Y + 60` |
| `{{CENTER_Y_PLUS_140}}` | `CENTER_Y + 140` |
| `{{BOTTOM_Y}}` | `height - 100` |
| `{{BOTTOM_Y_MINUS_40}}` | `height - 140` |
| `{{WIDTH_MINUS_100}}` | `width - 100` |
| `{{CTA_HOOK_Y}}`, `{{BUTTON_X}}`, `{{BUTTON_Y}}`, `{{BUTTON_WIDTH}}`, `{{BUTTON_TEXT_Y}}`, `{{CTA_SUBTEXT_Y}}` | CTA-specific positions |

### Brand
| Placeholder | Source |
|---|---|
| `{{BRAND_NAME}}` | `brand.brand.name` |
| `{{BRAND_HANDLE}}` | `brand.brand.handle` |
| `{{COLOR_TEXT}}` | `brand.visual.colors.text` |
| `{{COLOR_ACCENT}}` | `brand.visual.colors.accent` |
| `{{COLOR_MUTED}}` | `brand.visual.colors.muted` |
| `{{FONT_DISPLAY}}` | `brand.visual.fonts.display` (for `font-family`) |
| `{{FONT_DISPLAY_URL}}` | URL-safe variant (for `@import`) |
| `{{FONT_BODY}}`, `{{FONT_BODY_URL}}` | same pattern |
| `{{BG_COLOR}}` | solid/overlay color (useful for CTA button text against accent fill) |

### Slide meta
| Placeholder | Meaning |
|---|---|
| `{{SLIDE_NUMBER}}` | current slide (1, 2, 3…) |
| `{{SLIDE_TOTAL}}` | total slides |

### Slide content
Whatever keys are in the slide's `data` object in `strategy.json`. Convention: UPPERCASE_WITH_UNDERSCORES.

## Steps to add a template

### 1. Design the template

Start by sketching the layout on paper or in Figma. Remember:
- Safe zone: keep critical content 80–100px from edges (Instagram overlays)
- 1080×1350 is the default canvas — layouts should work at that ratio
- Text under 32px is hard to read on phones; under 28px for body copy is too small

### 2. Write the SVG

Save as `templates/<name>.svg`. Use the existing templates as reference — especially `title.svg` and `bullet.svg`.

Keep it clean:
- No comments in the template (they survive substitution and clutter output)
- No hardcoded values that should be brand-driven (colors, fonts)
- No slide counters on slide-1 templates (hook shouldn't compete with a `01 / 07` label)

### 3. Document placeholders in the template's content-key list

In your PR description (or ideally at the top of the template as an SVG comment), list the `data` keys your template expects:

```
<!-- Template expects:
  - HEADLINE (string, 3-6 words)
  - SUBHEAD (string, 8-12 words, optional)
  - ITEM_1 through ITEM_4 (step labels)
  - ITEM_1_YEAR through ITEM_4_YEAR (4-char years)
-->
```

### 4. Update `prompts/strategy-system.md`

Add your template to two sections:

**Template selection rules:**
```
- `timeline` — use when showing 3-5 chronological events with years/dates
```

**Placeholder map:**
```
### `timeline`
\`\`\`json
{
  "HEADLINE": "The slide's heading",
  "ITEM_1": "First event",
  "ITEM_1_YEAR": "2019",
  ...
}
\`\`\`
```

Without this update, Claude won't know when to pick your template.

### 5. Add a worked example

Include at least one worked example in the strategy prompt (or in `examples/`) that uses your template. This helps Claude understand when and how to use it.

### 6. Visual test

Create a fixture `test/fixtures/strategy-<name>.json` that exercises your template with representative content. Run:

```bash
node scripts/render.mjs test/fixtures/brand.json test/fixtures/strategy-<name>.json /tmp/tpl-test/
open /tmp/tpl-test/slide-01.svg
```

Verify:
- No `{{UNFILLED}}` placeholders in output
- Text doesn't clip or overflow
- Works with the 3 background types (try editing the fixture's brand to switch `background.type`)
- Readable on a phone (zoom to 100% in browser and eyeball it)

### 7. Update README

Add your template to the **Templates** section table in `README.md` with a one-line description.

## Conventions

- **Placeholder names:** `UPPERCASE_WITH_UNDERSCORES`. Don't use spaces, hyphens, or nesting.
- **Fonts:** use `{{FONT_DISPLAY}}` for display, `{{FONT_BODY}}` for body — don't hardcode family names.
- **Colors:** use the brand color placeholders — don't hardcode hex values in templates.
- **Text sizes:**
  - Headlines: 56–120px (depends on slide type)
  - Body: 32–42px
  - Labels/counters: 22–30px
  - Stat values: 220–280px
- **Margins/padding:** 80–100px from canvas edges for critical content.

## Footguns

- **SVG is XML.** Any `&` in attribute values or CSS must be `&amp;`. `<` in text content needs `&lt;`. `render.mjs` escapes slide-data values automatically, but your template's hand-written content (CSS, defs, fixed labels) must be XML-safe.
- **`@import` needs `&amp;` inside the URL.** Google Fonts URLs use `&family=` — in SVG this must be `&amp;family=`.
- **No JavaScript in templates.** SVG `<script>` tags are stripped by Instagram. Keep it declarative.
- **Fonts take time to load.** If your template uses a font weight that isn't in the `@import` line, browsers fall back silently. Always list every weight you use.
- **Colors are case-sensitive in some renderers.** Always use uppercase hex (`#FFFFFF` not `#ffffff`) — matches what `brand-profile.json` uses.

## PR checklist

Before opening a PR:

- [ ] Template renders cleanly with all 3 background types
- [ ] No unfilled `{{PLACEHOLDERS}}` in test output
- [ ] `prompts/strategy-system.md` updated with selection rule + placeholder map
- [ ] At least one worked example uses the new template
- [ ] README's template table updated
- [ ] Test fixture checked in at `test/fixtures/strategy-<name>.json`
- [ ] Phone-size visual check passed (100% zoom in browser)
