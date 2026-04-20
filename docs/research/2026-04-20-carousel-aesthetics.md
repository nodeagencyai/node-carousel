# Premium Instagram Carousel Aesthetics — April 2026

Research brief for the `node-carousel` setup wizard. Answers: **"What aesthetic options should the wizard expose, and what concrete SVG/CSS techniques implement them?"**

---

## Executive summary

Premium 2026 carousels are defined less by *what they contain* and more by the three things cheap ones get wrong: flat vector aesthetics (no noise/grain/texture), predictable centered layouts (no asymmetry or compositional tension), and generic sans-serif-on-gradient color systems. The current high-signal aesthetic families are (1) **Technical Mono / code-brutalism** (Vercel, playerzero, v0), (2) **editorial serif revival** (Instrument Serif, Tiempos, DM Serif paired with Inter/Geist), (3) **grainy-gradient softness** (noise layered on radial/mesh gradients — Stripe, Perplexity, Arc), and (4) **Swiss-minimal with asymmetric editorial layout** (Koto, Pentagram-style). What separates "premium" from "template-feeling" in 2026 is *texture, typographic confidence, and restraint on color* — not better gradients. Audiences are actively allergic to "AI slop" — the blue-gradient + centered-sans-serif + rounded-corner look — and reward visible craft (grain, ragged text, oversized numerals, single accent).[^aislop]

---

## State of the art — creators/brands to benchmark against

1. **Vercel** — Technical Mono exemplar: near-black backgrounds, monospace accents, green-on-black code-snippet vibes, aggressive whitespace, numeric/ticker details. Led by Evil Rabbit.[^techmono]
2. **Linear** — monochrome purple/greyscale, single hero accent, Inter + Söhne, zero decoration, extreme whitespace discipline.
3. **Arc Browser (The Browser Company)** — soft purple/warm gradients, rounded-but-not-cute, purposeful typography, high respect for negative space.[^arc]
4. **Raycast** — dark with red/orange accent, crisp type, monospaced numerals, iconography over photography.
5. **Framer** — mesh-gradient backgrounds, bright color over dark, Inter Tight / editorial-style headings.
6. **Stripe** — pioneered the animated color-mesh gradient hero; relies on conic + radial gradient layers for depth.[^meshgrad]
7. **Perplexity (Instagram)** — "dreamy eerie softness" camp: grainy gradients, low-contrast imagery, ethereal palette.[^techmono]
8. **Cal.com** — flat bright accent on near-white, almost brutalist clarity, type-led.
9. **Justin Welsh (LinkedIn/IG)** — deliberately plain: white bg, heavy black sans headline, tiny accent bar, extreme consistency. Recognizable from thumbnail alone.[^welsh]
10. **Lenny Rachitsky** — book-cover-editorial: serif headlines, lots of white space, 1 photo + 1 pull quote, slow rhythm.
11. **Koto Studio** — colorful-but-restrained brand systems, oversized display type, plenty of mixed grotesk/serif pairings.
12. **Pentagram (Cohere identity et al.)** — systematized visual motifs (cells, grids, marks) that repeat across slides as identity anchor, not decoration.[^pentagram]

---

## Aesthetic patterns taxonomy

### A. Backgrounds

#### A1. Flat solid
- **Description:** Single color. No texture, no gradient. The defining move of Cal.com / Justin Welsh.
- **When:** Bold typographic brands, editorial content, "I'm confident enough not to decorate" posture.
- **When NOT:** Brands trying to feel warm, human, or analog — flat reads sterile if the type isn't strong.
- **SVG:** `<rect fill="#0f0f0f" .../>` — already implemented.
- **References:** Cal.com, Linear (light mode), Welsh.

#### A2. Linear gradient
- **Description:** Two-stop gradient, diagonal. The default "I need this to feel designed" move — now overdone.
- **When:** Rarely on its own; better as a base layer under grain.
- **When NOT:** If the two colors are standard "blue-to-purple" or "pink-to-orange" — reads immediately as Canva template.
- **SVG:** `<linearGradient>` with stops. Already implemented.
- **References:** 2018-era Stripe, most template marketplaces.

