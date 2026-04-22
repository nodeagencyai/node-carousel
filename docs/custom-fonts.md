# Custom fonts — self-hosting licensed or proprietary type

**New in v0.7.1.** Drop a `.woff2` in `./brand-fonts/`, point `brand-profile.json` at it, and the renderer will base64-embed it into every slide SVG. Works for any font you have the right to embed.

## Why this exists

Not every brand font lives on Google Fonts or Fontshare. Gilroy, Graphik, Neue Haas, Söhne, and every proprietary in-house family you see on premium brand sites fall outside the free hostable-font universe. Before v0.7.1, the only options were "accept a substitute" or "fork the plugin." Now you drop the file and declare it.

The renderer base64-embeds your font into each slide as a `@font-face` data URI. No network load at view-time. The slide SVG is fully self-contained — you can mail it, commit it, drop it into Figma, and the type renders correctly.

## Where to drop files

Place your font files in `./brand-fonts/` in the **same directory as your `brand-profile.json`**:

```
my-project/
├── brand-profile.json
└── brand-fonts/
    ├── Gilroy-Bold.woff2
    └── Gilroy-Regular.woff2
```

Relative paths inside `brand-profile.json` resolve from the profile's directory — **not** from your current working directory. This is deliberate: the profile moves with the font files as a unit.

Absolute paths also work if you'd rather keep fonts in a shared system location (`/Users/you/Fonts/Gilroy-Bold.woff2`). Use this when multiple carousel projects share the same font library.

## How to declare in brand-profile.json

`visual.fonts.display` and `visual.fonts.body` each accept **two forms**: a plain string (Google Fonts family name) or an object (self-hosted). You can mix them freely.

```json
{
  "visual": {
    "fonts": {
      "display": {
        "family": "Gilroy",
        "file": "./brand-fonts/Gilroy-Bold.woff2",
        "weight": 700,
        "style": "normal"
      },
      "body": "Inter"
    }
  }
}
```

Above: display uses a self-hosted Gilroy, body falls back to Inter via Google Fonts. Mixed mode is the most common setup — your headline font is the proprietary one, body is something ubiquitous.

**Object form fields:**

- `family` (required) — CSS font-family name used in text. Must match the file's internal family name if you want the weight lookup to work cleanly.
- `file` (required when using object form) — path to the font file. Relative paths resolve from the profile's directory.
- `weight` (optional) — defaults to `700` for display and `400` for body. Must match what's actually in the file.
- `style` (optional) — `"normal"` or `"italic"`. Defaults to `"normal"`.

## Format support

| Format | Status | Notes |
|---|---|---|
| `.woff2` | Recommended | Smallest file size, widely supported, best compression |
| `.woff` | Accepted | Larger than woff2; use only if you can't convert |
| `.ttf` | Accepted | Works, but ~3x larger than woff2 equivalent |
| `.otf` | Accepted | Same size story as TTF |
| Anything else (eot, svg, ps) | Rejected | The loader errors before render |

## Size cap

Hard cap: **500 KB per file.** Above this, the loader rejects the font and surfaces an error. Every slide embeds a copy of the font data, so a bloated file multiplies across the deck.

Warning threshold: **250 KB.** You'll see a console warning but the file is accepted. If you're anywhere near that number, convert to woff2 (see "How to prepare a font file" below).

A well-optimized woff2 with a single weight + Latin subset is typically 15–40 KB. If yours is much bigger, it probably includes extra character sets you don't need.

## Licensing — read this

> **You are responsible for font license compliance. The plugin embeds what you provide. Verify your font's license permits embedding in distributed documents (e.g. Instagram carousels) before shipping. Most commercial fonts (Monotype, Adobe Fonts) do NOT allow this without a specific desktop-embed license tier. Open-source fonts (SIL Open Font License, Apache 2.0) typically do.**

Practical translation:

- **OFL / Apache 2.0 fonts** — fine. Embed freely, including in distributed artifacts. Includes Inter, JetBrains Mono, Satoshi, most of Fontshare, most Google Fonts.
- **Commercial desktop license** (what you bought as a designer) — usually permits embedding in **static** published outputs like PDFs or images, but check the EULA. Instagram carousels are static images; you're generally fine.
- **Adobe Fonts subscription** — embedding is **not allowed** outside Adobe's own products. You cannot host these files yourself.
- **Monotype / MyFonts / commercial foundries** — the base license usually doesn't permit embedding. You need a specific "desktop publishing" or "web embed" tier. Read your invoice.

