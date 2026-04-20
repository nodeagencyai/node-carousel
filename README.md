# node-carousel

Free Instagram carousel generator for Claude Code. Runs on your own Claude plan. No API keys, no Figma, no Canva.

<p align="center">
  <img src="examples/why-your-lead-magnet-isnt-converting/slide-01.svg" width="30%" alt="Why your lead magnet isn't converting" />
  <img src="examples/5-signs-overengineered/slide-01.svg" width="30%" alt="5 signs your AI automation is over-engineered" />
  <img src="examples/2-minute-crm-audit/slide-01.svg" width="30%" alt="The 2-minute CRM audit" />
</p>

---

## What this is

A Claude Code plugin that turns a topic into a 5–8 slide branded Instagram carousel. You tell it what to post about, it produces the strategy, renders SVG slides from your brand config, and writes the caption.

- `/node-carousel:setup` — one-time wizard that writes your `brand-profile.json`
- `/node-carousel:generate <topic>` — topic in, carousel + caption out
- `/node-carousel:export` — PNGs ready to upload

## Why another carousel tool

Most AI carousel tools are one of two things: text-only templates that all look the same, or "AI generates the whole SVG" products that work great in the demo and break in week two.

This one takes a different cut:

- **Template-first, Claude-filled.** Your slides render from hand-designed SVG templates with `{{PLACEHOLDERS}}`. Claude picks layouts and fills content. No black-box generation. Output looks the same every time.
- **Brand config in one file.** Colors, fonts, tone, background — all in `brand-profile.json`. Change one hex code, every slide updates.
- **No API keys.** Runs entirely on your Claude Code plan. No OpenRouter, no Gemini, no Stability, no Replicate. Zero dollars to run.
- **Works on Haiku, Sonnet, Opus.** The logic is simple enough that any Claude model can drive it.

## Install

### Option 1: Install as a Claude Code plugin (recommended)

```bash
git clone https://github.com/nodeagencyai/node-carousel ~/.claude/plugins/node-carousel
```

Restart Claude Code. You should see `/node-carousel:setup` available.

### Option 2: Copy skills globally

```bash
git clone https://github.com/nodeagencyai/node-carousel /tmp/nc
cp -r /tmp/nc/commands/* ~/.claude/commands/
cp -r /tmp/nc ~/.claude/node-carousel
```

Then edit the commands to point at `~/.claude/node-carousel` as the plugin root.

## Quick start

```bash
# 1. Set up your brand (one-time, creates brand-profile.json in your current dir)
/node-carousel:setup

# 2. Generate a carousel
/node-carousel:generate 5 signs your AI automation is over-engineered

# 3. Export to PNG (optional — requires Puppeteer, ~170MB Chromium)
/node-carousel:export
```

That's the whole thing. Outputs land in `./output/<topic-slug>/`:
- `slide-01.svg` through `slide-NN.svg` — the slides
- `preview.html` — all slides in a browser, for review
- `caption.txt` — the Instagram caption
- `strategy.json` — the slide spec, so you can edit and re-render

## Configuration

Your `brand-profile.json` looks like this:

```json
{
  "brand": {
    "name": "Node",
    "handle": "@nodeagency",
    "tone": "direct, builder-voice, no fluff"
  },
  "visual": {
    "colors": {
      "background": "#0f0f0f",
      "text": "#FFFFFF",
      "accent": "#29F2FE",
      "accentSecondary": "#0B8AEE",
      "muted": "#888888"
    },
    "fonts": {
      "display": "Playfair Display",
      "body": "Inter"
    },
    "background": {
      "type": "gradient",
      "color": "#0f0f0f",
      "gradient": { "from": "#0f0f0f", "to": "#0B8AEE", "angle": 135 },
      "imagePath": null
    },
    "dimensions": { "width": 1080, "height": 1350 }
  }
}
```

Full schema with every field, type, and default: [`docs/brand-profile-schema.md`](docs/brand-profile-schema.md).

**Fonts** come from [Google Fonts](https://fonts.google.com) — any free Google Fonts family name works.

**Background types:** `solid` (single color), `gradient` (two colors + angle), or `image` (path to a PNG/JPG — a dark overlay is added automatically for text readability).

**Dimensions** default to 1080×1350 (Instagram 4:5 portrait — highest engagement). Templates in v0.1.0 are optimized for this ratio; other dimensions may produce layout issues.

## Templates

Five slide templates ship with v0.1.0. Claude picks which to use per slide based on content.

| Template | Use for |
|---|---|
| `title` | Opening hook. Kicker + 2-line headline + brand handle. |
| `bullet` | 3–5 parallel points with arrow prefix. |
| `stat` | One huge number that lands. Stat + label + optional context. |
| `quote` | A line that earns isolation. 2–4 line quote + attribution. |
| `cta` | Final ask. Hook + button + optional subtext. |

Want to add your own? See [`docs/adding-templates.md`](docs/adding-templates.md).

## Examples

Three reference carousels ship in [`examples/`](examples/):

- **[5 signs your AI automation is over-engineered](examples/5-signs-overengineered/)** — dark gradient, Playfair + Inter, builder-voice
- **[The 2-minute CRM audit framework](examples/2-minute-crm-audit/)** — light editorial, DM Serif Display + Manrope, warm concrete tone
- **[Why your lead magnet isn't converting](examples/why-your-lead-magnet-isnt-converting/)** — deep gradient, Space Grotesk, sharp opinionated voice

Open any of the `preview.html` files to see the slides in your browser.

## FAQ

**Does it work without a paid Claude plan?**
You need Claude Code (free tier works). No other paid service is required.

**Can I use my own fonts (not Google Fonts)?**
Not in v0.1.0. Use the closest Google Fonts match, or fork and embed fonts in the templates directly. Custom font support is v2 scope.

**Can I use my own background image?**
Yes — set `visual.background.type` to `"image"` and `visual.background.imagePath` to your image's path (relative or absolute). A dark overlay is added for text readability. Note: untested with all image paths — may need tuning for non-standard renderers.

**How do I add a new slide layout?**
Write an SVG template in `templates/` using the `{{PLACEHOLDER}}` pattern, add guidance to `prompts/strategy-system.md` so Claude knows when to pick it, ship a PR. See [`docs/adding-templates.md`](docs/adding-templates.md).

**Does it work on Haiku or Sonnet?**
Yes. The template-filling logic is simple enough that any Claude model handles it. Opus produces the most nuanced strategy copy but all tiers render correctly.

**What's the difference between this and other carousel tools?**
Most tools generate the SVG visually from scratch — gorgeous demos, but every run produces different quality. This one separates strategy (Claude picks what's on each slide) from rendering (deterministic template fill). Output is predictable, editable, and version-controllable.

**Why no animation or MP4 export?**
v0.1.0 is static SVG + PNG only. Animation + MP4 is planned for v0.2.0 alongside more templates.

## What's planned

- v0.2.0 — Animation (SMIL + CSS), MP4 export, 3–4 more templates (timeline, comparison, checklist)
- v0.3.0 — Custom font embedding, richer image-background controls
- v0.4.0 — Template marketplace / community contributions

## License

MIT — see [LICENSE](LICENSE).

## Credits

Built by [Niek Huggers](https://nodeagency.ai) at Node. If this saved you from buying a Canva subscription, DM [@nodeagency](https://instagram.com/nodeagency) and let me know.