#### A3. Radial gradient (Apple-keynote vignette)
- **Description:** Soft glow concentrated off-center, fading to near-solid at edges. Feels like a spotlight on a stage.
- **When:** Dark backgrounds where you want a subtle hero focal point without texture. Apple's keynote slides are the canonical reference.
- **When NOT:** High-energy bright palettes; the softness reads timid.
- **SVG:**
  ```xml
  <radialGradient id="glow" cx="30%" cy="25%" r="70%">
    <stop offset="0%" stop-color="#1a3a4a" stop-opacity="1"/>
    <stop offset="100%" stop-color="#0a0a0a" stop-opacity="1"/>
  </radialGradient>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  ```
- **References:** Apple keynotes, Vercel hero sections, Linear dark mode.[^radial]

#### A4. Mesh gradient (blob gradient)
- **Description:** 3-5 organic color blobs blurred and blended. Stripe's signature look, now pervasive across Framer, Vercel marketing pages.[^meshgrad]
- **When:** Brands that want "modern, soft, premium" without committing to a single hero color. Good for tech-with-warmth.
- **When NOT:** Editorial/serious brands, news-voice content — reads pop-startup.
- **SVG:** Layer 3-5 large `<ellipse>` elements with `feGaussianBlur` filter, each with a different brand color, positioned irregularly. Wrap in a clipPath of the canvas.
  ```xml
  <filter id="blur"><feGaussianBlur stdDeviation="120"/></filter>
  <g filter="url(#blur)">
    <ellipse cx="200" cy="300" rx="400" ry="300" fill="#29F2FE" opacity="0.7"/>
    <ellipse cx="900" cy="1000" rx="500" ry="400" fill="#FF3B6B" opacity="0.6"/>
    <ellipse cx="600" cy="700" rx="350" ry="350" fill="#7B5CFF" opacity="0.5"/>
  </g>
  ```
- **References:** Stripe, Framer, Vercel, most AI startup landing pages 2026.

#### A5. Grainy gradient (noise + gradient)
- **Description:** Any gradient above, with a noise/grain filter overlaid at low opacity. The single biggest visual upgrade available — kills the "vector flatness" that screams AI slop.[^grain][^cssgrain]
- **When:** Almost always, if your brand reads "premium" or "editorial." This is the 2026 move.
- **When NOT:** Pure utilitarian/data brands where grain reads as noise-for-the-sake-of-it.
- **SVG:** `feTurbulence` + `feColorMatrix` to desaturate + composite onto gradient with low opacity (8-15%).
  ```xml
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.12 0"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#grain)"/>
  ```
  Layer this `<rect>` over the gradient rect.
- **References:** Perplexity IG, Arc, Frontend Masters blog, every 2026 SaaS hero.[^grain]

#### A6. Paper/texture background
- **Description:** Off-white (`#F8F5F0`, `#EFEAE0`) with subtle paper grain. Editorial feel. Essentially grainy-gradient with a single warm-neutral base.
- **When:** Book-voice content, editorial brands, long-read authority (Lenny Rachitsky vibe).
- **When NOT:** Tech/product brands — reads magazine, not software.
- **SVG:** Solid warm-neutral rect + `feTurbulence` grain at ~6% opacity.
- **References:** Lenny, many Substack-adjacent newsletters, bookstore/publisher IG.

#### A7. Bento split
- **Description:** Background divided into 2-4 color zones (horizontal, vertical, or L-shape). Content lives in one zone.[^bento]
- **When:** Lists, comparisons, before/after, feature grids. Works especially well on 1-slide teaser frames.
- **When NOT:** Narrative/story slides where the split fragments the reading flow.
- **SVG:** Multiple `<rect>` elements tiling the canvas in a grid. Foreground text positioned in the largest cell.
- **References:** Apple product pages, Vercel feature grids, Mockuuups examples.[^bento]

#### A8. Floating accent shapes (decorative geometry)
- **Description:** 1-3 blurred circles/ellipses floating off-center as color accents. Sibling of mesh gradient but more controlled — 1-2 shapes instead of a full blend.
- **When:** Brands wanting energy without committing to full mesh chaos. Works for single-accent palettes.
- **When NOT:** Minimalist brands — any decoration betrays the voice.
- **SVG:** 1-2 `<ellipse>` with `feGaussianBlur` at `stdDeviation=80-150`, positioned to feel intentional (not centered, usually touching the edge).
- **References:** Raycast marketing, most AI tool landing pages, Linear changelog cards.

