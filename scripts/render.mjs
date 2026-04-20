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

export function fillTemplate(templateStr, values) {
  return templateStr.replace(PLACEHOLDER_RE, (_, key) => {
    const v = values[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function fontUrl(name) {
  return String(name || '').replace(/\s+/g, '+');
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
  return fillTemplate(snippet, baseValues);
}

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

  // Pass 2: fill the main template.
  return fillTemplate(templateStr, values);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

async function main() {
  const [, , brandPath, strategyPath, outDir] = process.argv;
  if (!brandPath || !strategyPath || !outDir) {
    console.error(
      'Usage: node scripts/render.mjs <brand-profile.json> <strategy.json> <output-dir>',
    );
    process.exit(1);
  }

  const brand = JSON.parse(readFileSync(resolve(brandPath), 'utf8'));
  const strategy = JSON.parse(readFileSync(resolve(strategyPath), 'utf8'));
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
