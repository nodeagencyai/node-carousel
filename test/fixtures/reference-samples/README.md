# Reference Samples

This directory is the default drop-zone for your own existing carousels when
you run `/node-carousel:scan`. The scan command reads images from here,
extracts composition/typography/color/texture/decoration patterns, and uses
them so generated carousels match your existing visual style.

## How to use

1. Export 3-5 of your own existing carousel slides from Instagram, Figma,
   Canva, or wherever you designed them.
2. Drop them into this directory as `.png` or `.jpg` files. Filenames don't
   matter — any naming scheme works.
3. Run `/node-carousel:scan` and it'll pick them up automatically.

## Image requirements

- **Format**: PNG or JPG (case-insensitive extension).
- **Size**: minimum ~800px wide is recommended. Anything under 400px will
  warn; anything over 10MB is skipped.
- **Count**: up to 5 images. If you drop more, the 5 most-recently-modified
  are used and the rest are skipped with a warning.
- **Content**: full carousel slides (cover + body + CTA) give the richest
  signal. Single-slide samples work but yield lower confidence.

## What gets extracted

Claude analyzes each image visually via its multimodal `Read` tool and
produces a `references.json` capturing:

- **Composition** — layout patterns, whitespace usage, variety across slides
- **Typography** — serif/sans/mono, weight, scale
- **Color** — palette (rough hex), light/dark mode, accent strategy
- **Texture** — grain, gradients, shapes, illustrations, overall feel
- **Decoration** — corner marks, rules, oversized numbers, pull quotes, icons

The synthesizer then matches that style signal against the v0.4 pattern
library and brand tokens.

## What does NOT belong here

- Reference material from other brands you want to copy — the scan is
  intended to match YOUR existing style, not reverse-engineer someone
  else's.
- Raw source files (.fig, .sketch, .psd, .ai). Export to PNG/JPG first.
- Videos or GIFs. Static images only.
- Anything sensitive — these files are sent to Claude at command runtime.

## Privacy

Images in this directory are only read when you explicitly run a carousel
command. They're not uploaded anywhere else and stay on your disk.

## Placeholder

There are no sample images committed here — reference carousels are
user-provided by definition. Drop your own images in before running
`/node-carousel:scan`.