#### A9. Duotone photograph overlay
- **Description:** Background photo reduced to 2 colors (usually brand accent + dark) via `feColorMatrix`.
- **When:** Content where a specific photo is central but needs to fit the brand system.
- **When NOT:** Systems without imagery or where the photo needs to be literal.
- **SVG:** `<image>` + `<feColorMatrix>` filter mapping luminance to two colors.
  ```xml
  <filter id="duotone">
    <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0"/>
    <feComponentTransfer>
      <feFuncR tableValues="0.06 0.16"/><!-- dark → accent.r -->
      <feFuncG tableValues="0.06 0.94"/>
      <feFuncB tableValues="0.12 0.99"/>
    </feComponentTransfer>
  </filter>
  ```
- **References:** Spotify Wrapped, FIU blog examples.[^duotone]

#### A10. Blurred photograph
- **Description:** Photo background with heavy gaussian blur, used as color/mood source rather than content.
- **When:** Hero cover slides, quote slides where you want depth without distraction.
- **When NOT:** Any slide where the text needs max contrast — the blur isn't a contrast layer.
- **SVG:** `<image>` + `feGaussianBlur stdDeviation="40"` + dark overlay `<rect opacity="0.4">`.
- **References:** Editorial newsletters, lifestyle brand IG.

---

### B. Typography

#### B1. Editorial serif display
- **Fonts:** Instrument Serif, DM Serif Display, Playfair Display, Tiempos Headline (paid).[^tiempos][^serifrevival]
- **Description:** High-contrast serifs used at 80-160pt for headlines. Paired with Inter or Geist for body.
- **When:** Long-form, thought-leadership, founder voice, editorial brands.
- **When NOT:** Technical/product/developer content — reads wrong for that voice.
- **SVG:** `font-family="Instrument Serif"` on `<text>`. Google Fonts.
- **References:** Lenny, NY Times IG, most 2026 AI brand refreshes (Instrument Serif is everywhere).

#### B2. Neo-grotesk (technical confidence)
- **Fonts:** Inter, Söhne (paid), Söhne Mono, Geist, Space Grotesk, Aktiv Grotesk.[^swiss]
- **Description:** Clean sans with slight warmth, used at all sizes. Not geometric (Avenir, Futura) — those feel dated now.
- **When:** Product/tech brands, developer tools, SaaS, startup content.
- **When NOT:** Editorial/lifestyle where serifs carry the voice.
- **SVG:** Standard `font-family="Inter"`.
- **References:** Linear, Vercel, Raycast.

#### B3. Monospace hero (Technical Mono)
- **Fonts:** JetBrains Mono, Geist Mono, IBM Plex Mono, Berkeley Mono.
- **Description:** Monospace used for HEADLINES, not just code. Tight tracking. Often paired with ASCII accents (`>`, `//`, `[ ]`).[^techmono]
- **When:** Developer tools, AI/infra brands, anything that wants "built by engineers" signal.
- **When NOT:** Consumer/lifestyle brands — reads cold/technical to non-devs.
- **SVG:** `font-family="Geist Mono"` on headline text. Consider tracking -1 to -2%.
- **References:** Vercel, playerzero, v0, Factory AI.

#### B4. Mixed (serif + mono, or serif + sans)
- **Description:** Two different typefaces used deliberately for different hierarchy levels — e.g. serif for headline, mono for kicker/label, sans for body.
- **When:** Sophisticated brand systems, agencies, magazines.
- **When NOT:** Unless you commit to the pairing on every slide — one-offs read chaotic.
- **SVG:** Multiple `font-family` declarations per `<text>` element.
- **References:** Koto, Pentagram, most modern editorial brands.

#### B5. Oversized first letter / dropcap
- **Description:** First letter 2-4× headline size as a graphic element.
- **When:** Editorial / book-voice. Works beautifully with serifs.
- **When NOT:** Short punchy brand voice — the dropcap implies long-form.
- **SVG:** Two `<text>` elements: one large letter, one rest of headline. Manual positioning.

#### B6. Colored/italicized accent word
- **Description:** One word in the headline gets color or italic emphasis. Pull-quote technique.
- **When:** Always a safe upgrade to plain headlines. Used universally.
- **SVG:** Multiple `<tspan>` inside one `<text>`, with different `fill` or `font-style`.

