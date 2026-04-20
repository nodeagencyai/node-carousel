# Typography Systems for Display-Heavy SVG — April 2026

Research brief for `node-carousel` v0.4. Answers: **What principled typographic system should replace the current arbitrary font sizes in our SVG templates?**

Target canvas: 1080×1350px Instagram carousels. Display-heavy content (hooks, stats, big quotes, editorial headlines). Current templates mix 240px stats with 48–54px labels (a 5:1 ratio), which reads broken because the designed-in ratio for display typography sits in the 2.5:1 to 3.3:1 range.

---

## Executive summary

Adopt **Perfect Fourth (1.333)** as the scale ratio, **16px** base, **8px baseline grid**, and anchor display sizes at **scale steps +6 through +10** (76 / 101 / 135 / 180 / 240px). Replace the current stat (280px) + label (54px) pairing — ratio 5.19:1, which skips two full steps of the Perfect Fourth scale and leaves no intermediate size to hang hierarchy from — with stat (180px) + label (68px), ratio 2.65:1, two steps apart. Tighten all display letter-spacing to −0.03 to −0.045em and lock display line-heights to 0.95–1.05. For SVG specifically, use `dominant-baseline="alphabetic"` (the default, cross-browser-consistent) and position everything via `y` + `dy` on baseline-grid multiples; avoid `central`/`middle` baselines which drift between fonts.

Justification for Perfect Fourth over Golden Ratio (the scale Tim Brown demonstrates in *More Meaningful Typography*)[^brown]: 1.618 overshoots once you get above ~100px — the next step jumps 160px, leaving gaps too large to place sub-headlines into. Major Third (1.25) is the safer default for mixed-density web UIs but produces steps too close together at display scale; for a 180px stat the next step down is 144px, barely different visually. Perfect Fourth gives the strongest distinct-but-sibling step size at display scale, and is the scale the design-systems literature explicitly names for "editorial design, magazine layouts, news sites, and magazines with strong heading presence."[^cieden]

---

## Recommended type scale

**Ratio:** 1.333 (Perfect Fourth)
**Base:** 16px
**Baseline grid:** 8px (every computed value rounds to nearest 4px; line-heights always land on 8px multiples)

| Step | Raw (px) | **Rounded (px)** | Role |
|------|---------:|-----------------:|------|
| −2   |  9.00    |  **9**           | legal / micro (not used on 1080×1350; kept for completeness) |
| −1   | 12.00    | **12**           | micro caption, page-number |
|  0   | 16.00    | **16**           | anchor only (body at display scale starts at +2) |
| +1   | 21.33    | **21**           | small body |
| +2   | 28.43    | **28**           | body copy, dense bullets |
| +3   | 37.90    | **38**           | default bullet (matches current), small label |
| +4   | 50.52    | **50**           | standard label, sub-headline |
| +5   | 67.36    | **68**           | large label, kicker, small stat |
| +6   | 89.80    | **90**           | sub-hero headline, hooks |
| +7   | 119.75   | **120**          | hero headline |
| +8   | 159.69   | **160**          | hero stat |
| +9   | 213.00   | **213**          | oversized display stat (ceiling) |
| +10  | 284.10   | **284**          | "billboard" step — use once per carousel, max |

**Why round?** Raw modular values produce sub-pixel line-height mismatches. Rounding to even integers that are multiples of 4 keeps everything aligned to an 8px baseline, which is the 2026 industry default and scales cleanly to retina (2x = 16, 3x = 24).[^vitsky] Designers-and-engineers both agree on 8pt as the unit that "scales perfectly on retina screens, and works whether you are using vector or pixel-based designs."[^vitsky]

**Why anchor at step +6 for sub-hero?** At 1080×1350 viewed on a 375–430px phone at ~2x density, 90px renders at ~28–32 logical px on device, which matches the eye-level of a premium editorial headline. Anything smaller than 68px (step +5) fails the "readable from thumbnail" test — Instagram carousels are first viewed at ~100–200px wide in feed previews.[^sizeguide]

---

## Ratio recommendations (the core fix)

The current 280:54 stat:label ratio (5.19:1) is the bug. Display-heavy posters and editorial designs converge around three tested ratios:

