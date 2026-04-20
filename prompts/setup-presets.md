# Setup presets — voice-first library

The `/node-carousel:setup` wizard starts from one of 5 aesthetic presets, then overlays your brand identity and any optional overrides. Preset choice drives font pairing, color palette, background treatment, grain, and numbering style in a single cascade.

All presets target 1080×1350 (Instagram 4:5). All use only Google Fonts. All preset JSON files live in `templates/presets/` and are valid, complete `brand-profile.json` starting points (the wizard fills in `brand.name/handle/tone` before writing).

## How to pick

- **B2B tech / SaaS** → (A) editorial-serif or (B) neo-grotesk
- **Creator / newsletter / premium content** → (A) editorial-serif or (D) display-serif-bold
- **Developer tool / infra / AI** → (C) technical-mono
- **Design studio / bold agency / utility-first** → (E) utilitarian-bold
- **Statement media / luxury / high-contrast editorial** → (D) display-serif-bold
- **Not sure?** → (A) editorial-serif is the safest default for most brands.

---

## (A) editorial-serif — `templates/presets/editorial-serif.json`

Warm, considered, premium. Reads as slow, thoughtful, book-voice. The 2026 default for brands that want to be taken seriously without shouting.

- **Fits:** AI-first tools, fintech, productivity, creator brands, editorial newsletters, anything aspiring to Lenny-style authority.
- **Doesn't fit:** bold agencies, dev tools, loud consumer brands — reads timid if the content is meant to shout.
- **Fonts:** `Instrument Serif` (display) + `Inter` (body)
- **Palette:** warm cream `#F8F5F0` bg · near-black `#1A1A1A` text · terracotta `#C84B31` accent · muted grey `#6B6B6B`
- **Background:** solid cream with subtle film grain (intensity `0.08`)
- **Numbering:** `fraction-mono` bottom-right
- **References:** Lenny Rachitsky, Morning Brew, The Generalist, Every.to, Substack premium tiers

---

## (B) neo-grotesk — `templates/presets/neo-grotesk.json`

Clean, modern, confident. The canonical "we ship software" aesthetic — flat grotesk type on a near-black canvas with a soft vignette.

- **Fits:** SaaS, design tools, B2B product brands, modern startups.
- **Doesn't fit:** editorial/premium-content brands (too sterile), loud agencies (too restrained).
- **Fonts:** `Geist` (display) + `Geist` (body) — swap to `Space Grotesk` + `Inter` if Geist renders inconsistently on your server
- **Palette:** near-black `#0A0A0A` bg · white text · purple `#7C3AED` accent · grey `#A0A0A0` muted
- **Background:** radial vignette (Apple-keynote style) fading from accent at `50% 30%` to bg at the edges, plus very subtle grain (intensity `0.06`)
- **Numbering:** `fraction-mono` bottom-right
- **References:** Stripe, Framer, Cal.com, Linear

---

## (C) technical-mono — `templates/presets/technical-mono.json`

Precise, developer-facing, systems-thinking. Mono display type on pure black — code-brutalism distilled.

- **Fits:** dev tools, infra, AI platforms, anything where the audience lives in a terminal.
- **Doesn't fit:** creator brands, lifestyle content, warm/editorial voices — the mono display reads cold in those contexts.
- **Fonts:** `JetBrains Mono` (display) + `Inter` (body)
- **Palette:** pure black `#000000` bg · white text · cyan `#00E5FF` accent · dim grey `#555555` muted
- **Background:** solid black with whisper-light grain (intensity `0.05`) — just enough to kill the vector-flat AI-slop look
- **Numbering:** `fraction-mono` bottom-right — mono numbering on mono display reinforces the aesthetic
- **References:** Vercel v0, Supabase, Replit, Raycast

---

## (D) display-serif-bold — `templates/presets/display-serif-bold.json`

High-contrast editorial. Statement brands, luxury media, NYT-style gravitas. The preset to pick when you want readers to *feel* the weight of the headline before they read it.

- **Fits:** statement brands, luxury, high-impact carousels, media/publishing.
- **Doesn't fit:** utility SaaS, dev tools, anything that needs to feel fast and frictionless.
- **Fonts:** `DM Serif Display` (display) + `Inter` (body)
- **Palette:** deep aubergine `#1A0F2E` bg · warm white `#FFFAF0` text · gold `#FFD23F` accent · warm grey `#9A9A9A` muted
- **Background:** 3-blob mesh gradient — deep purple `#4A1D5C` + magenta `#6B2D7A` + gold `#FFD23F` over the aubergine base. Creates dramatic painterly depth, further textured by grain at intensity `0.1` (noticeably editorial).
- **Numbering:** `bar` progress bar (fits the dramatic pacing — the slide deck reads like a short film)
- **References:** New York Times style, luxury brand carousels, high-impact editorial

---

## (E) utilitarian-bold — `templates/presets/utilitarian-bold.json`

Swiss-minimal. Bold weight, stark contrast, zero decoration. Pentagram / Koto energy — design-systems that trust the grid.

- **Fits:** design studios, bold consultancies, utility-first tools, craft agencies.
- **Doesn't fit:** warm/editorial voices (too cold), dev tools (already covered by C with better fit), anything that needs softness.
- **Fonts:** `Archivo Black` (display) + `Archivo` (body) — heavy weight contrast inside a single family
- **Palette:** stark white `#FFFFFF` bg · black `#000000` text · bright orange `#FF4800` accent · light grey `#999999` muted
- **Background:** solid white, NO grain — keeps it stark and editorial. Any texture would dilute the Swiss clarity.
- **Numbering:** `dot` (minimal geometric pips, bottom-center — matches the utilitarian language)
- **References:** Pentagram, DIA Studio, Koto, Neubau Berlin

---

## Override hooks

The wizard lets the user override any of:
- colors (accent only, or all four)
- background type (solid / gradient / mesh / radial / image)
- grain on/off
- numbering style

Any override layers on top of the preset — the user never has to specify fields they don't care about. To edit manually after setup, see `docs/brand-profile-schema.md`.