#### B7. Oversized number hero
- **Description:** Number (stat, slide count, year) at 300-500pt, dominating the composition. Text becomes supporting copy.[^bignumber]
- **When:** Stat slides, data carousels, milestone content ("$1M", "Year 3", "10× growth").
- **When NOT:** Overused — works 1-2× per carousel, not every slide.
- **SVG:** Single huge `<text>` at `font-size="420"`, offset partially off-canvas. Smaller text layered on top.
- **References:** DesignRush infographic trends, most 2026 "by the numbers" posts.[^bignumber]

---

### C. Visual motifs

#### C1. Slide numbering
- **Minimal dot:** `• • • •` with active dot filled, passive dots outlined. Bottom of slide.
- **Fraction:** `03 / 08` in monospace, top-right or bottom-left.
- **Large number hero:** The number IS the visual (see B7).
- **Progress bar:** Thin horizontal line, filled % = current slide. Top or bottom edge.
- **None:** Justin Welsh–style, trusting the reader.
- **SVG:** All simple — `<circle>` for dots, `<text>` for fractions, `<rect>` for progress bar.
- **Recommendation:** Monospace fraction (`03/08`) is the most 2026-feeling option. Numbering matters: it drives completion behavior.[^numbering]

#### C2. Dividers
- **Thin rule:** `<line stroke-width="1">` — Swiss/editorial.
- **Color block:** Small accent-color square/rectangle as visual anchor.
- **Double rule:** Two parallel thin lines — newspaper/editorial.
- **No divider:** Whitespace alone — confident minimalism.
- **Recommendation:** Thin rule or color block — avoid decorative icons.

#### C3. Accent shapes / frame marks
- **Corner marks:** Small L-shape brackets at each corner (Swiss photographic framing). Reads premium.
- **Underlines / highlight blocks:** Solid color rectangle behind a word.
- **Arrow / chevron:** Only if directional cue is actually needed. Often played-out.
- **Icon systems:** Stick to line-icons (Lucide, Phosphor) at consistent weight; avoid filled/colored icon pills.

#### C4. Brand mark placement
- **Bottom-right handle:** Standard, unobtrusive.
- **Top-left logo + bottom-right handle:** Editorial / newspaper.
- **End-card only:** Clean slides, brand appears only on final CTA slide. Most premium option if you can trust audience memory across carousel.

---

### D. Color strategies

#### D1. Monochrome + single accent
- 1 dark (or 1 light), 1 mid-grey, 1 saturated accent. Accent used sparingly — on 1-2 words per slide, or single motif.
- **References:** Linear (purple), Raycast (red), Cal.com (blue), Node (cyan).
- **When:** Default recommendation for 80% of brands. Hardest to mess up.

#### D2. Duotone palette
- 2 colors only, usually 1 dark + 1 bright. All imagery duotoned (see A9).
- **References:** Spotify Wrapped, music/event brands.
- **When:** Image-heavy carousels; wrong for pure-type content.

#### D3. Restrained editorial (3-4 colors)
- 1 bg, 1 text, 1 muted, 1 accent — maybe 1 secondary accent for variety.
- **When:** Most brands land here. Current wizard default.

#### D4. Gradient-driven (colors are the hero)
- Palette designed to mesh together, colors ARE the decoration. 3-5 gradient stops feature prominently.
- **References:** Stripe, Vercel, Framer marketing.
- **When:** Abstract tech/product brands without a strong photo library.

#### D5. Photo-driven
- Colors extracted from central imagery; everything else (type, accents) stays neutral.
- **When:** Product-centric content, travel, food, fashion.

---

## 2026-specific trends

1. **Grain/noise texture comeback.** The single most cited 2026 upgrade. Kills vector flatness. Implementable with one `feTurbulence` filter.[^grain][^cssgrain]
2. **Serif revival for tech brands.** Instrument Serif, Tiempos, DM Serif Display — tech brands using editorial serifs (not just lifestyle brands) signals "we have taste."[^serifrevival][^tiempos]
3. **Technical Mono / code-brutalism.** Monospace, near-black, ticker-style numerics, ASCII decorations. Started with Vercel; now everywhere in AI/infra.[^techmono]
4. **Oversized numerals as hero.** 300-500pt numbers dominating compositions. Works because numbers photograph/thumbnail well.[^bignumber]
5. **Bento splits** applied to social (not just web). 1 slide can be 4 cells, each a mini-asset.[^bento]
6. **Mesh gradients reaching maturity.** No longer novel but now the default premium background — especially layered with grain.[^meshgrad]
7. **Asymmetric editorial layouts.** Text ragged-left or ragged-right instead of centered. Swiss-grid influence. Centered = template-feeling in 2026.

