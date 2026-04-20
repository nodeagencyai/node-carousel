# /node-carousel:setup

Interactive brand wizard that creates `brand-profile.json` in the current working directory. Run this once per project.

**User's request:** $ARGUMENTS

## Behavior

### Step 1: Check for existing brand-profile.json

Check if `./brand-profile.json` exists in the current working directory.

- **If it exists:** ask the user "A `brand-profile.json` already exists here. Overwrite it? (y/N)" — default no. If no, stop and tell them where to edit it manually.
- **If not:** proceed.

### Step 2: Run the wizard

Ask the user for each field below. For each, show the default in parentheses. If they press enter without typing, use the default.

Use `AskUserQuestion` if available for structured questions, otherwise ask conversationally one at a time. Group related questions into one round to reduce friction.

**Round 1 — Brand basics**
- Brand name (default: `Your Brand`)
- Social handle, including `@` (default: `@yourbrand`)
- Tone, one line describing voice (default: `direct, confident, no fluff`)

**Round 2 — Colors**
Ask for 4 hex codes. Give example palettes to make this easier:
- Background color (default: `#0f0f0f` — near-black)
- Text color (default: `#FFFFFF` — white)
- Accent color (default: `#29F2FE` — bright cyan)
- Muted color (default: `#999999` — grey for captions/attributions)

If the user says "I don't know, just pick something good", propose one of:
- **Dark mode Node-style:** bg `#0f0f0f`, text `#FFFFFF`, accent `#29F2FE`, muted `#777777`
- **Light mode editorial:** bg `#F8F5F0`, text `#1A1A1A`, accent `#C84B31`, muted `#777777`
- **Bold monochrome:** bg `#1A1A1A`, text `#FFFFFF`, accent `#F5C518`, muted `#888888`

**Round 3 — Fonts**
Show them: "Fonts come from Google Fonts (free). Default is `Playfair Display` for display headlines and `Inter` for body. Pick different ones?"
- Display font (default: `Playfair Display`)
- Body font (default: `Inter`)

If they want options, suggest pairings:
- `Playfair Display` + `Inter` — editorial, premium
- `DM Serif Display` + `Manrope` — modern serif
- `Space Grotesk` + `Space Grotesk` — tech/builder
- `Instrument Serif` + `Geist` — high-fashion minimal
- `Archivo Black` + `Archivo` — bold, utilitarian

**Round 4 — Background style**
Three options:
1. **Solid color** — the background color from Round 2 (simplest, default)
2. **Gradient** — diagonal gradient between 2 colors
3. **Image** — use a PNG/JPG file as background (with a dark overlay for readability)

If they pick gradient, ask for gradient from-color and to-color (defaults: use background + accent from Round 2, 135° angle).

If they pick image, ask for path to the image. Accept absolute or relative paths. Don't validate that the file exists (they might be setting this up before dropping the image in).

### Step 3: Write brand-profile.json

Write the JSON to `./brand-profile.json` in the CWD. Preserve key order and 2-space indentation to match `templates/brand-profile.default.json`.

Example output:
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
      "muted": "#999999"
    },
    "fonts": {
      "display": "Playfair Display",
      "body": "Inter"
    },
    "background": {
      "type": "solid",
      "color": "#0f0f0f",
      "gradient": {
        "from": "#0f0f0f",
        "to": "#29F2FE",
        "angle": 135
      },
      "imagePath": null
    },
    "dimensions": {
      "width": 1080,
      "height": 1350
    }
  }
}
```

Notes for writing:
- `accentSecondary` — if the user didn't specify, derive a darker shade of `accent` OR default to `#0B8AEE`. Don't ask for it separately (wizard fatigue).
- Always include all three background fields (`color`, `gradient`, `imagePath`) even if only one is active. The render script picks based on `type`. Keeps the file self-documenting.
- `dimensions` stays at 1080×1350 for v0.1.0. Don't expose this in the wizard.

### Step 4: Generate a brand preview

Build a simple brand-preview strategy with 2 slides showing the user's brand in action. Use the render script directly.

Create a temporary strategy at `./brand-preview/strategy.json`:
```json
{
  "slides": [
    { "template": "title", "data": {
      "KICKER": "BRAND PREVIEW",
      "HEADLINE_LINE_1": "Your brand",
      "HEADLINE_LINE_2": "in motion"
    }},
    { "template": "bullet", "data": {
      "HEADLINE": "Three checks",
      "BULLET_1": "Colors feel right",
      "BULLET_2": "Fonts render cleanly",
      "BULLET_3": "Contrast is readable"
    }}
  ]
}
```

Run the render script. The plugin root is where this command file lives; resolve it via `${CLAUDE_PLUGIN_ROOT}` if that env var is set, otherwise use the directory containing the `.claude-plugin/plugin.json` file that was loaded.

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(pwd)/plugin}"  # adjust to real path at runtime
node "${PLUGIN_ROOT}/scripts/render.mjs" ./brand-profile.json ./brand-preview/strategy.json ./brand-preview/
node "${PLUGIN_ROOT}/scripts/preview.mjs" ./brand-preview/
```

### Step 5: Open the preview

```bash
open ./brand-preview/preview.html    # macOS
xdg-open ./brand-preview/preview.html # Linux
```

Fall back to: "Open `./brand-preview/preview.html` in your browser to see the brand preview."

### Step 6: Report

Tell the user:
- `brand-profile.json` created at `<absolute path>`
- Preview opened at `./brand-preview/preview.html`
- If the colors/fonts don't look right, edit `brand-profile.json` directly and re-run `/node-carousel:generate`
- Ready to generate their first carousel with `/node-carousel:generate <topic>`

## Edge cases

- **User is in a dir that already has a `brand-profile.json` pointing to an image path:** pass it through as-is during overwrite check — don't force re-entry if they just want to tweak colors.
- **User provides invalid hex codes** (e.g. `"blue"` or `"#xyz"`): ask again, show an example of valid format.
- **User pastes a color name like "navy":** accept common ones and convert to hex (`navy` → `#000080`). For unknown names, ask for hex.
- **Terminal is non-interactive (no TTY):** fall back to writing the default profile and tell the user to edit it manually.

## Do not

- Validate font names against Google Fonts (pointless network call — users will find out if their font doesn't exist from the preview)
- Create any files outside CWD except the plugin's own files
- Modify `~/.claude/` or any existing plugin installations
- Prompt for `dimensions.width` / `dimensions.height` — locked to 1080×1350 in v0.1.0
