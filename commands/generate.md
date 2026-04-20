# /node-carousel:generate

Generate a full Instagram carousel from a topic: strategy → slides → preview → caption.

**User's request:** $ARGUMENTS

## Behavior

### Step 1: Preflight

Check `./brand-profile.json` exists in the current working directory.
- **If missing:** tell the user "No `brand-profile.json` found here. Run `/node-carousel:setup` first to configure your brand." Stop.
- **If malformed:** run the render script against it once (`node ${PLUGIN_ROOT}/scripts/render.mjs ./brand-profile.json /dev/null /tmp/nc-preflight/`) to surface the user-facing validation error, then stop.

### Step 2: Parse the topic

From `$ARGUMENTS`:
- If it's a full topic (e.g. "5 mistakes new founders make with AI automation"), use it as-is
- If it's vague (e.g. "AI stuff" or empty), ask one clarifying question: "What's the carousel about? Give me a one-sentence topic or claim."

### Step 3: Research (optional, offer)

Ask: "Want me to do 1–2 web searches for real data/examples on this topic? (y/N)" — default no.

If yes: run WebSearch for 1–2 concrete queries tied to the topic. Use results to inform angles + any `stat` slides. Do NOT invent stats without a source — if no real stat comes up, skip the stat template.

If no: proceed with what the user gave you.

### Step 4: Propose 2–3 angles

Based on topic + (optional) research, draft 2–3 different angles the carousel could take. Each angle is 1 sentence.

Example for topic "AI automation":
1. **Contrarian take** — "Most AI automation is just expensive Zapier" (challenges assumptions)
2. **Founder mistakes** — "5 ways AI projects fail in production" (cautionary tale)
3. **What actually ships** — "The 4 traits of AI automations that survive month 2" (positive framing)

Present them. Let the user pick one, or combine, or reject all and try different angles. Do NOT generate until they confirm.

### Step 5: Build the strategy

Read `${PLUGIN_ROOT}/prompts/strategy-system.md` — that is your system prompt for strategy generation.

Read `./brand-profile.json` — use `brand.tone` to match voice.

Produce the strategy as a JSON object. Write it to `./output/<slug>/strategy.json`, where `<slug>` is the topic kebab-cased (lowercase, spaces → hyphens, punctuation stripped, truncated to ~60 chars).

Example: topic "5 mistakes new founders make with AI automation" → slug `5-mistakes-new-founders-make-with-ai-automation`.

Show the strategy to the user. Ask for OK. If they request changes, iterate on the JSON. Common edits: rewording a hook, splitting a busy bullet slide into two, swapping a stat for a quote.

### Step 6: Render the slides

Once strategy is approved:
```bash
mkdir -p ./output/<slug>
node ${PLUGIN_ROOT}/scripts/render.mjs ./brand-profile.json ./output/<slug>/strategy.json ./output/<slug>/
```

Render outputs `slide-01.svg` through `slide-NN.svg` in the output dir.

### Step 7: Build preview

```bash
node ${PLUGIN_ROOT}/scripts/preview.mjs ./output/<slug>/
```

This creates `./output/<slug>/preview.html`.

### Step 8: Open preview

```bash
open ./output/<slug>/preview.html     # macOS
xdg-open ./output/<slug>/preview.html # Linux
```

If opening fails silently, just print the absolute path and tell the user to open it.

### Step 9: Review round

Ask the user: "How does it look? Any slide that's off?"

Common feedback patterns:
- "Slide 3 is weak" → regenerate that one slide's content, rerun render
- "Headline on slide 1 doesn't punch" → swap it, re-render only slide 1 (`node render.mjs` on a strategy with just that slide, then copy the single SVG in)
- "Too long, drop slide 5" → edit strategy.json, re-render
- "Perfect" → proceed to caption

### Step 10: Write the caption

Read `${PLUGIN_ROOT}/prompts/caption-system.md` — that is your system prompt for captions.

Generate the caption based on the strategy + brand profile. Write to `./output/<slug>/caption.txt`.

Show the caption to the user. Ask for OK. If they want tweaks, iterate.

### Step 11: Report

Tell the user where everything lives:
- Slides: `./output/<slug>/slide-*.svg`
- Preview: `./output/<slug>/preview.html`
- Caption: `./output/<slug>/caption.txt`
- Strategy (for later edits): `./output/<slug>/strategy.json`

Suggest next step: "Run `/node-carousel:export` to produce PNG versions ready for Instagram upload."

## Edge cases

- **Topic contains filesystem-unsafe chars** (`/`, `<`, `>`, etc.): strip them from the slug
- **Slug collides with existing output dir:** ask user "Output for this topic already exists. Overwrite or use a suffix like `-v2`?"
- **Strategy has 0 slides:** shouldn't happen if you followed the system prompt, but guard against it — print error and ask to retry
- **First slide isn't `title` or last slide isn't `cta`:** the strategy prompt is emphatic about this, but if the generated JSON violates it, fix silently before writing
- **Render script errors:** surface the error to the user verbatim — the script has user-facing messages by design

## Do not

- Skip the angle approval step — users want input on direction before slides get generated
- Write invented stats — only use numbers from research or the user
- Modify `brand-profile.json` during this command (setup owns it)
- Put outputs anywhere except `./output/<slug>/` in CWD
- Touch `~/.claude/` or existing plugins
