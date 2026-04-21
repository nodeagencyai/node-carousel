# Reference Carousel Analysis Prompt

You are analyzing 1-5 reference carousels the user uploaded. Goal: extract
visual patterns so the node-carousel system can match their existing style.

The user has already run `scripts/prepare-references.mjs`, which produced a
`references-manifest.json` listing absolute paths to validated image files.
Read the manifest first, then analyze each file it lists.

## Your process

1. Read the manifest at `<output-dir>/references-manifest.json`. It contains
   a `files` array of absolute paths to PNG/JPG reference carousels.

2. For each file in `files`:
   - Use the `Read` tool to load the PNG/JPG. Claude Code's `Read` is
     multimodal — you will actually see the image.
   - Look at it carefully. Don't skim. Spend attention on composition, type,
     color, and decoration choices.
   - Jot internal observations per reference before you synthesize.

3. Document visually across references:
   - **Composition**: where does the headline live (top/middle/bottom,
     left/center/right)? What layout patterns repeat slide-to-slide? How much
     whitespace? Are covers asymmetric or centered?
   - **Typography**: serif / sans / mono / display? Weight — light, regular,
     bold, heavy? Display sizes — tight, standard, or oversized?
   - **Colors**: what's the palette (rough hex is fine, pixel-precision is
     not required)? Dark mode, light mode, or mixed? How is the accent
     used — single punch, duo, multi-color, or monochrome?
   - **Textures**: film grain present? Gradients? Geometric shapes?
     Illustrations? What's the overall feel — editorial, tech, brutalist,
     soft, playful, clinical?
   - **Decorations**: corner marks, horizontal rules, oversized numbers,
     pull quotes, icons — which of these recur?

4. Synthesize across all references. Where patterns repeat, they're
   INTENTIONAL (part of the user's brand). Where they vary, treat them as
   within a bounded system — note the range in the relevant `notes` field.

## Mapping to v0.4 patterns

The synthesizer consumes your output against v0.4's 8 pattern library. Where
possible, map observed layouts to these names in
`composition.dominantPatterns`:

- Hero slide with large headline bottom-left → `cover-asymmetric`
- Centered hero with lots of air → `cover-centered`
- Number-with-label slide → `stat-dominant`
- Oversized quote → `quote-pulled`
- Split before/after → `split-comparison`
- Bullet list → `list-bullet`
- Numbered list with display numerals → `list-numbered`
- End ask slide → `cta-stacked`

If you see a pattern v0.4 doesn't have yet (e.g. 3-column grid, photo
collage, full-bleed photograph with overlaid text), note it in
`composition.notes` as `new-pattern-candidate:<short-name>` — this can
inform v0.6 pattern expansion.

## Output

Write valid JSON to `<output-dir>/references.json` matching this schema.
Every field is required. Use `notes` fields for nuance the enums can't
capture — the synthesizer reads those too.

```json
{
  "referenceCount": 3,
  "files": [
    "/abs/path/to/user-carousel-1.png",
    "/abs/path/to/user-carousel-2.png"
  ],
  "composition": {
    "dominantPatterns": ["cover-asymmetric", "stat-dominant", "list-bullet"],
    "variety": "high | medium | low",
    "notes": "Covers use huge serif headlines left-aligned; body slides are minimal with one accent color"
  },
  "typography": {
    "displayStyle": "serif | sans | mono | display",
    "displayWeight": "light | regular | bold | heavy",
    "bodyStyle": "sans | serif | mono",
    "scale": "tight | standard | oversized",
    "notes": "Bold serif display (Playfair-like), restrained body sans"
  },
  "color": {
    "palette": ["#0A0A0A", "#C9FF4E", "#FAFAFA", "#777777"],
    "mode": "dark | light | mixed",
    "accentStrategy": "single-punch | duo | multi-color | monochrome",
    "notes": "Dark mode, single bright accent used sparingly"
  },
  "texture": {
    "hasGrain": true,
    "hasGradient": true,
    "hasShapes": false,
    "hasIllustration": false,
    "overallFeel": "editorial | tech | brutalist | soft | playful | clinical",
    "notes": "Film grain + soft gradients give editorial vibe"
  },
  "decorationStyle": {
    "usesCornerMarks": false,
    "usesRules": true,
    "usesOversizedNumbers": false,
    "usesPullQuotes": true,
    "usesIcons": false,
    "notes": "Heavy use of accent rules under kickers"
  },
  "matchConfidence": 0.85
}
```

Enum values in the schema use `a | b | c` to list allowed choices — pick
exactly one string for each of those fields. Palette should be 3-6 hex
codes. Boolean fields must be `true` or `false`, not strings.

## Confidence scoring

Calibrate `matchConfidence` against sample size and consistency:

- 5 carousels, consistent style → 0.9+
- 3 carousels, consistent style → 0.75-0.85
- 2 carousels, consistent style → 0.6
- 1 carousel only → 0.5 (single sample is a snapshot, not a pattern)
- Any N with wildly inconsistent references → 0.4, and flag the
  inconsistency in `composition.notes` or the relevant section's notes

## Do NOT

- Invent patterns you didn't actually see. Only report what's in the images.
- Chase pixel-perfect hex codes. "warm cream around #F5F0E8" is fine.
- Match observations to preset names (e.g. `grain-on-gradient`,
  `dot-grid`) — that's the synthesizer's job. You output raw observations.
- Write anything other than the `references.json` file to the output dir.
- Skip the `notes` fields — they're where the real signal lives.