---

## Played-out patterns to avoid

1. **Blue → purple diagonal gradient.** The definitive "AI slop" signal. Every Canva template, every autogenerated thumbnail.[^aislop]
2. **Centered sans-serif + centered text + rounded emoji.** The Pinterest-infographic look. Reads cheap.
3. **Soft-rounded buttons / pills everywhere.** Especially in hex colors like `#4285F4`. Reads generic SaaS.
4. **Unicode emoji as bullet markers** (☑, ✅, 🔥, 💡). Calvin-Klein-brand accounts don't use them; neither should tech brands aiming for premium.
5. **3-color gradient on every slide.** Over-decoration. Pick one background treatment and stick to it; vary content, not chrome.
6. **Big arrow "SWIPE →" decorations.** Audience knows it's a carousel. Arrow begs attention instead of earning it.
7. **Stock-photo business-person imagery.** Unless your brand explicitly uses editorial photography, any stock photo reads template.

---

## Recommended wizard questions (concrete output)

The current wizard has ~4 questions (brand basics, colors, fonts, background-type). Here's the expanded question set:

### Q1. Brand voice (determines downstream defaults)
> **How does your brand sound when it talks?**
> - (A) **Technical / product** — builder voice, direct, infra/AI/developer audience *(Linear, Vercel, Raycast)*
> - (B) **Editorial / thought-leader** — long-form, book-voice, authority *(Lenny Rachitsky, NYT)*
> - (C) **Founder-direct** — plain, punchy, no decoration *(Justin Welsh, Sahil Bloom)*
> - (D) **Creative / studio** — expressive, mixed type, color-driven *(Koto, DIA Studio)*
> - (E) **Lifestyle / consumer** — warm, photo-forward, approachable

*Maps to: font pairing default, background default, accent-shape default. This is the single most useful question — it cascades into all others.*

### Q2. Color strategy
> **Pick your palette approach:**
> - (A) **Dark + one bright accent** — near-black bg, one saturated color *(Node default)*
> - (B) **Light editorial** — off-white bg, warm neutrals, one accent *(Lenny)*
> - (C) **Monochrome** — greyscale only, literally no hue *(Calvin Klein IG, Apollo.io)*
> - (D) **Duotone** — two colors, high contrast *(Spotify Wrapped)*
> - (E) **Custom 4-color** *(current wizard default)*

*Maps to: pre-filled hex values + behavior on image duotoning.*

### Q3. Background treatment
> **How should slide backgrounds feel?**
> - (A) **Flat color** — clean, confident, nothing to decorate *(Cal.com, Welsh)*
> - (B) **Soft radial glow** — subtle spotlight, Apple-keynote vibe *(Vercel dark)*
> - (C) **Mesh gradient** — abstract blobs, modern premium *(Stripe, Framer)*
> - (D) **Grainy** — any of the above + film grain overlay *(Perplexity, Arc)*
> - (E) **Paper texture** — warm off-white + subtle grain *(editorial newsletters)*
> - (F) **Bento split** — 2-color zoned background *(Apple product pages)*

*Maps to: `background.type` + noise filter flag + gradient geometry.*

### Q4. Typography pairing
> **Pick your type voice:**
> - (A) **Editorial serif + clean sans** — `Instrument Serif` + `Inter` *(most premium default)*
> - (B) **Neo-grotesk only** — `Inter` both roles *(tech/product clarity)*
> - (C) **Technical mono display** — `Geist Mono` headlines + `Inter` body *(infra/AI)*
> - (D) **Bold display serif** — `DM Serif Display` + `Manrope` *(authority)*
> - (E) **Bold utilitarian** — `Archivo Black` + `Archivo` *(zines, posters)*

*Maps to: `fonts.display` + `fonts.body` Google Fonts declarations.*

