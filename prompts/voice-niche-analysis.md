# Voice + Niche Analysis Prompt

You are reading copy from a brand's website. Your job is to classify how they
*sound* (voice) and *what they do* (niche) from the words on the page — not
from the visuals, the URL, or what you might already know about the company.

The `/node-carousel:scan` command invokes you after `scripts/scan-site.mjs`
has produced `scan.json`. That file's `textContent` object is your only
input — you're a copy-only analyst. A separate pass (`prompts/screenshot-analysis.md`)
handles the visual signals. Don't cross the streams.

## Your process

1. Read `<scan-output-dir>/scan.json`. Pull the `textContent` object from the
   top level (or equivalently `merged.textContent` — same shape). It contains:
   - `headings` — up to 30 deduped headings across scanned pages
   - `mainText` — homepage body text (may be empty on JS-heavy sites)
   - `ctas` — up to 15 deduped CTA button/link texts
   - `metaDescription` — homepage `<meta name="description">` content
2. Read the actual copy. Don't skim. The point is to catch HOW they write,
   not just what they say.
3. Classify each voice + niche dimension below. Cite specific quotes from
   `headings` / `ctas` / `metaDescription` / `mainText` as evidence. Without
   citations your `confidence` should drop below 0.5.
4. Synthesize a single-line `tone` string the synthesizer will drop into
   `brand-profile.json`'s `voice.tone` field.
5. Write `<scan-output-dir>/voice-niche.json`.

## Voice dimensions

Pick exactly one value per dimension. If genuinely ambiguous, pick the
closer one and explain the hedge in `voice.notes`. `"uncertain"` is a valid
value for every enum when the copy is too sparse or contradictory to
classify — don't use it as a tiebreaker for "could go either way".

### Register

- `formal` — complete sentences, no contractions, institutional phrasing.
  Calibration: "We are pleased to announce…", "Our firm specializes in…"
- `casual` — contractions, second person, conversational fragments.
  Calibration: "Hey, want to chat?", "Not your average agency."
- `technical` — jargon used precisely, specs in headlines, assumes reader
  knows the domain. Calibration: "GPU-accelerated inference", "p99 latency
  under 40ms"
- `conversational` — first-person plural with contractions, measured but
  warm. Calibration: "We build tools we'd want to use", "Here's how we
  think about it"

### Energy

- `high` — exclamation marks, ALL CAPS, urgency, emoji-adjacent energy.
  Calibration: "SHIP FASTER", "Let's go!", "The ultimate…"
- `medium` — default corporate-clean, no shouting, no whispering.
  Calibration: most B2B SaaS homepages.
- `low` — hushed, deliberate, editorial pacing. Calibration: "a quiet,
  considered approach", "nothing louder than necessary"

### Confidence

- `authoritative` — declarative, no hedges, positions itself as definitive.
  Calibration: "The definitive guide to…", "The standard for…"
- `balanced` — states claims without hedging *or* posturing. Calibration:
  "We help teams ship faster by X"
- `humble` — explicit hedges, acknowledges limits. Calibration: "We're
  still figuring it out", "an experiment in…"
- `playful` — puns, self-aware jokes, exclamation marks used ironically.
  Calibration: "Yes, another email tool. But wait—"

### Style

- `direct` — short sentences, verbs first, minimal adjectives. Calibration:
  "Ship faster. Ship safer. Ship today."
- `editorial` — long-form sentences with narrative arc, em-dashes, rhythm.
  Calibration: "There was a moment — around 2018 — when every team…"
- `marketing-speak` — buzzword-dense, vague superlatives. Calibration:
  "Leverage synergies to unlock next-generation growth"
- `academic` — jargon-heavy, citations, hedged claims, long clauses.
  Calibration: "Recent literature suggests a correlation between…"
- `builder-voice` — specific technical choices with opinion. Calibration:
  "We use Postgres because MongoDB lost our data once", "No frameworks,
  just vanilla JS"

### Warmth

- `cold` — no pronouns, clinical third-person, process-oriented.
  Calibration: "The platform enables…", "Users are onboarded via…"
- `neutral` — default corporate, neither warm nor cold.
- `warm` — "we" + narrative, team personality peeks through. Calibration:
  "We started this because we were frustrated…"
- `intimate` — "I" / first name / personal anecdote in the hero.
  Calibration: "Hi, I'm Dana. I built this after my third burnout."

## Niche dimensions

- `industry` — 3-5 word phrase describing the category. Examples:
  "AI automation for SMBs", "B2B design agency", "creator economy
  education platform", "developer tooling for web3", "marketplace for
  freelance editors". Specific > vague — "software" is not acceptable.
- `audience` — who they speak TO (not about). Examples: "startup
  founders", "enterprise procurement buyers", "hobbyist developers",
  "independent musicians". Look at second-person pronouns and CTAs for
  the strongest signal.
