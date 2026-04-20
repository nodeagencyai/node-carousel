# /node-carousel:export

Export SVG slides to PNG files ready for Instagram upload.

**User's request:** $ARGUMENTS

## Behavior

### Step 1: Determine which output to export

- **If `$ARGUMENTS` contains a path** (e.g. `./output/my-topic/`): use that as the slides dir
- **If `$ARGUMENTS` contains a slug** (e.g. `5-mistakes-founders`): use `./output/<slug>/`
- **If empty:** find the most recently modified directory under `./output/` and use that. Print which one you picked.

Verify the dir exists and contains at least one `slide-*.svg` file. If not, error clearly: "No slides found in `<path>`. Run `/node-carousel:generate <topic>` first."

### Step 2: Check Puppeteer availability

```bash
test -d "${PLUGIN_ROOT}/scripts/node_modules/puppeteer"
```

- **Installed:** proceed to Step 4
- **Not installed:** proceed to Step 3

### Step 3: Offer to install Puppeteer

Ask the user:
> Puppeteer is needed for PNG export (downloads ~170MB of Chromium). Install now? (y/N)
>
> Alternative: open `./output/<slug>/preview.html` in your browser and right-click each slide → Save As Image.

- **If yes:**
  ```bash
  cd "${PLUGIN_ROOT}/scripts" && npm install
  ```
  Wait for completion. On failure, fall through to the manual fallback.

- **If no:** open `./output/<slug>/preview.html` in the browser and tell the user to save each slide manually. Stop.

### Step 4: Run the export

```bash
node "${PLUGIN_ROOT}/scripts/export-png.mjs" ./output/<slug>/
```

The script:
- Reads each `slide-*.svg`
- Determines dimensions from the SVG's `viewBox`
- Renders each in Puppeteer at `deviceScaleFactor: 2` (retina) — override with `CAROUSEL_SCALE=1` env if the user wants 1×
- Waits for Google Fonts to load (default 1500ms — override with `CAROUSEL_FONT_WAIT_MS=3000` for slow connections)
- 15s per-slide timeout; continues on failure
- Saves `slide-NN.png` next to each SVG

### Step 5: Report

On success:
```
✓ Exported 7 PNGs to ./output/5-mistakes-founders/
  slide-01.png through slide-07.png (1080×1350 @ 2x)
```

On partial failure (some slides exported, some didn't):
- Tell the user which failed and why
- Suggest running again or exporting the preview manually for the failed ones

On total failure:
- Print the error
- Fall back to opening preview.html and instructing manual save

## Edge cases

- **SVG references external image that doesn't resolve** (e.g. `imagePath` in brand profile points to a missing file): the PNG will render with a broken-image placeholder. Flag it to the user but don't fail the whole export.
- **Multiple output dirs exist and `$ARGUMENTS` is empty:** pick the most recently modified but print which one and offer to switch: "Exporting `<slug>` (last modified Apr 20 14:30). Run with a slug argument to pick a different one."
- **Puppeteer download fails** (network, permissions): surface the error verbatim, suggest `--unsafe-perm` or checking corporate firewall.

## Do not

- Auto-install Puppeteer without confirmation (170MB is not trivial)
- Delete the SVG files after PNG export — users may want both
- Modify files outside `./output/<slug>/`
- Touch `~/.claude/` or existing plugins
