#!/usr/bin/env node
// render-v0.4.mjs — procedural carousel rendering.
// Samples variation axes from a seeded RNG; fills pattern templates with
// tokens + slide data. Determinism: same (brand, topic) → byte-identical SVGs.
//
// Module API:
//   renderCarousel({ brand, strategy, outputDir, pluginRoot })
//     → writes slide-NN.svg + _axes.json to outputDir
//
// CLI:
//   node scripts/render-v0.4.mjs <brand-profile.json> <strategy.json> <output-dir>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TYPE,
  letterSpacingForSize,
  lineHeightForSize,
  fontStack,
} from '../tokens/typography.js';
import { SPACING, opticalSpacing } from '../tokens/spacing.js';
import { CANVAS, GRID, COLS, ANCHORS } from '../tokens/grid.js';
import { buildColorRoles } from '../tokens/color-roles.js';
import { createRng, buildSeed } from '../tokens/seeded-random.js';
import { sampleCarouselAxes } from '../tokens/axes.js';
import {
  fillTemplate,
  escapeXml,
  escapeValues,
  fontUrl,
  buildBackgroundValues,
  renderBackground as renderBackgroundV03,
  renderDecorations,
  renderNumbering,
} from './shared-render.mjs';
import { getIcon } from '../tokens/icon-library.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const MANIFEST = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, 'patterns', 'manifest.json'), 'utf8'),
);
const PATTERN_BY_ID = Object.fromEntries(MANIFEST.patterns.map((p) => [p.id, p]));

// v0.4 extends the v0.3 background enum with three additional types:
//   dot-grid, geometric-shapes, glow-sphere
// Shared-render.mjs still owns solid/gradient/mesh/radial/image so v0.3 stays
// frozen. v0.4-only types are rendered by `renderBackgroundV04` below.
const V04_BACKGROUND_TYPES = new Set(['dot-grid', 'geometric-shapes', 'glow-sphere']);
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Validate a brand profile for v0.4-specific extensions.
 *
 * Only validates the 3 NEW background types + grain (which v0.3 also handles but
 * we re-check defensively). Falls back to permissive "don't break existing
 * profiles" on missing/optional fields — everything has a sensible default.
 *
 * For `solid/gradient/mesh/radial/image`: v0.3 render.mjs owns that validation;
 * here we just skip — render-v0.4 may be called with v0.3-era brand profiles.
 */
export function validateBrand(brand) {
  const schemaRef = 'See docs/brand-profile-schema.md for the full schema.';
  const fail = (msg) => {
    throw new Error(`Invalid brand-profile.json: ${msg}. ${schemaRef}`);
  };
  if (!brand || typeof brand !== 'object') fail('expected an object');
  const bg = brand?.visual?.background;
  if (!bg || typeof bg !== 'object') return;
  const type = bg.type;
  if (!V04_BACKGROUND_TYPES.has(type)) return; // v0.3 types handled elsewhere

  if (type === 'dot-grid') {
    // All optional. Validate shape if provided.
    const dg = bg.dotGrid;
    if (dg !== undefined && dg !== null) {
      if (typeof dg !== 'object') fail('background.dotGrid must be an object if present');
      if (dg.spacing !== undefined && (typeof dg.spacing !== 'number' || !Number.isFinite(dg.spacing) || dg.spacing <= 0)) {
        fail('background.dotGrid.spacing must be a positive number');
      }
      if (dg.dotSize !== undefined && (typeof dg.dotSize !== 'number' || !Number.isFinite(dg.dotSize) || dg.dotSize <= 0)) {
        fail('background.dotGrid.dotSize must be a positive number');
      }
      if (dg.dotColor !== undefined && (typeof dg.dotColor !== 'string' || !HEX_RE.test(dg.dotColor))) {
        fail('background.dotGrid.dotColor must be a hex string like "#29F2FE"');
      }
      if (dg.opacity !== undefined && (typeof dg.opacity !== 'number' || !Number.isFinite(dg.opacity) || dg.opacity < 0 || dg.opacity > 1)) {
        fail('background.dotGrid.opacity must be a number between 0 and 1');
      }
    }
  } else if (type === 'geometric-shapes') {
    // shapes is optional; when present must be array of shape objects.
    if (bg.shapes !== undefined && bg.shapes !== null) {
      if (!Array.isArray(bg.shapes)) fail('background.shapes must be an array if present');
      bg.shapes.forEach((s, i) => {
        if (!s || typeof s !== 'object') fail(`background.shapes[${i}] must be an object`);
        // v0.4.1 supports circles only; skip type check but require cx/cy/r numeric
        for (const key of ['cx', 'cy', 'r']) {
          if (s[key] !== undefined && typeof s[key] !== 'number' && typeof s[key] !== 'string') {
            fail(`background.shapes[${i}].${key} must be number or string`);
          }
        }
        if (s.fill !== undefined && typeof s.fill !== 'string') {
          fail(`background.shapes[${i}].fill must be a string`);
        }
      });
    }
  } else if (type === 'glow-sphere') {
    if (bg.glow !== undefined && bg.glow !== null) {
      if (typeof bg.glow !== 'object') fail('background.glow must be an object if present');
      const g = bg.glow;
      for (const key of ['from', 'to']) {
        if (g[key] !== undefined && (typeof g[key] !== 'string' || !HEX_RE.test(g[key]))) {
          fail(`background.glow.${key} must be a hex string`);
        }
      }
      if (g.opacity !== undefined && (typeof g.opacity !== 'number' || g.opacity < 0 || g.opacity > 1)) {
        fail('background.glow.opacity must be a number between 0 and 1');
      }
    }
  }
}