| Pairing | Recommended ratio | Scale steps apart | Example at step +8 |
|---|---|---|---|
| **Stat : stat-label** | 2.37–2.66 : 1 (one step apart on 1.333) | 1 | 160px / 68px |
| **Stat : supporting context** | 5.33–5.63 : 1 | 3 | 160px / 28px |
| **Headline : body** | 3.17–4.21 : 1 (two steps) | 2 | 120px / 28px |
| **Headline : kicker** | 4.21–5.60 : 1 (three steps) | 3 | 120px / 21–28px |
| **Stat : stat** (adjacent comparison) | 1.33 : 1 | 1 | 120px vs 90px |

The 3:1 rule the brief asks about (e.g. 240/80) is **one step** on the 1.333 scale (ratio is literally 1.333², which is 1.777, not 3 — but rounding brings it close). If you want cleaner-than-3:1 contrast, use a two-step jump (ratio 1.333² = 1.778) and you get the "weight-adjusted" perceived 2.5:1 that feels right in display composition.[^pimp]

**Rule of thumb for carousels:** never skip more than 2 scale steps between typographic neighbors on the same slide. Three steps reads as hierarchy-of-importance; four+ reads as "these elements are not on the same slide."

---

## Vertical rhythm and the 8px baseline grid

The 8px grid is the right choice for 1080×1350 because:

1. 1080 ÷ 8 = 135 (divides cleanly across canvas width)
2. 1350 ÷ 8 = 168.75 (rounds to 1352 — off by 2px, negligible)
3. 8px is the convergent industry default (Google Material, Apple HIG, IBM Carbon, Shopify Polaris all use 8pt as the atomic unit)[^vitsky]
4. Every 4px sub-unit is available for optical adjustments (half-baseline nudges)

**Swiss poster baseline alternative:** The Stephen Kelman Swiss-style A0 poster grid (which inspired many editorial poster layouts referenced in the earlier `carousel-aesthetics.md` research) uses a 36pt baseline grid[^swiss]. That's the right density for A0 print where viewing distance averages 2m and columns are narrow; for 1080×1350 digital at 30cm viewing distance, 36pt (48px) is too coarse to lock typography to cleanly.

**Line-height values that lock to 8px grid** (assuming the size rounding above):

| Size (px) | line-height (unitless) | Computed leading (px) | Lands on 8px? |
|---|---|---|---|
| 28  | 1.29 | 36 | ✓ |
| 38  | 1.26 | 48 | ✓ |
| 50  | 1.12 | 56 | ✓ |
| 68  | 1.06 | 72 | ✓ |
| 90  | 1.07 | 96 | ✓ |
| 120 | 1.00 | 120 | ✓ |
| 160 | 1.00 | 160 | ✓ |
| 213 | 1.00 | 213 | — falls between grid, acceptable for single-line stat |
| 284 | 1.00 | 284 | — single-use only |