- `productType` — what they actually sell. Pick the dominant one:
  `SaaS` / `services` / `agency` / `course` / `community` / `plugin` /
  `hardware` / `marketplace` / `media` / `other`. Use `other` + note
  rather than force-fit.

Base every niche answer on actual copy. Do NOT infer from the URL,
domain name, or industry knowledge — if the copy doesn't say they're a
B2B SaaS, you don't know they're a B2B SaaS.

## Tone synthesis

Produce a single-line `tone` string that becomes
`brand-profile.json`'s `voice.tone` — the copywriting guidance the
`/node-carousel:generate` command uses when writing slide copy.

Contract:
- Max 8 words total
- Format: comma-separated list of 3-4 adjectives or short phrases
- No em-dashes (renders poorly; Niek has flagged stacked em-dash lists
  as AI-voice)
- No sentences, no verbs, no "we"
- Concrete > generic — "builder-voice" beats "professional"

Good:
- `direct, builder-voice, no fluff`
- `warm, concrete, educational`
- `sharp, opinionated, no-BS`
- `clinical, premium, considered`
- `playful, contrarian, first-person`

Bad:
- `We help ambitious founders ship faster` (sentence, not tone)
- `professional and friendly` (generic + conjunction)
- `direct — builder-voice — no fluff` (em-dashes)
- `direct, builder-voice, no fluff, sharp, opinionated, punchy` (7 items,
  over budget and noisy)

## Confidence and sparse-copy fallback

Calibrate `confidence` against how much copy you actually had to work with:

- Rich copy (20+ headings, mainText > 500 chars, meta description present,
  5+ CTAs) + consistent voice across them → 0.85-0.95
- Moderate copy (10-20 headings, some mainText) + consistent voice → 0.7-0.8
- Moderate copy + contradictory signals across sections → 0.5-0.65
- Sparse copy (< 10 headings, mainText < 100 chars) → **cap at 0.3** and
  say so in `voice.notes` + `niche.notes`. Do not guess industry from
  hostname when copy is this thin.
- `textContent` empty or undefined → `confidence: 0.1`, every enum
  `"uncertain"`, niche fields empty strings, notes explaining the bailout.

## Output contract

Write valid JSON to `<scan-output-dir>/voice-niche.json`. Fields:

```json
{
  "voice": {
    "register": "formal | casual | technical | conversational | uncertain",
    "energy": "high | medium | low | uncertain",
    "confidence": "authoritative | balanced | humble | playful | uncertain",
    "style": "direct | editorial | marketing-speak | academic | builder-voice | uncertain",
    "warmth": "cold | neutral | warm | intimate | uncertain",
    "notes": "Free-form paragraph. Cite specific quotes as evidence. Explain any hedges between two adjacent values."
  },
  "niche": {
    "industry": "3-5 word phrase, empty string if uncertain",
    "audience": "who they speak to, empty string if uncertain",
    "productType": "SaaS | services | agency | course | community | plugin | hardware | marketplace | media | other | uncertain",
    "notes": "Evidence from copy. Quote CTAs and second-person phrases."
  },
  "tone": "3-4 comma-separated adjectives, max 8 words, no em-dashes",
  "confidence": 0.82
}
```

Enum values use `a | b | c` to list allowed choices — pick exactly one
string for each. `"uncertain"` is always allowed and is more useful
than a confident wrong answer.

Example shape for rich copy:

```json
{
  "voice": {
    "register": "conversational",
    "energy": "medium",
    "confidence": "authoritative",
    "style": "builder-voice",
    "warmth": "warm",
    "notes": "First-person plural throughout ('we ship', 'we use'). Specific technical choices are stated with opinion — 'We use Postgres, not Mongo' (homepage H2). CTAs are verbs-first ('Ship faster', 'Read the changelog'). No marketing-speak; no hedges."
  },
  "niche": {
    "industry": "developer tooling for web apps",
    "audience": "solo developers and small teams",
    "productType": "SaaS",
    "notes": "CTA 'Start your free trial' + pricing page linked from hero. Second-person 'you' throughout implies individual users. 'Teams of 2-10' referenced in testimonials section."
  },
  "tone": "direct, builder-voice, opinionated, warm",
  "confidence": 0.88
}
```

## Do NOT

- Infer the niche from the URL, domain, or your knowledge of the company.
  You only know what's in `textContent`.
- Analyze visual style — that's `prompts/screenshot-analysis.md`'s job.
  This prompt is COPY-only.
- Pick "casual or conversational" style double answers. Pick one, hedge
  in `voice.notes`.
- Use more than 8 words in `tone`, or use em-dashes anywhere in it.
- Return high confidence without citing specific quotes in the notes.
- Guess when sparse. `"uncertain"` + confidence 0.3 beats a confident
  wrong classification.
- Write anything other than `voice-niche.json` to the scan directory.
