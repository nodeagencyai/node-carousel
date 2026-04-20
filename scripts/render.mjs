#!/usr/bin/env node
// render.mjs — fill SVG templates with brand + slide data, write finished slides.
//
// Module API:
//   fillTemplate(templateStr, values)  — replace {{KEYS}} with values[KEY]; missing → ''
//   renderSlide({ templateName, slideData, brand, slideNumber, slideTotal, pluginRoot })
//     → complete SVG string
//
// CLI:
//   node scripts/render.mjs <brand-profile.json> <strategy.json> <output-dir>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_PLUGIN_ROOT = resolve(__dirname, '..');

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

// Module-level flag so the non-default-dimensions warning only fires once per run.
let _dimsWarned = false;

export function fillTemplate(templateStr, values) {
  return templateStr.replace(PLACEHOLDER_RE, (_, key) => {
    const v = values[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * XML-escape a string for safe insertion into SVG/XML attribute or text content.
 * Handles &, <, >, ", ' per XML spec.
 */
export function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Return a copy of `values` with all string entries XML-escaped, EXCEPT keys
 * listed in `rawKeys` (e.g. "BACKGROUND" which is already SVG markup).
 * Numbers and booleans pass through unchanged.
 */
function escapeValues(values, rawKeys = []) {
  const rawSet = new Set(rawKeys);
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (rawSet.has(k)) {
      out[k] = v;
    } else if (typeof v === 'string') {
      out[k] = escapeXml(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function fontUrl(name) {
  return String(name || '').replace(/\s+/g, '+');
}

/**
 * Validate brand-profile shape. Throws with clear, actionable messages on failure.
 * V1 (0.1.0) templates are hardcoded for 1080x1350 — dimensions that differ still
 * render but may produce broken layouts.
 */
export function validateBrand(brand) {
  const schemaRef = 'See docs/brand-profile-schema.md for the full schema.';
  const missing = (field, extra = '') =>
    `Invalid brand-profile.json: missing required field "${field}"${extra ? ` (${extra})` : ''}. ${schemaRef}`;

  if (!brand || typeof brand !== 'object') {
    throw new Error(`Invalid brand-profile.json: expected an object. ${schemaRef}`);
  }

  // brand.{name,handle}
  if (!brand.brand || typeof brand.brand !== 'object') {
    throw new Error(missing('brand'));
  }
  if (typeof brand.brand.name !== 'string' || !brand.brand.name) {
    throw new Error(missing('brand.name', 'expected non-empty string'));
  }
  if (typeof brand.brand.handle !== 'string') {
    throw new Error(missing('brand.handle', 'expected string'));
  }

  // visual
  if (!brand.visual || typeof brand.visual !== 'object') {
    throw new Error(missing('visual'));
  }

  // visual.colors.{text,background,accent,muted}
  const colors = brand.visual.colors;
  if (!colors || typeof colors !== 'object') {
    throw new Error(missing('visual.colors'));
  }
  for (const key of ['text', 'background', 'accent', 'muted']) {
    if (typeof colors[key] !== 'string' || !colors[key]) {
      throw new Error(missing(`visual.colors.${key}`, 'expected non-empty string'));
    }
  }

  // visual.fonts.{display,body}
  const fonts = brand.visual.fonts;
  if (!fonts || typeof fonts !== 'object') {
    throw new Error(missing('visual.fonts'));
  }
  for (const key of ['display', 'body']) {
    if (typeof fonts[key] !== 'string' || !fonts[key]) {
      throw new Error(missing(`visual.fonts.${key}`, 'expected non-empty string'));
    }
  }

  // visual.background
  const bg = brand.visual.background;
  if (!bg || typeof bg !== 'object') {
    throw new Error(missing('visual.background'));
  }
  const validBgTypes = new Set(['solid', 'gradient', 'image']);
  if (!validBgTypes.has(bg.type)) {
    throw new Error(
      `Invalid brand-profile.json: "visual.background.type" must be one of "solid", "gradient", "image" (got ${JSON.stringify(bg.type)}). ${schemaRef}`,
    );
  }
  if (bg.type === 'solid') {
    if (typeof bg.color !== 'string' || !bg.color) {
      throw new Error(missing('visual.background.color', 'required when background.type = "solid"'));
    }
  } else if (bg.type === 'gradient') {
    if (!bg.gradient || typeof bg.gradient !== 'object') {
      throw new Error(missing('visual.background.gradient', 'required when background.type = "gradient"'));
    }
    if (typeof bg.gradient.from !== 'string' || !bg.gradient.from) {
      throw new Error(missing('visual.background.gradient.from', 'expected non-empty string'));
    }
    if (typeof bg.gradient.to !== 'string' || !bg.gradient.to) {
      throw new Error(missing('visual.background.gradient.to', 'expected non-empty string'));
    }
  } else if (bg.type === 'image') {
    if (!bg.imagePath || typeof bg.imagePath !== 'string') {
      throw new Error(missing('visual.background.imagePath', 'required non-null string when background.type = "image"'));
    }
  }

  // visual.dimensions.{width,height}
  const dims = brand.visual.dimensions;
  if (!dims || typeof dims !== 'object') {
    throw new Error(missing('visual.dimensions'));
  }
  if (typeof dims.width !== 'number' || !Number.isFinite(dims.width)) {
    throw new Error(missing('visual.dimensions.width', 'expected number'));
  }
  if (typeof dims.height !== 'number' || !Number.isFinite(dims.height)) {
    throw new Error(missing('visual.dimensions.height', 'expected number'));
  }
}

function buildBackgroundValues(brand) {
  const bg = brand.visual.background || {};
  const gradient = bg.gradient || {};
  return {
    BG_COLOR: bg.color ?? '#000000',
    BG_GRADIENT_FROM: gradient.from ?? bg.color ?? '#000000',
    BG_GRADIENT_TO: gradient.to ?? bg.color ?? '#000000',
    BG_GRADIENT_ANGLE: gradient.angle ?? 135,
    BG_IMAGE_HREF: bg.imagePath || '',
  };
}

function renderBackground({ brand, pluginRoot, baseValues }) {
  const type = brand.visual.background?.type || 'solid';
  const fileMap = {
    solid: '_background-solid.svg',
    gradient: '_background-gradient.svg',
    image: '_background-image.svg',
  };
  const file = fileMap[type] || fileMap.solid;
  const path = join(pluginRoot, 'templates', file);
  const snippet = readFileSync(path, 'utf8');
  // Background placeholders are safe to escape across the board:
  // - BG_IMAGE_HREF is user-controlled (file path) — escaping protects & / "
  // - BG_COLOR / BG_GRADIENT_* are color strings; escaping is a no-op in practice
  // - WIDTH / HEIGHT / BG_GRADIENT_ANGLE are numbers — pass through
  const escaped = escapeValues(baseValues);
  return fillTemplate(snippet, escaped);
}

// NOTE: Layout math below (CTA_HOOK_Y: 480, BUTTON_Y: 700, template dy offsets,
// etc.) is hardcoded for the default 1080x1350 canvas. Non-default dimensions
// will render but layouts may break. Full responsive layout is V2 scope.
function buildDerivedDimensions(brand) {
  const { width, height } = brand.visual.dimensions;
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const buttonWidth = 720;
  return {
    WIDTH: width,
    HEIGHT: height,
    CENTER_X: centerX,
    CENTER_Y: centerY,
    BOTTOM_Y: height - 100,
    BOTTOM_Y_MINUS_40: height - 140,
    WIDTH_MINUS_100: width - 100,
    CENTER_Y_MINUS_120: centerY - 120,
    CENTER_Y_PLUS_60: centerY + 60,
    CENTER_Y_PLUS_140: centerY + 140,
    // CTA-specific layout
    CTA_HOOK_Y: 480,
    BUTTON_WIDTH: buttonWidth,
    BUTTON_X: Math.round((width - buttonWidth) / 2),
    BUTTON_Y: 700,
    BUTTON_TEXT_Y: 778,
    CTA_SUBTEXT_Y: 900,
  };
}

export function renderSlide({
  templateName,
  slideData,
  brand,
  slideNumber,
  slideTotal,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
}) {
  validateBrand(brand);

  const { width, height } = brand.visual.dimensions;
  if ((width !== 1080 || height !== 1350) && !_dimsWarned) {
    _dimsWarned = true;
    console.error(
      `\u26a0 Warning: dimensions ${width}x${height} may produce broken layouts. ` +
        `Templates in v0.1.0 are optimized for 1080x1350. ` +
        `Set visual.dimensions to 1080x1350 for reliable output.`,
    );
  }

  const templatePath = join(pluginRoot, 'templates', `${templateName}.svg`);
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  const templateStr = readFileSync(templatePath, 'utf8');

  const fonts = brand.visual.fonts || {};
  const colors = brand.visual.colors || {};
  const brandMeta = brand.brand || {};

  const baseValues = {
    ...buildDerivedDimensions(brand),
    ...buildBackgroundValues(brand),
    FONT_DISPLAY: fonts.display || 'serif',
    FONT_BODY: fonts.body || 'sans-serif',
    FONT_DISPLAY_URL: fontUrl(fonts.display || ''),
    FONT_BODY_URL: fontUrl(fonts.body || ''),
    COLOR_TEXT: colors.text ?? '#FFFFFF',
    COLOR_ACCENT: colors.accent ?? '#29F2FE',
    COLOR_MUTED: colors.muted ?? '#999999',
    BRAND_NAME: brandMeta.name ?? '',
    BRAND_HANDLE: brandMeta.handle ?? '',
    SLIDE_NUMBER: String(slideNumber).padStart(2, '0'),
    SLIDE_TOTAL: String(slideTotal).padStart(2, '0'),
  };

  // Pass 1: render the background snippet with its own placeholders,
  // then inject it into the main template's BACKGROUND slot.
  const backgroundSvg = renderBackground({ brand, pluginRoot, baseValues });

  const values = {
    ...baseValues,
    BACKGROUND: backgroundSvg,
    ...(slideData || {}),
  };

  // For bullet slides, show an arrow only when the corresponding bullet
  // content is present. Harmless no-op for templates that don't use ARROW_N.
  for (let i = 1; i <= 5; i++) {
    const bullet = values[`BULLET_${i}`];
    const hasContent =
      bullet !== undefined && bullet !== null && String(bullet).trim() !== '';
    values[`ARROW_${i}`] = hasContent ? '\u2192' : '';
  }

  // Pass 2: fill the main template. Escape every string EXCEPT BACKGROUND
  // (which is already SVG markup — escaping would turn <rect> into &lt;rect&gt;).
  const escaped = escapeValues(values, ['BACKGROUND']);
  return fillTemplate(templateStr, escaped);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function readJsonOrExit(path, label) {
  let raw;
  try {
    raw = readFileSync(resolve(path), 'utf8');
  } catch (err) {
    console.error(`\u2717 Failed to read ${label} at ${resolve(path)}: ${err.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`\u2717 Failed to parse ${label}: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  const [, , brandPath, strategyPath, outDir] = process.argv;
  if (!brandPath || !strategyPath || !outDir) {
    console.error(
      'Usage: node scripts/render.mjs <brand-profile.json> <strategy.json> <output-dir>',
    );
    process.exit(1);
  }

  const brand = readJsonOrExit(brandPath, 'brand profile');
  const strategy = readJsonOrExit(strategyPath, 'strategy.json');

  try {
    validateBrand(brand);
  } catch (err) {
    console.error(`\u2717 ${err.message}`);
    process.exit(1);
  }

  const slides = Array.isArray(strategy.slides) ? strategy.slides : [];
  if (slides.length === 0) {
    console.error('No slides found in strategy.json');
    process.exit(1);
  }

  const outAbs = resolve(outDir);
  mkdirSync(outAbs, { recursive: true });

  const total = slides.length;
  slides.forEach((slide, i) => {
    const slideNumber = i + 1;
    const svg = renderSlide({
      templateName: slide.template,
      slideData: slide.data || {},
      brand,
      slideNumber,
      slideTotal: total,
    });
    const filename = `slide-${pad2(slideNumber)}.svg`;
    const fullPath = join(outAbs, filename);
    writeFileSync(fullPath, svg, 'utf8');
    console.log(`\u2713 ${fullPath}`);
  });
}

// Run main only when invoked directly (not imported).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