The progression toward line-height 1.00 at display is standard practice. Geist (Vercel's system) specifies `-0.04em` letter-spacing paired with `1.15` line-height for 48–64px headlines, and that tightens further at true display scale.[^geist] For 120px+ headlines, `line-height: 1.0` is common in editorial posters; the visual spacing comes from the letter-spacing reduction, not vertical leading.[^pimp2]

---

## Letter-spacing at display scale

A universal rule of display typography: **as size goes up, tracking goes down** (often to negative values). At 16px, `letter-spacing: 0` is neutral; at 200px, `0` reads as awkwardly loose. Tracking must counteract the perceptual looseness that comes from extra whitespace around large glyphs.

**Recommended ranges** (em-based so they scale with font-size):

| Size range | letter-spacing | Rationale |
|---|---|---|
| Body 16–28px | 0 to −0.005em | near-neutral; avoid compressing for legibility |
| Small label 28–50px (uppercase) | +0.12 to +0.22em | UPPERCASE labels need positive tracking for breathing room (current `.kicker` at 0.22em is correct) |
| Small label 28–50px (title case) | −0.01 to −0.02em | subtly tight |
| Sub-headline 68–90px | −0.02 to −0.03em | Geist sits here at −0.02em default[^geist] |
| Headline 100–160px | −0.03 to −0.04em | Geist marketing uses −0.04em at 48–64px[^seedflip]; extrapolated tighter at true display |
| Hero stat 160px+ | −0.04 to −0.05em | Tightness prevents the stat from visually dissolving into whitespace |

Serifs need less tightening than sans (fine detail and tapered terminals already read as compact): reduce the negative tracking by ~0.005em for Instrument Serif, DM Serif Display.

Archivo Black is already "tightly spaced" by design[^archivoblack]; it benefits from only −0.015 to −0.02em at display — go further and the counters close up.

---

## Optical corrections at display scale

Five corrections matter at 1080×1350 display typography:

### 1. Optical alignment (hang punctuation outside the grid)
Opening quotes, hyphens, parentheses, and the crossbars of T/W/A should visually extend past the left edge of a text block. InDesign's Optical Margin Alignment does this automatically[^optical]; SVG has no native equivalent. In practice: for quote slides, negative-position the opening `"` by ~0.08em to pull it past the column edge.

### 2. X-height parity across font families
Inter has a notably tall x-height (designed for screen), Playfair Display has an "extra-large" x-height[^xheight], Instrument Serif has a moderate x-height, DM Serif Display has a tall x-height with fine details[^dmserif]. When pairing display (serif) with label (sans), visual size parity requires that **labels be typeset 5–10% larger than the display if you want them to appear optically the same size.** This matters for the stat-label lockup: a 68px label in Inter next to a 160px DM Serif Display stat already reads as "in the same family" because Inter's tall x-height compensates for the size gap.

### 3. Negative line-height at display
CSS line-heights below 1.0 (e.g. `line-height: 0.9`) clip ascenders/descenders. That's acceptable for single-line display stats where there are no descenders, but breaks for multi-line headlines containing letters like `g` or `y`. Safe rule: `line-height: 1.0` is the floor for multi-line display; go below only for known-all-caps or known-no-descenders content.[^pimp2]

### 4. Weight pairing at display
At display sizes, the perceived weight of a type shifts. A 500 weight at 28px reads "medium"; the same 500 at 200px reads nearly bold. Rules for our 5 fonts:

| Font | Display weight | Body weight | Notes |
|---|---|---|---|
| Instrument Serif | 400 (it's a display face; 400 already reads as heavy) | — not suitable for body | Condensed display serif — perfect for 90–213px headlines |
| Geist Sans | 700–800 at headline; 500 at kicker | 400 body | Tighten to −0.04em at display[^geist] |
| JetBrains Mono | 700 at 50–90px (never larger — mono is too dense at 120px+) | 400 body | Use in short kickers or code-snippet slides; cap at step +6 |
| DM Serif Display | 400 (only weight available) | — not suitable for body | High-contrast serif — benefits from darker backgrounds to preserve fine serifs at 120px+ |
| Archivo Black | 900 (only weight) | — heavy body 400 pairing needed | Tightly spaced by design — use −0.015em, no more |

### 5. Vertical centering drift
When using SVG `text-anchor="middle"`, vertical centering happens on the **baseline**, not the visual center of the glyph. This means a 240px glyph and a 68px glyph both anchored at `y=500` will look misaligned — the larger glyph's visual center sits far above the smaller one's. Fix: when stacking labels under stats, compute the `y` offset as `stat_y + stat_size * 0.85 + gap` (where `gap` is a baseline multiple, e.g. 48 or 56px).

---

## Display-heavy editorial references (2024–2026)

**Vercel (Geist)**: headlines at 48–64px with `letter-spacing: -0.04em` and `line-height: 1.15`. Documented display size ceiling: 64px, which reflects that Vercel's marketing rarely pushes into true poster display. For carousels we need the scale to extend 3–4 more steps upward.[^geist][^seedflip]

**Linear**: Inter on dark grey, very tight vertical rhythm, no decoration. Headlines tend to sit at 40–56px with extremely generous whitespace doing the hierarchy work that larger type would do elsewhere. Not a direct reference for 200px display but a guide for restraint.[^linear]

**Stripe Press**: book-scale serif display for titles; per-book scale variation but consistent 3–4 step hierarchy (title / subtitle / chapter / body). Their display uses generous line-spacing (1.1–1.15) because the type is lower contrast (book weight, not poster weight).

**NYT Magazine / Atlantic**: serif display at 72–120px on editorial web, paired with a single short-tracked all-caps kicker and a bylined sans body. Their display line-height commonly sits at 1.0–1.05 with letter-spacing −0.02em. This is the closest industry reference to what node-carousel should emit.

**Instrument's own marketing site** (designers of Instrument Serif): use the serif at 200px+ on hero slides with line-height ~0.95, letter-spacing −0.02em, italic cut for "loose, calligraphic, confident" expressive moments on dark backgrounds.[^instrument]

---

## SVG implementation specifics

SVG has no box model for typography. What it offers:

### Baseline attributes
- `dominant-baseline`: the reference baseline for the element. Values: `auto`, `alphabetic` (default), `central`, `middle`, `hanging`, `text-before-edge`, `text-after-edge`, `ideographic`, `mathematical`.
- `alignment-baseline`: how a `<tspan>` aligns to its parent `<text>`'s baseline.

**Recommendation: always use `alphabetic`** (the default). It's the only value consistently implemented across Chromium, WebKit, and Firefox. Other values drift between browsers and rendering engines (Playwright headless vs. Instagram's native preview).[^mdn-baseline]

### Positioning pattern
Use `y` for absolute baseline position, `dy` for relative offsets between tspans. Avoid `central` or `middle` dominant-baseline because their computed Y depends on the font's internal metrics, which vary per font — you'll get drift between Instrument Serif and Geist at the same `y` coordinate.

**Pattern for a stat + label lockup** (centered on canvas center 540×675):

```xml
<text x="540" class="stat" text-anchor="middle"
      y="640">160</text>
<!-- Stat baseline sits above center; label baseline 72px below -->
<text x="540" class="label" text-anchor="middle"
      y="712">CONVERSION LIFT</text>
<!-- 72px = 9 baseline units (at 8px grid); lands at first 8px row after stat descent -->
```

### Optical alignment (hanging punctuation) in SVG
No native support. Manually nudge via `x` offset on the opening glyph:

```xml
<text x="100" y="400" class="quote">
  <tspan dx="-30">"</tspan>We ship every Friday.
</text>
```

The `-30` pulls the opening quote 30px left of the left column edge (about 0.15em at 200px). Tune by font: serifs benefit from bigger pull (they have more visual weight inside the quote mark); sans-serif less so.

### Baseline grid in SVG
There is no `baseline-grid` property. Enforce it at the template level:

1. All `y` coordinates must be multiples of 8.
2. All inter-element gaps (between headline and body, between bullet rows, etc.) must be multiples of 8.
3. All font-sizes round to multiples of 4 (so half-line positions are also grid-aligned).
4. All `dy` values on multi-line `<tspan>` structures match line-height × font-size and round to 8.

### Optical sizing (variable fonts)
Inter and Playfair 2.1 support an optical size axis (`opsz`). At display sizes, use `font-variation-settings: "opsz" 144` (or the font's max opsz value) to switch into the display-optimized master. Default (non-opsz-aware) renderers ignore this gracefully.[^inter-opsz]

---

## Font-by-font guidance (node-carousel's 5 preset display fonts)

| Font | Recommended weight | Letter-spacing at display | Line-height | Baseline notes |
|---|---|---|---|---|
| Instrument Serif | 400 | −0.02em at 90–160px; −0.03em at 160–213px | 0.95–1.00 | Italic works at 120px+ on dark bg. Moderate x-height — safe to pair with Inter/Geist at identical sizes for body. |
| Geist Sans | 700 display / 500 kicker / 400 body | −0.03em at 68–120px; −0.04em at 120px+ | 1.00–1.05 | Matches Vercel's `-0.04em / 1.15` spec extrapolated tighter. Pair Sans 700 with Mono 500 for technical/editorial mix. |
| JetBrains Mono | 700 | −0.01 to −0.015em (mono needs less tightening; glyphs are already advance-uniform) | 1.05–1.15 | Cap at step +6 (90px). Above 90px, mono reads as "oversized code" not "headline." |
| DM Serif Display | 400 (only weight) | −0.02em (sparing — preserves fine serifs) | 0.95–1.00 | Needs dark backgrounds to hold serif detail at 120px+. Pair with Inter for body, weight 400. |
| Archivo Black | 900 (only weight) | −0.015em to −0.02em | 0.95–1.00 | Already tight by design — do not over-tighten. Use as punchy single-word display. Not suitable for multi-line headlines longer than 5–6 words. |

---

## Specific changes to make in node-carousel

Fourteen template-level edits, ordered by severity:

1. **`stat.svg` stat size: 280 → 160px (step +8).** Current 280px is off-grid (not a scale step, ratio to label breaks).
2. **`stat.svg` label size: 54 → 68px (step +5).** Gives 2.35:1 ratio (one step apart) instead of 5.19:1.
3. **`stat.svg` context size: 28 → 28px (step +2).** Already correct. Keep.
4. **`stat.svg` stat letter-spacing: −0.03 → −0.04em.** Tightens at true display scale.
5. **`stat.svg` label letter-spacing: 0 → +0.14em, add `text-transform: uppercase`.** Turns labels into proper editorial kickers (brings design-language parity with `.kicker` in `title.svg`).
6. **`stat.svg` stat line-height: (unset) → 1.00.** Prevents descender-clipping on multi-char stats.
7. **`stat.svg` vertical positioning: recalculate with baseline offset `stat_y + 160 * 0.85 + 48 = stat_y + 184`.** Current CENTER_Y_PLUS_60 is arbitrary.
8. **`stat-oversized-context.svg`: allow stat at step +9 (213px)** for the "billboard" variant only, with label still at step +5 (68px). Ratio 3.13:1 (two steps apart).
9. **`title.svg` headline size: {{TITLE_HEADLINE_SIZE}} variable → replace with explicit scale steps.** Short headlines: step +7 (120px); long headlines: step +6 (90px). Eliminate ad-hoc sizing.
10. **`title.svg` headline letter-spacing: (unset) → −0.035em.** Currently inherits 0, reads loose at 90–120px.
11. **`title.svg` headline line-height: 1.05 → 1.00.** Multi-line display at 1.05 reads "web page," at 1.00 reads "poster."
12. **`bullet.svg` headline: 64 → 68px (step +5).** Aligns to scale.
13. **`bullet.svg` bullet rows: 38 → 38px (step +3).** Already on-scale. Add `letter-spacing: -0.01em` + `line-height: 1.26` (lands on 48px / 6 baseline units).
14. **`bullet.svg` row spacing: 90 → 88px** (11 baseline units at 8px grid). Current 90 is 1px off-grid.

Secondary (nice-to-have):

15. **`quote.svg`**: quote body step +6 (90px), attribution step +3 (38px). Opening `"` gets `dx="-0.08em"` for optical hang.
16. **All templates**: add a `data-scale-step` attribute on each `<text>` element (e.g. `data-scale-step="+8"`) so downstream tooling can audit scale compliance.
17. **Rename font-size values in templates to reference a scale dict** (if the generator supports string lookup): `font-size: var(--step-8)` → 160 at generate time. Prevents future drift.

---

## High-signal references

1. [Tim Brown — More Meaningful Typography (A List Apart)](https://alistapart.com/article/more-meaningful-typography/) — foundational argument for modular scales; source for "scale as tool, not magic."
2. [Modular Scale (modularscale.com)](https://www.modularscale.com/) — Tim Brown + Scott Kellum's calculator; verify any step computation here.
3. [Vercel Geist Typography](https://vercel.com/geist/typography) — canonical modern sans display system (notes: specific px values live in Figma, not the public page).
4. [Seedflip — Vercel Design System Breakdown](https://seedflip.co/blog/vercel-design-system) — reverse-engineered Geist values, including the `−0.04em / 1.15` display headline spec.
5. [Cieden — Typographic scales](https://cieden.com/book/sub-atomic/typography/different-type-scale-types) — explicit recommendation of Perfect Fourth for editorial/magazine/news.
6. [Pimp My Type — Typographic Hierarchy](https://pimpmytype.com/hierarchy/) and [Line height](https://pimpmytype.com/line-length-line-height/) — qualitative rules for contrast + tight leading at display.
7. [Vitsky — Comprehensive 8pt Grid Guide](https://medium.com/swlh/the-comprehensive-8pt-grid-guide-aa16ff402179) — why 8pt beats 4pt for screen layouts.
8. [Stephen Kelman — Swiss Style A0 Poster Grid](https://stephenkelman.co.uk/swiss-style-a0-poster-grid-system-for-indesign) — Swiss typography baseline-grid precedent (36pt reference, useful as contrast).
9. [MDN — SVG dominant-baseline](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/dominant-baseline) — cross-browser compatibility guidance; alphabetic is the only safe default.
10. [Nan Xiao — Customizing Inter with alternative optical sizing presets](https://nanx.me/blog/post/inter-optical-sizing/) — Inter's `opsz` axis for true display-optimized rendering.
11. [Fonts In Use — Instrument Serif](https://fontsinuse.com/typefaces/219915/instrument-serif) — case studies of Instrument Serif at 200px+ display scale.
12. [Google Fonts — Archivo Black](https://fonts.google.com/specimen/Archivo+Black), [DM Serif Display](https://fonts.google.com/specimen/DM+Serif+Display) — source specifications for our preset display fonts.

---

[^brown]: Tim Brown, *More Meaningful Typography*, A List Apart. Brown demonstrates golden ratio (1.618) but explicitly treats all scales as "educated suggestions" and encourages rounding or breaking from scale when the eye indicates better results.
[^cieden]: Cieden, *Different type scale types*. Names Perfect Fourth (1.333) as "popular choice for web interfaces" and "suited for strong distinction, editorial design, and magazine layouts."
[^vitsky]: Vitsky, *The Comprehensive 8pt Grid Guide*, The Startup. "It is now common to use an 8pt grid, because it means designs can scale perfectly on retina screens."
[^sizeguide]: Instagram Carousel Size Guide (2026). Recommends "40 pixels for headlines and 24 pixels for body text" as minimum for in-feed readability at thumbnail scale.
[^pimp]: Pimp My Type, *Hierarchy*. "Use as much variation as necessary and as little as possible." Contrast is achieved through size + weight + style combined.
[^pimp2]: Pimp My Type, *Line length & line height*. "Lines of large type, used for small amounts of text like headlines and pull quotes, can use a line height tighter than 150 percent."
[^swiss]: Stephen Kelman, *Swiss Style A0 Poster Grid System*. Uses 36pt baseline grid and 16-field modular grid for large-format posters.
[^geist]: Vercel, *Geist Typography*. Display headlines at 48–64px specified with `letter-spacing: -0.04em` and `line-height: 1.15`.
[^seedflip]: Seedflip, *Vercel Design System Breakdown*. Documents Geist sizes 12–64px; largest display token is `--text-display: 64px`.
[^linear]: Linear brand guidelines. Inter on dark grey, tight whitespace rhythm, headlines at 40–56px.
[^archivoblack]: Archivo Black (Google Fonts / Adobe Fonts). "Tightly spaced... compact and sturdy feel... well-suited for use in headlines, highlights, and logos."
[^dmserif]: DM Serif Display (Colophon Foundry, 2019). High-contrast transitional typeface with "delicate serifs and fine detailing, perfect for large-scale poster use."
[^xheight]: Playfair Display documentation. "Extra large x-height and short descenders" in Playfair 2.1.
[^optical]: CreativePro, *TypeTalk: Hung Punctuation & Optical Margin Alignment*. Hanging punctuation extends opening quotes, hyphens, parens into the margin for visually cleaner edges.
[^mdn-baseline]: MDN Web Docs, *dominant-baseline*. "It's best to use 'alphabetical' as it's consistent across browsers, with further vertical positioning done manually using x,y or dx,dy attributes."
[^inter-opsz]: Nan Xiao, *Customizing Inter with alternative optical sizing presets*. Inter's variable font includes optical size axis allowing adaptation at all sizes.
[^instrument]: Fonts In Use — Instrument Serif. Used large on dark backgrounds with loose, calligraphic italic cut.