/**
 * Build v0.4-specific background values for the 3 new types.
 * Returns token→value map to merge into baseValues before snippet fill.
 */
function buildV04BackgroundValues(brand, baseValues) {
  const bg = brand.visual?.background || {};
  const type = bg.type;
  const values = {};

  if (type === 'dot-grid') {
    const dg = bg.dotGrid || {};
    const spacing = dg.spacing ?? 40;
    values.DOT_GRID_SPACING = spacing;
    values.DOT_GRID_HALF_SPACING = spacing / 2;
    values.DOT_GRID_DOT_SIZE = dg.dotSize ?? 1.5;
    values.DOT_GRID_DOT_COLOR = dg.dotColor ?? baseValues.COLOR_ACCENT;
    values.DOT_GRID_DOT_OPACITY = dg.opacity ?? 0.25;
  } else if (type === 'geometric-shapes') {
    const shapes = Array.isArray(bg.shapes) ? bg.shapes : [];
    for (let i = 0; i < 5; i++) {
      const n = i + 1;
      const s = shapes[i];
      if (s) {
        values[`SHAPE_${n}_CX`] = s.cx ?? 0;
        values[`SHAPE_${n}_CY`] = s.cy ?? 0;
        values[`SHAPE_${n}_R`] = s.r ?? 0;
        values[`SHAPE_${n}_FILL`] = s.fill ?? 'none';
        values[`SHAPE_${n}_STROKE`] = s.stroke ?? 'none';
        values[`SHAPE_${n}_STROKE_WIDTH`] = s.strokeWidth ?? 0;
        values[`SHAPE_${n}_OPACITY`] = s.opacity ?? 0.4;
      } else {
        // Invisible defaults — shape renders but at opacity 0 / r=0
        values[`SHAPE_${n}_CX`] = 0;
        values[`SHAPE_${n}_CY`] = 0;
        values[`SHAPE_${n}_R`] = 0;
        values[`SHAPE_${n}_FILL`] = 'none';
        values[`SHAPE_${n}_STROKE`] = 'none';
        values[`SHAPE_${n}_STROKE_WIDTH`] = 0;
        values[`SHAPE_${n}_OPACITY`] = 0;
      }
    }
  } else if (type === 'glow-sphere') {
    const g = bg.glow || {};
    values.GLOW_CX = g.cx ?? '50%';
    values.GLOW_CY = g.cy ?? '-20%';
    values.GLOW_R = g.r ?? '80%';
    values.GLOW_FROM = g.from ?? baseValues.COLOR_ACCENT;
    values.GLOW_TO = g.to ?? bg.color ?? baseValues.SURFACE ?? '#000000';
    values.GLOW_OPACITY = g.opacity ?? 0.5;
  }

  return values;
}