If in doubt, email the foundry. They respond. The plugin does no license enforcement of its own — it trusts you to have done the diligence.

## Two workflows

### Manual — you know you need a custom font up front

You already have the font file from your design team and you're setting up the project from scratch:

1. Drop the file into `./brand-fonts/` (create the dir if needed).
2. Add the object form to `brand-profile.json` under `visual.fonts.display` (and/or `body`).
3. Run `/node-carousel:generate <topic>`. The font embeds and renders.

### Scan-flagged — you didn't realize the site used a self-hosted font

You ran `/node-carousel:scan https://yourbrand.com` and it detected a font family (e.g. Gilroy) in the site's CSS declarations but couldn't resolve it on Google Fonts or Fontshare. The synthesizer emits:

```json
"visual": {
  "fonts": {
    "display": {
      "family": "Gilroy",
      "file": null,
      "weight": 700,
      "style": "normal"
    }
  }
}
```

…plus a `font-self-hosted-required` warning in the scan output. The `file: null` is a placeholder — the renderer will fail cleanly if you try to generate without filling it in. The fix:

1. Get the font file from your team or buy it.
2. Drop it at `./brand-fonts/Gilroy-Bold.woff2` (match the weight the synthesizer picked).
3. Edit `brand-profile.json` and replace `"file": null` with `"file": "./brand-fonts/Gilroy-Bold.woff2"`.
4. Rerun `/node-carousel:generate <topic>`.

### Case study — Gilroy on theproducerschool.com

We scanned theproducerschool.com (The Producer School). The scan correctly identified Gilroy in the CSS — it's used for every headline. Gilroy is a Radomir Tinkov commercial font, not on Google Fonts or Fontshare. The synthesizer emitted the object form with `file: null` and a warning. We dropped `Gilroy-Bold.woff2` (86 KB, well under the cap) into `./brand-fonts/`, filled in the path, and reran. The preview matched the live site's headline treatment exactly.

## Troubleshooting

**Preview renders with a sans-serif fallback instead of your custom font.**
Two likely causes:
- The file path is wrong. Relative paths resolve from the `brand-profile.json`'s directory, not your CWD. If your profile lives in `/Users/you/project/` and your font is at `./brand-fonts/Font.woff2`, the full resolved path is `/Users/you/project/brand-fonts/Font.woff2`. Double-check.
- The file extension isn't supported. Only `.woff2`, `.woff`, `.ttf`, `.otf` are accepted. Rename from `.eot` or re-convert.

**Preview SVG is suddenly huge (multi-MB).**
You skipped the 500 KB cap check and embedded a big TTF. Convert to woff2 — you'll typically drop 70–90% of the size. The slide file should be under 200 KB for a deck with two custom fonts. Anything bigger and your file is too fat.

**Font-weight doesn't match the file, browser synthesizes bold.**
You declared `weight: 700` in `brand-profile.json` but dropped a Regular woff2. The browser will render the text but fake-bold it by smearing pixels, which looks wrong on large display type. Either use the actual weight the file contains (`weight: 400`) or get a real Bold file.

**Renderer errors `File exceeds 500 KB limit`.**
Compress to woff2 (see below) or subset the font to Latin-only glyphs. Modern tooling does both in one step.

**Renderer errors `Font file not found`.**
The path in `brand-profile.json` is wrong relative to the profile directory. Run `ls` from the profile directory and make sure the file is where you said it is.

## How to prepare a font file

If you have a TTF or OTF from your design team, convert to woff2 before using it:

```bash
# Using Google's woff2 tool
npm install -g woff2
woff2_compress MyFont-Bold.ttf
# Produces MyFont-Bold.woff2 in the same directory
```

Or use [fontsquirrel.com/tools/webfont-generator](https://www.fontsquirrel.com/tools/webfont-generator) — upload the file, select "Optimal" preset, download the woff2. One-shot, no install.

For subsetting (removing character sets you won't use — e.g. Cyrillic, Arabic, extended Latin), use [glyphhanger](https://github.com/zachleat/glyphhanger) or the Font Squirrel subsetter. Subsetting to Latin-only typically shaves 40–70% off the file. Do this once per font; commit the result into `./brand-fonts/` and forget about it.

## See also

- [`docs/brand-profile-schema.md`](brand-profile-schema.md) — full schema for `visual.fonts` including both string and object forms
- [`commands/scan.md`](../commands/scan.md) — how `--ask` and `--merge-with` interact with custom fonts
- [`docs/confidence-guide.md`](confidence-guide.md) — how to interpret scan confidence when custom fonts are involved