### Q5. Headline emphasis style
> **How should headlines emphasize key words?**
> - (A) **Accent color on one word** *(default)*
> - (B) **Italic on one word** — works especially well with serifs
> - (C) **Highlight block** — solid rectangle behind the word
> - (D) **Underline** — editorial/minimal
> - (E) **No emphasis** — trust the sentence

*Maps to: emphasis-rendering rules in the title template.*

### Q6. Slide numbering
> **How should slides be numbered?**
> - (A) **Fraction** — `03 / 08` in monospace corner *(recommended)*
> - (B) **Minimal dots** — `• • • •`, active filled
> - (C) **Progress bar** — thin line at top or bottom
> - (D) **Number is the hero** — 400pt number as visual
> - (E) **None** — Justin-Welsh-style trust

*Maps to: numbering template and default position.*

### Q7. Slide-end treatment
> **How should the final CTA slide feel?**
> - (A) **Your brand + handle, full-screen** *(default)*
> - (B) **Question → answer (save me)**
> - (C) **Save-worthy checklist recap**
> - (D) **Newsletter/product CTA block**

*Maps to: CTA template variant.*

### Q8. Motif density (single meta-question capturing decoration tolerance)
> **How decorative can slides get?**
> - (A) **Austere** — no shapes, no decoration, type only *(Welsh, Linear)*
> - (B) **Restrained** — 1-2 accent shapes or marks per slide *(Raycast, Cal.com)*
> - (C) **Expressive** — mesh gradients, grain, corner marks, dropcaps *(Koto, editorial)*

*Maps to: global decoration flag that gates use of floating shapes, corner marks, dropcaps, etc.*

---

## Implementation priority for v0.2

Ranked by impact × implementation effort:

1. **[HIGH] Grain/noise filter** — single `<filter>` block added to every template. Most visible upgrade, ~20 lines of SVG. Ships immediately as an optional `background.grain: true` flag.[^grain]
2. **[HIGH] Radial gradient + mesh gradient** as new `background.type` values. Both are pure SVG — no new dependencies. Addresses the #1 "template-feel" issue (flat linear gradients).
3. **[HIGH] Font pairings preset system** — Q4 above. Collapse the font-picker into 5 curated presets. Removes decision fatigue; eliminates bad pairings.
4. **[MED] Slide numbering variants** — implement fraction (`03/08`) and minimal-dots as the two non-default options. Fraction is the most "premium 2026" signal.[^numbering]
5. **[MED] Brand voice Q1** — new top-of-wizard question that cascades to defaults for Q2-Q8. Makes the wizard feel intelligent vs. "pick 20 things."
6. **[MED] Oversized-number hero template** — new template variant (`number-hero`) for stat slides. Low effort, high visual impact.
7. **[LOW] Duotone image filter** — `feColorMatrix` filter for user-supplied images. Useful only if image support is actively used.
8. **[LOW] Bento split backgrounds** — new `background.type: "bento"` with zone configuration. More complex; defer.
9. **[LOW] Corner marks / frame decorations** — optional motif. Only if Q8 = "expressive."

**Suggested v0.2 scope:** Items 1-5. That's the wizard overhaul + two new background types + grain filter + numbering variants + voice question. Everything else is v0.3.

---

## Open questions / calls for decision

1. **Paid fonts.** Tiempos, Söhne, Suisse Int'l are *the* premium standards but require licensing. Do we (a) stick to Google Fonts only, (b) allow `fonts.displayUrl` for self-hosted, or (c) ship a doc explaining how to swap?
2. **Branded mesh gradient color math.** For a mesh gradient, do we auto-derive 3-5 blob colors from the brand's `accent` + `accentSecondary`, or ask the user for a "mesh palette" separately?
3. **Image duotoning.** Does the wizard also configure imagery treatment (auto-duotone user photos), or is image styling out-of-scope for v0.2?
4. **Multi-template variation per carousel.** Should every slide use the same background treatment, or should the system auto-vary (e.g. flat for content slides, mesh for cover + CTA)? Recommend: same treatment across slides — variation reads chaotic in a 9-slide carousel.
5. **Grain-intensity slider or binary on/off?** Recommend binary (`grain: true/false`), with a well-tuned default opacity (~0.12). Slider is wizard fatigue.
6. **Light vs dark mode as a first-class switch.** Currently colors are free-form. Worth adding `visual.mode: "dark" | "light"` that changes default contrast rules? Likely yes for the preset system to work.
7. **"Don't know — just pick good defaults" fast path.** Currently Q1 (brand voice) → auto-fills everything. Worth explicitly offering that path at start ("I'll answer 1 question") vs. full 8-question wizard?

