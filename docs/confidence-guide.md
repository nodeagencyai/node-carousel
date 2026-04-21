# Scan confidence — what the number means

When you run `/node-carousel:scan <url>`, the CLI prints something like:

```
confidence: 0.72
```

This guide explains what that number is and what to do with it.

## Quick answer

Confidence is a 0-to-1 score for how well the scan triangulated your brand's
colors, fonts, and visual language from your website. It's not a quality score
for your site — it's a reliability score for the scan.

High = scan found enough signal to be trusted. Low = scan is guessing and you
should probably override it.

It comes out of `scan.colors.confidence` in `./.brand-scan/scan.json` and is
recalibrated honestly — there is no fake `1.0`.

## The 4 bands

### 0.85 – 1.0 — great

Scan confidently detected your brand. The synthesized `brand-profile.json`
should be close to right out of the box. You can probably generate carousels
as-is; tune colors or fonts later if something feels off.

```
/node-carousel:scan https://yourbrand.com
/node-carousel:generate <topic>
```

### 0.65 – 0.85 — good

Scan caught most signals but missed a detail or two. Before publishing your
first deck:

- Review the accent color in the preview — is it the right one?
- Check display + body fonts — did scan pick your real brand fonts, or fall
  back to a generic?

If you have a hand-tuned profile from a previous run, consider:

```
/node-carousel:scan https://yourbrand.com --merge-with ./brand-profile.json
```

The scan refreshes text samples and warnings; your existing identity wins per
leaf key.

### 0.45 – 0.65 — iffy

Scan is missing signal. The auto-detected profile is a starting point, not a
finished one. Strongly recommended:

- `--merge-with <path>` to preserve an existing profile, OR
- `--preset <name>` to force the aesthetic (editorial-serif, neo-grotesk,
  technical-mono, display-serif-bold, utilitarian-bold, satoshi-tech).

Also read the `scan.warnings` array — it usually tells you exactly what went
wrong (JS-rendered page, missing fonts, no `<h1>`).

### Below 0.45 — bail

Scan failed to see enough. Don't ship this profile as-is. Run the manual
wizard instead:

```
/node-carousel:setup
```

It walks you through colors, fonts, tone, and preset choice in ~2 minutes.

## Decision tree

```
Scan completed → confidence is ?
  >= 0.85     → Generate carousels, tune if needed
  0.65 – 0.85 → Review colors + fonts, consider --merge-with
  0.45 – 0.65 → --merge-with or --preset is strongly recommended
  < 0.45      → Run /node-carousel:setup manually
```

## Why your confidence might be lower than expected

- **JS-heavy site** (React, Next, Vue) — styles inject at runtime, and scan
  may pull pre-hydration CSS with generic fallbacks instead of your real
  brand fonts.
- **Framer / Webflow / Squarespace** — these builders often skip semantic
  markers like `<nav>`, `<header>`, `.logo`, which scan uses to locate the
  logo and measure hierarchy.
- **Thin marketing page** — a one-screen landing page with 30 words of copy
  doesn't give scan enough text to classify voice or niche.
- **Password-protected or paywalled** — scan got the login wall, not your
  real content. Try a public subpage.
- **Heavy CDN caching** — some sites return stale CSS from the edge, out of
  sync with what you see in the browser.
- **Font served via JS** (Typekit, Fontshare widget) — scan may miss the
  real family and fall back to the CSS declaration's last fallback.

## When to override scan (v0.7 flags)

Two escape hatches keep you in control when confidence is low:

- `--merge-with <path-to-existing-profile.json>` — your existing
  `brand-profile.json` wins per leaf key. Useful when your carousel brand is
  different from your marketing-site brand (e.g. bolder accent, different
  body font for slides).
- `--preset <name>` — skip the scan's preset-matching and force one of the 6
  canonical presets. All other overrides (colors, logo, tone) still run.
  Case-insensitive. Unknown names error before the scan starts.

```
/node-carousel:scan https://yourbrand.com --merge-with ./brand-profile.json
/node-carousel:scan https://yourbrand.com --preset technical-mono
/node-carousel:scan https://yourbrand.com --merge-with ./existing.json --preset satoshi-tech
```

Full flag usage: [`commands/scan.md`](../commands/scan.md). Merge semantics:
`prompts/brand-synthesis.md` Phase 0.

## One more thing

Low confidence isn't a bug — it's the scan being honest. A fake `1.0` would
give you a clean-looking profile that's quietly wrong. A real `0.52` tells
you to bring a profile or pick a preset. Treat the number as a signal, not a
verdict.