/**
 * v0.4 background renderer.
 * Routes v0.4-only types through new snippets; delegates others to v0.3 path
 * in shared-render.mjs. Grain overlay is appended for both paths.
 */
function renderBackgroundV04({ brand, pluginRoot, baseValues }) {
  const type = brand.visual?.background?.type || 'solid';
  if (!V04_BACKGROUND_TYPES.has(type)) {
    // Defer to v0.3 implementation for solid/gradient/mesh/radial/image
    return renderBackgroundV03({ brand, pluginRoot, baseValues });
  }

  const fileMap = {
    'dot-grid': '_background-dot-grid.svg',
    'geometric-shapes': '_background-geometric-shapes.svg',
    'glow-sphere': '_background-glow-sphere.svg',
  };
  const path = join(pluginRoot, 'templates', fileMap[type]);
  const snippet = readFileSync(path, 'utf8');

  // Merge v0.4 bg values into baseValues so snippet placeholders resolve.
  const v04Values = buildV04BackgroundValues(brand, baseValues);
  const merged = { ...baseValues, ...v04Values };
  const escaped = escapeValues(merged);
  let out = fillTemplate(snippet, escaped);

  // Grain overlay — same as v0.3 path
  const grain = brand.visual.background?.grain;
  if (grain && grain.enabled === true) {
    const grainPath = join(pluginRoot, 'templates', '_grain-filter.svg');
    const grainSnippet = readFileSync(grainPath, 'utf8');
    out += fillTemplate(grainSnippet, escaped);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Icon system (v0.4.1) — curated library + optional AI-generated inline SVG
// ---------------------------------------------------------------------------

/**
 * Inline-icon SVG safe-bounds validator. Returns the (trusted) SVG content on
 * success or `null` on failure; on failure logs a warning — caller falls back
 * to empty icon slot.
 */
function validateIconSvg(svg) {
  if (typeof svg !== 'string') {
    console.warn('\u26a0  Icon: svg must be a string — falling back to empty');
    return null;
  }
  if (svg.length > 4000) {
    console.warn(`\u26a0  Icon: SVG too large (${svg.length} bytes > 4000) — falling back to empty`);
    return null;
  }
  const forbidden = /<\s*(script|foreignObject|image|iframe|style)\b/i;
  if (forbidden.test(svg)) {
    console.warn('\u26a0  Icon: contains forbidden element (script/foreignObject/image/iframe/style) — falling back to empty');
    return null;
  }
  const hexMatches = svg.match(/#[0-9a-fA-F]{6}\b/g);
  if (hexMatches && hexMatches.length) {
    console.warn(`\u26a0  Icon: uses hardcoded hex color(s) ${hexMatches.join(', ')} — must use currentColor. Falling back to empty`);
    return null;
  }
  return svg;
}

/**
 * Resolve a single icon specifier to raw SVG primitives (or empty on miss).
 * Accepts `{ library: "shield" }`, `{ svg: "<path…/>" }`, or null/undefined.
 */
function resolveOneIcon(spec) {
  if (!spec || typeof spec !== 'object') return '';
  if (spec.library) {
    const content = getIcon(spec.library);
    if (!content) {
      console.warn(`\u26a0  Icon: unknown library name "${spec.library}" — falling back to empty`);
      return '';
    }
    return content;
  }
  if (spec.svg) {
    const safe = validateIconSvg(spec.svg);
    return safe ?? '';
  }
  return '';
}

/**
 * Resolve icon slots for a slide. Returns an object with raw SVG strings:
 *   { ICON, ICON_LEFT, ICON_RIGHT }
 *
 * For single-icon patterns (stat-dominant, cover-asymmetric):
 *   slide.icon = { library: "shield" }            → ICON populated
 *   slide.icon = { svg: "<path .../>" }           → ICON populated (validated)
 *
 * For split-comparison (two icons):
 *   slide.icon = { left: {...}, right: {...} }    → ICON_LEFT / ICON_RIGHT
 *
 * Missing icons → empty string (template renders `<g>` with no children).
 */
function resolveIconSlots(slide) {
  const out = { ICON: '', ICON_LEFT: '', ICON_RIGHT: '' };
  const icon = slide?.icon;
  if (!icon || typeof icon !== 'object') return out;

  // Compound (left/right) form for split-comparison
  if (icon.left || icon.right) {
    out.ICON_LEFT = resolveOneIcon(icon.left);
    out.ICON_RIGHT = resolveOneIcon(icon.right);
    return out;
  }
  // Single-icon form
  out.ICON = resolveOneIcon(icon);
  return out;
}

// Fonts not available on Google Fonts — served by Fontshare instead.
// Map family name → Fontshare slug.
const FONTSHARE_FONTS = {
  'Satoshi': 'satoshi',
  'Cabinet Grotesk': 'cabinet-grotesk',
  'Clash Display': 'clash-display',
  'Clash Grotesk': 'clash-grotesk',
  'Supreme': 'supreme',
  'General Sans': 'general-sans',
  'Zodiak': 'zodiak',
  'Gambarino': 'gambarino',
};

/**
 * Build one or two @import lines for a brand's display + body fonts.
 * Emits separate imports when fonts come from different sources
 * (Google Fonts vs Fontshare), dedupes when display === body.
 * Returns the string ready to inline inside an SVG <style> block.
 */
function buildFontImports(fonts) {
  const importOf = (name) => {
    if (!name) return null;
    const slug = FONTSHARE_FONTS[name];
    if (slug) {
      return `@import url('https://api.fontshare.com/v2/css?f[]=${slug}@400,500,700,900&amp;display=swap');`;
    }
    const googleSlug = String(name).replace(/\s+/g, '+');
    return `@import url('https://fonts.googleapis.com/css2?family=${googleSlug}:wght@400;500;700;800&amp;display=swap');`;
  };
  const seen = new Set();
  const lines = [];
  for (const name of [fonts?.display, fonts?.body]) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const line = importOf(name);
    if (line) lines.push(line);
  }
  return lines.join('\n      ');
}

// ---------------------------------------------------------------------------
// Token value construction
// ---------------------------------------------------------------------------

/**
 * Build the complete token→value map for a single slide.
 *
 * Keys compiled from the 8 pattern SVGs + 8 verify fixtures. If a pattern
 * adds a new placeholder, add it here. Empty-string default for unused keys
 * on a given pattern is fine — `fillTemplate` handles undefined → ''.
 */
function buildTokenValues(brand, axes, slideNumber, slideTotal) {
  const fonts = brand.visual.fonts || {};
  const colors = brand.visual.colors || {};
  const brandMeta = brand.brand || {};
  const roles = buildColorRoles(colors);

  const centerX = Math.round(CANVAS.width / 2);
  const centerY = Math.round(CANVAS.height / 2);

  // Pattern-specific derived geometry — ported from the 8 verify fixtures.
  // Kept here (not in grid.js) because it's pattern-layout-specific.

  // list-bullet / list-numbered: row spacing differs between the two
  const ROW_SPACING_BULLET = 88;
  const ROW_SPACING_NUMBERED = 96;

  // cta-stacked: pill geometry
  const buttonWidth = 560;
  const buttonHeight = 112;
  const buttonX = Math.round((CANVAS.width - buttonWidth) / 2); // 260
  const buttonY = 816;
  const buttonRx = Math.round(buttonHeight / 2); // 56
  const buttonTextY = buttonY + Math.round(buttonHeight * 0.642); // 888
  const subtextY = buttonY + buttonHeight + 64; // 992
  const hookDY = Math.round(TYPE.headline * 1.18); // 104

  return {
    // Canvas
    WIDTH: CANVAS.width,
    HEIGHT: CANVAS.height,
    CENTER_X: centerX,
    CENTER_Y: centerY,

    // Grid
    COL_1_X: COLS[0],
    WIDTH_MINUS_MARGIN: CANVAS.width - GRID.sideMargin,

    // Anchors (from tokens/grid.js)
    ANCHOR_FLAG_TOP: ANCHORS.FLAG_TOP,
    ANCHOR_FLAG_BOTTOM: ANCHORS.FLAG_BOTTOM,
    ANCHOR_GOLDEN_UPPER: ANCHORS.GOLDEN_UPPER,
    ANCHOR_OPTICAL_CENTER: ANCHORS.OPTICAL_CENTER,
    ANCHOR_CENTER: ANCHORS.CENTER,
    ANCHOR_BODY_TOP: ANCHORS.BODY_TOP,
    ANCHOR_BODY_BOTTOM: ANCHORS.BODY_BOTTOM,
    ANCHOR_FOOTER_TOP: ANCHORS.FOOTER_TOP,
    ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,
    ANCHOR_FOOTER_BOTTOM: ANCHORS.FOOTER_BOTTOM,

    // Cover-asymmetric / cover-centered derived
    ACCENT_RULE_Y: ANCHORS.FLAG_TOP + 24,
    ACCENT_RULE_X_END: COLS[0] + 120,
    HEADLINE_BOTTOM_Y: 820,
    KICKER_CENTERED_Y: ANCHORS.FLAG_TOP + 80,

    // list-bullet / list-numbered derived
    LIST_GROUP_Y: ANCHORS.BODY_TOP + 192, // 552
    ROW_SPACING_BULLET,
    ROW_SPACING_BULLET_2: ROW_SPACING_BULLET * 2,
    ROW_SPACING_BULLET_3: ROW_SPACING_BULLET * 3,
    ROW_SPACING_BULLET_4: ROW_SPACING_BULLET * 4,
    ROW_SPACING_NUMBERED,
    ROW_SPACING_NUMBERED_2: ROW_SPACING_NUMBERED * 2,
    ROW_SPACING_NUMBERED_3: ROW_SPACING_NUMBERED * 3,
    ROW_SPACING_NUMBERED_4: ROW_SPACING_NUMBERED * 4,

    // stat-dominant derived
    ANCHOR_STAT_Y: 600,
    ANCHOR_STAT_LABEL_Y: 704,
    ANCHOR_STAT_CONTEXT_Y: 776,

    // quote-pulled derived
    ANCHOR_QUOTE_Y: 520,
    QUOTE_DY: 72,
    ANCHOR_QUOTE_ATTRIB_Y: 832,

    // split-comparison derived
    LEFT_ZONE_CENTER_X: 270,
    RIGHT_ZONE_CENTER_X: 810,
    ANCHOR_ZONE_LABEL_Y: 440,
    ANCHOR_LINE_1_Y: 560,
    ANCHOR_LINE_2_Y: 648,
    ANCHOR_LINE_3_Y: 736,

    // cta-stacked derived
    ANCHOR_CTA_HOOK_Y: 520,
    HOOK_DY: hookDY,
    CTA_HOOK_LETTERSPACE: letterSpacingForSize(TYPE.headline),
    BUTTON_X: buttonX,
    BUTTON_Y: buttonY,
    BUTTON_WIDTH: buttonWidth,
    BUTTON_HEIGHT: buttonHeight,
    BUTTON_RX: buttonRx,
    ANCHOR_BUTTON_TEXT_Y: buttonTextY,
    ANCHOR_SUBTEXT_Y: subtextY,

    // Icon slot positions (v0.4.1). 24x24 viewBox at scale 1.5 = 36px, scale 1.67 = 40px.
    // Cover-asymmetric: top-right balance, opposite kicker
    ICON_KICKER_X: CANVAS.width - GRID.sideMargin - 40, // 968
    ICON_KICKER_Y: ANCHORS.FLAG_TOP - 24,               //  72
    // Stat-dominant: centered above stat-value. Stat baseline=600 (156px font →
    // text top ~y=475), so icon needs to clear that. y=380 gives a 90px gap
    // between icon-bottom (y=420) and stat-top.
    ICON_STAT_X: Math.round(CANVAS.width / 2) - 20,     // 520
    ICON_STAT_Y: 380,
    // Split-comparison: above each zone label at y=440. Zone centers 270/810, width 36 → cx-18
    ICON_LEFT_X: 270 - 18,
    ICON_RIGHT_X: 810 - 18,
    ICON_ZONE_Y: 376,

    // Type scale
    TYPE_MICRO: TYPE.micro,
    TYPE_BODY: TYPE.body,
    TYPE_BODY_LARGE: TYPE.bodyLarge,
    TYPE_LABEL: TYPE.label,
    TYPE_SUBHEAD: TYPE.subhead,
    TYPE_HEADLINE: TYPE.headline,
    TYPE_HERO: TYPE.hero,
    TYPE_STAT: TYPE.stat,

    // Letter-spacing / line-height derivations
    TITLE_LETTER_SPACING: letterSpacingForSize(TYPE.hero),
    TITLE_LINE_HEIGHT: lineHeightForSize(TYPE.hero),
    HEADLINE_DY: Math.round(TYPE.hero * lineHeightForSize(TYPE.hero)),
    TYPE_LETTERSPACE_STAT: letterSpacingForSize(TYPE.stat),
    SUBHEAD_LETTER_SPACING: letterSpacingForSize(TYPE.subhead),

    // Color roles
    SURFACE: roles.SURFACE,
    ON_SURFACE: roles.ON_SURFACE,
    SURFACE_MUTED: roles.SURFACE_MUTED,
    ACCENT: roles.ACCENT,
    ON_ACCENT: roles.ON_ACCENT,
    ACCENT_SECONDARY: roles.ACCENT_SECONDARY,
    SURFACE_TINT_5: roles.SURFACE_TINT_5,
    SURFACE_TINT_12: roles.SURFACE_TINT_12,
    SURFACE_TINT_20: roles.SURFACE_TINT_20,

    // Legacy color aliases (for shared-render background/numbering)
    COLOR_TEXT: colors.text ?? '#FFFFFF',
    COLOR_ACCENT: colors.accent ?? roles.ACCENT,
    COLOR_MUTED: colors.muted ?? roles.SURFACE_MUTED,
    BOTTOM_Y: CANVAS.height - 100,

    // Fonts
    FONT_DISPLAY: fonts.display || 'serif',
    FONT_BODY: fonts.body || 'sans-serif',
    FONT_DISPLAY_URL: fontUrl(fonts.display || ''),
    FONT_BODY_URL: fontUrl(fonts.body || ''),
    FONT_DISPLAY_STACK: fontStack(fonts.display || 'serif', 'serif'),
    FONT_BODY_STACK: fontStack(fonts.body || 'sans-serif', 'sans'),
    FONT_IMPORTS: buildFontImports(fonts),
    BG_COLOR: brand.visual.background?.color ?? roles.SURFACE,

    // Brand meta
    BRAND_NAME: brandMeta.name ?? '',
    BRAND_HANDLE: brandMeta.handle ?? '',

    // Slide meta
    SLIDE_NUMBER: slideNumber,
    SLIDE_TOTAL: slideTotal,
    SLIDE_NUMBER_PADDED: String(slideNumber).padStart(2, '0'),
    SLIDE_TOTAL_PADDED: String(slideTotal).padStart(2, '0'),
  };
}

// ---------------------------------------------------------------------------
// Axis effects
// ---------------------------------------------------------------------------

/**
 * Apply sampled axis effects to the slide value map.
 *
 * v0.4.0 initial release wires ONE axis effect: `emphasis`. The other axes
 * (density, composition, hierarchy, accentPlacement, decorationMix) are sampled
 * into `_axes.json` for observability but are not yet wired into output —
 * patterns carry their own layout. These become v0.4.1 extensions once we
 * have pattern variants per axis value.
 *
 * EMPHASIS handling notes:
 *   - Inlines the resolved accent hex directly into the tspan markup (not as
 *     a `{{ACCENT}}` placeholder). `fillTemplate` is a single-pass replace —
 *     placeholders inside inserted values are not re-resolved.
 *   - Head/tail text is XML-escaped; the surrounding tspan tags are raw markup.
 *   - The emphasized slot is added to `rawKeys` so `escapeValues` doesn't
 *     turn `<tspan>` into `&lt;tspan&gt;`.
 */
function applyAxisEffects(values, slide, axes) {
  const rawKeys = [];

  // Pick the primary headline slot for this pattern. Different patterns put
  // the headline in different slots:
  //   cover-asymmetric / cover-centered → HEADLINE_LINE_1
  //   list-bullet / list-numbered → HEADLINE
  //   cta-stacked → HOOK_LINE_1
  //   stat-dominant, quote-pulled, split-comparison → no headline emphasis
  //     (stat/quote carries its own accent already)
  const pattern = slide.pattern;
  let slotKey = null;
  if (pattern === 'cover-asymmetric' || pattern === 'cover-centered') {
    slotKey = 'HEADLINE_LINE_1';
  } else if (pattern === 'list-bullet' || pattern === 'list-numbered') {
    slotKey = 'HEADLINE';
  } else if (pattern === 'cta-stacked') {
    slotKey = 'HOOK_LINE_1';
  }

  const emphasis = axes.emphasis;

  // none / hero-only / middle-noun (deferred — needs NLP) → no change
  if (
    !slotKey ||
    !emphasis ||
    emphasis === 'none' ||
    emphasis === 'hero-only' ||
    emphasis === 'middle-noun'
  ) {
    return { rawKeys };
  }

  const original = values[slotKey];
  if (original === undefined || original === null || String(original).trim() === '') {
    return { rawKeys };
  }

  const text = String(original);
  const words = text.split(/\s+/);
  if (words.length < 2) {
    // Single word — emphasizing "the word" is visually identical to coloring
    // the whole line. Skip to keep output clean.
    return { rawKeys };
  }

  // Inline the already-resolved accent hex directly — fillTemplate is
  // single-pass, so `{{ACCENT}}` inside an inserted value would survive
  // unreplaced. values.ACCENT is the resolved hex from buildColorRoles.
  const accentHex = values.ACCENT;
  let head, tail;
  if (emphasis === 'first-word') {
    head = words[0];
    tail = words.slice(1).join(' ');
    values[slotKey] = `<tspan fill="${escapeXml(accentHex)}">${escapeXml(head)}</tspan> ${escapeXml(tail)}`;
  } else if (emphasis === 'last-word') {
    head = words.slice(0, -1).join(' ');
    tail = words[words.length - 1];
    values[slotKey] = `${escapeXml(head)} <tspan fill="${escapeXml(accentHex)}">${escapeXml(tail)}</tspan>`;
  }

  rawKeys.push(slotKey);
  return { rawKeys };
}

// ---------------------------------------------------------------------------
// Per-slide rendering
// ---------------------------------------------------------------------------

function renderPatternSlide({
  slide,
  slideNumber,
  slideTotal,
  brand,
  axes,
  rng,
  pluginRoot,
}) {
  const patternDef = PATTERN_BY_ID[slide.pattern];
  if (!patternDef) {
    const known = Object.keys(PATTERN_BY_ID).join(', ');
    throw new Error(
      `Unknown pattern "${slide.pattern}" on slide ${slideNumber}. Known patterns: ${known}`,
    );
  }

  const templatePath = join(pluginRoot, 'patterns', patternDef.template);
  const templateStr = readFileSync(templatePath, 'utf8');

  // Token values + per-slide data
  const tokenValues = buildTokenValues(brand, axes, slideNumber, slideTotal);
  const slideData = slide.data || {};
  const values = { ...tokenValues, ...slideData };

  // Derived per-slide values for list patterns: ARROW_N and ITEM_NUMBER_N
  // present only when corresponding ITEM_N has content, so empty bullets
  // don't leave orphan arrows/numbers.
  for (let i = 1; i <= 5; i++) {
    const item = values[`ITEM_${i}`];
    const hasContent =
      item !== undefined && item !== null && String(item).trim() !== '';
    values[`ARROW_${i}`] = hasContent ? '\u2192' : '';
    values[`ITEM_NUMBER_${i}`] = hasContent ? String(i).padStart(2, '0') : '';
  }

  // Axis effects (emphasis word highlighting). Mutates `values` in place and
  // returns the set of keys whose value is now raw SVG markup (so we don't
  // escape it in the template fill pass).
  const { rawKeys: axisRawKeys } = applyAxisEffects(values, slide, axes);

  // Background / decorations / numbering — shared-render expects v0.3-style
  // baseValues shape (has BOTTOM_Y, COLOR_ACCENT, etc. — see buildTokenValues).
  // v0.4 wraps renderBackground to also handle dot-grid/geometric-shapes/glow-sphere.
  const backgroundSvg = renderBackgroundV04({ brand, pluginRoot, baseValues: values });
  const decorationsSvg = renderDecorations({
    brand,
    slideData,
    pluginRoot,
    baseValues: values,
    slideNumber,
  });
  const numberingSvg = renderNumbering({
    brand,
    pluginRoot,
    baseValues: values,
    slideNumber,
    slideTotal,
  });

  // Icon slots — library lookup or validated inline SVG. Empty if absent.
  const iconSlots = resolveIconSlots(slide);

  const finalValues = {
    ...values,
    BACKGROUND: backgroundSvg,
    DECORATIONS: decorationsSvg,
    NUMBERING: numberingSvg,
    ...iconSlots,
  };

  // Escape everything EXCEPT raw-SVG / raw-CSS slots:
  //   BACKGROUND / DECORATIONS / NUMBERING / ICON*: raw SVG markup.
  //   FONT_*_STACK: CSS font-family value with single quotes around the name
  //     (e.g. `'Instrument Serif', serif`). Escaping turns the quotes into
  //     `&apos;` which breaks CSS. Font names come from brand.visual.fonts
  //     which is author-controlled, not user input — safe to pass raw.
  //   axisRawKeys: emphasis-wrapped tspan markup.
  const rawKeys = [
    'BACKGROUND',
    'DECORATIONS',
    'NUMBERING',
    'ICON',
    'ICON_LEFT',
    'ICON_RIGHT',
    'FONT_DISPLAY_STACK',
    'FONT_BODY_STACK',
    'FONT_IMPORTS',
    ...axisRawKeys,
  ];
  const escaped = escapeValues(finalValues, rawKeys);
  return fillTemplate(templateStr, escaped);
}

// ---------------------------------------------------------------------------
// Carousel orchestration
// ---------------------------------------------------------------------------

export function renderCarousel({ brand, strategy, outputDir, pluginRoot = PLUGIN_ROOT }) {
  if (!strategy || typeof strategy !== 'object') {
    throw new Error('strategy must be an object with { topic, slides[] }');
  }
  if (typeof strategy.topic !== 'string' || !strategy.topic.trim()) {
    throw new Error('strategy.topic is required (used for deterministic seed)');
  }
  if (!Array.isArray(strategy.slides) || strategy.slides.length === 0) {
    throw new Error('strategy.slides must be a non-empty array');
  }
  if (!brand?.brand?.handle) {
    throw new Error('brand.brand.handle is required (used for deterministic seed)');
  }

  // v0.4-specific validation (background.dotGrid / shapes / glow).
  validateBrand(brand);

  const outAbs = resolve(outputDir);
  mkdirSync(outAbs, { recursive: true });

  const seed = buildSeed({ brandHandle: brand.brand.handle, topic: strategy.topic });
  const rng = createRng(seed);
  const axes = sampleCarouselAxes(rng);

  // Write axes profile as debugging aid.
  const axesPath = join(outAbs, '_axes.json');
  writeFileSync(
    axesPath,
    JSON.stringify({ seed, axes }, null, 2) + '\n',
    'utf8',
  );

  const slideTotal = strategy.slides.length;
  strategy.slides.forEach((slide, i) => {
    const slideNumber = i + 1;
    const svg = renderPatternSlide({
      slide,
      slideNumber,
      slideTotal,
      brand,
      axes,
      rng,
      pluginRoot,
    });
    const filename = `slide-${String(slideNumber).padStart(2, '0')}.svg`;
    const fullPath = join(outAbs, filename);
    writeFileSync(fullPath, svg, 'utf8');
    console.log(`\u2713 ${fullPath}`);
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [brandPath, strategyPath, outDir] = process.argv.slice(2);
  if (!brandPath || !strategyPath || !outDir) {
    console.error(
      'Usage: node scripts/render-v0.4.mjs <brand-profile.json> <strategy.json> <output-dir>',
    );
    process.exit(1);
  }
  let brand, strategy;
  try {
    brand = JSON.parse(readFileSync(resolve(brandPath), 'utf8'));
  } catch (err) {
    console.error(`\u2717 Failed to load brand: ${err.message}`);
    process.exit(1);
  }
  try {
    strategy = JSON.parse(readFileSync(resolve(strategyPath), 'utf8'));
  } catch (err) {
    console.error(`\u2717 Failed to load strategy: ${err.message}`);
    process.exit(1);
  }
  try {
    renderCarousel({
      brand,
      strategy,
      outputDir: resolve(outDir),
      pluginRoot: PLUGIN_ROOT,
    });
  } catch (err) {
    console.error(`\u2717 ${err.message}`);
    process.exit(1);
  }
}