---

## Footnotes / references

[^aislop]: ["AI Slop vs. Brands with Soul"](https://misfitinteractive.com/ai-slop-vs-brands-with-soul-2026/) — Misfit Interactive. Defines AI slop as "faceless, generic, optimized for algorithms."
[^techmono]: [Aesthetics in the AI era: Visual + web design trends for 2026](https://medium.com/design-bootcamp/aesthetics-in-the-ai-era-visual-web-design-trends-for-2026-5a0f75a10e98) — Bootcamp / Ioana Teleanu. Canonical taxonomy of 2026 aesthetic families; source for Technical Mono, Dreamy Eerie Softness, and 9 other named aesthetics.
[^arc]: [Arc Browser: Rethinking the Web Through a Designer's Lens](https://medium.com/design-bootcamp/arc-browser-rethinking-the-web-through-a-designers-lens-f3922ef2133e) — Medium.
[^meshgrad]: [Mesh — Create beautiful SVG gradients](https://meshgradient.vercel.app/) + [How To create the Stripe Website Gradient](https://www.bram.us/2021/10/13/how-to-create-the-stripe-website-gradient-effect/).
[^welsh]: [25 Influencers Making Carousels Go Viral in 2026](https://www.amraandelma.com/influencers-making-carousels-go-viral/) — features Welsh, Acosta, Bloom as carousel exemplars.
[^pentagram]: [Pentagram identity for AI platform Cohere](https://www.itsnicethat.com/news/pentagram-cohere-graphic-design-040423) — systematized visual language approach.
[^radial]: [SVG Radial Gradients — W3Schools](https://www.w3schools.com/graphics/svg_grad_radial.asp).
[^grain]: [SVG Filter Effects: Creating Texture with feTurbulence — Codrops](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/) + [Making noisy SVGs — Daniel Immke](https://daniel.do/article/making-noisy-svgs).
[^cssgrain]: [Grainy Gradients — CSS-Tricks](https://css-tricks.com/grainy-gradients/) and [Creating grainy backgrounds with CSS](https://ibelick.com/blog/create-grainy-backgrounds-with-css).
[^duotone]: [How to create duotone images — FIU](https://core.fiu.edu/blog/2026/how-to-create-duotone-images.html) + [Image Duotone: Two-Color Photo Mapping Effects](https://check.town/blog/image-duotone-guide).
[^bento]: [Best Bento Grid Design Examples 2026 — Mockuuups Studio](https://mockuuups.studio/blog/post/best-bento-grid-design-examples/) + [Bento Grid Social Media Templates — Behance](https://www.behance.net/gallery/187150663/Bento-Grid-Social-Media-Templates-6-Layouts).
[^bignumber]: [8 By-the-Numbers Infographic Examples for 2026 — DesignRush](https://www.designrush.com/best-designs/infographics/trends/by-the-numbers-infographics) + [Top Infographic Typography Trends in 2026](https://infographicsdesigners.co.uk/top-infographic-typography-trends-in-2026/).
[^tiempos]: [Best New Serif Google Fonts for 2026](https://lexingtonthemes.com/blog/best-new-serif-google-fonts-2026) + [Popular Fonts Designers Actually Use (2026)](https://madegooddesigns.com/popular-fonts/).
[^serifrevival]: [Typography Trends 2026: Future of Fonts in Web Design](https://www.designmonks.co/blog/typography-trends-2026).
[^swiss]: [50 fonts that will be popular with designers in 2026 — Creative Boom](https://www.creativeboom.com/resources/top-50-fonts-in-2026/).
[^numbering]: [Instagram Carousel Design: Elements for Viral Success — PostNitro](https://postnitro.ai/blog/post/instagram-carousel-design-elements-for-viral-success) + [The Ultimate Guide to Designing a Perfect Instagram Carousel in 2026 — Social Habit](https://www.socialhabitmarketing.com/article-posts/the-ultimate-guide-to-designing-a-perfect-instagram-carousel).
