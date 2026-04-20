// shared-render.mjs — primitives shared between v0.3 render.mjs and v0.4 render-v0.4.mjs.
// Pure DRY extraction — no v0.3- or v0.4-specific logic lives here.
//
// Ported verbatim from v0.3 scripts/render.mjs:
//   fillTemplate, escapeXml, escapeValues, fontUrl, parseRadialCenter,
//   buildBackgroundValues, renderBackground, renderDecorations,
//   resolveDecorationConfig, buildDotsNumbering, renderNumbering.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

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
export function escapeValues(values, rawKeys = []) {
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

export function fontUrl(name) {
  return String(name || '').replace(/\s+/g, '+');
}

export function parseRadialCenter(center) {
  // "50% 30%" → { cx: "50%", cy: "30%" }
  if (typeof center !== 'string' || !center.trim()) {
    return { cx: '50%', cy: '50%' };
  }
  const parts = center.trim().split(/\s+/);
  return {
    cx: parts[0] || '50%',
    cy: parts[1] || parts[0] || '50%',
  };
}

export function buildBackgroundValues(brand) {
  const bg = brand.visual.background || {};
  const gradient = bg.gradient || {};
  const mesh = bg.mesh || {};
  const radial = bg.radial || {};
  const grain = bg.grain || {};

  const values = {
    BG_COLOR: bg.color ?? '#000000',
    BG_GRADIENT_FROM: gradient.from ?? bg.color ?? '#000000',
    BG_GRADIENT_TO: gradient.to ?? bg.color ?? '#000000',
    BG_GRADIENT_ANGLE: gradient.angle ?? 135,
    BG_IMAGE_HREF: bg.imagePath || '',
  };

  // Mesh blobs — pad to 5 slots, use invisible defaults for unused slots
  const blobs = Array.isArray(mesh.blobs) ? mesh.blobs : [];
  for (let i = 0; i < 5; i++) {
    const n = i + 1;
    const blob = blobs[i];
    if (blob) {
      values[`MESH_BLOB_${n}_CX`] = blob.cx;
      values[`MESH_BLOB_${n}_CY`] = blob.cy;
      values[`MESH_BLOB_${n}_R`] = blob.r;
      values[`MESH_BLOB_${n}_COLOR`] = blob.color;
      values[`MESH_BLOB_${n}_OPACITY`] = blob.opacity;
    } else {
      values[`MESH_BLOB_${n}_CX`] = 0;
      values[`MESH_BLOB_${n}_CY`] = 0;
      values[`MESH_BLOB_${n}_R`] = 0;
      values[`MESH_BLOB_${n}_COLOR`] = '#000';
      values[`MESH_BLOB_${n}_OPACITY`] = 0;
    }
  }

  // Radial gradient
  const { cx, cy } = parseRadialCenter(radial.center);
  const stops = Array.isArray(radial.stops) && radial.stops.length >= 2 ? radial.stops : [0, 1];
  values.RADIAL_CX = cx;
  values.RADIAL_CY = cy;
  values.RADIAL_R = '70%';
  values.RADIAL_FROM = radial.from ?? bg.color ?? '#000000';
  values.RADIAL_TO = radial.to ?? bg.color ?? '#000000';
  values.RADIAL_STOP_FROM = stops[0];
  values.RADIAL_STOP_TO = stops[1];

  // Grain
  values.GRAIN_BASE_FREQ = grain.baseFrequency ?? 0.9;
  values.GRAIN_INTENSITY = grain.intensity ?? 0.12;

  return values;
}

export function renderBackground({ brand, pluginRoot, baseValues }) {
  const type = brand.visual.background?.type || 'solid';
  const fileMap = {
    solid: '_background-solid.svg',
    gradient: '_background-gradient.svg',
    image: '_background-image.svg',
    mesh: '_background-mesh.svg',
    radial: '_background-radial.svg',
  };
  const file = fileMap[type] || fileMap.solid;
  const path = join(pluginRoot, 'templates', file);
  const snippet = readFileSync(path, 'utf8');
  // Background placeholders are safe to escape across the board:
  // - BG_IMAGE_HREF is user-controlled (file path) — escaping protects & / "
  // - BG_COLOR / BG_GRADIENT_* / MESH_* / RADIAL_* are color strings or numbers
  // - WIDTH / HEIGHT / BG_GRADIENT_ANGLE are numbers — pass through
  const escaped = escapeValues(baseValues);
  let out = fillTemplate(snippet, escaped);

  // Grain overlay — appended AFTER the base background when enabled
  const grain = brand.visual.background?.grain;
  if (grain && grain.enabled === true) {
    const grainPath = join(pluginRoot, 'templates', '_grain-filter.svg');
    const grainSnippet = readFileSync(grainPath, 'utf8');
    out += fillTemplate(grainSnippet, escaped);
  }

  return out;
}

// Known decoration names (keys in the decorations config object).
// Order here defines render order (first rendered = underneath later ones).
const DECORATION_NAMES = [
  'cornerMarks',
  'accentRule',
  'numberBadges',
  'pullQuoteBlock',
  'oversizedMark',
];

// Map a decoration config key → snippet filename in templates/decorations/.
const DECORATION_FILE_MAP = {
  cornerMarks: 'corner-marks.svg',
  accentRule: 'accent-rule.svg',
  numberBadges: 'number-badge.svg',
  pullQuoteBlock: 'pull-quote-block.svg',
  oversizedMark: 'oversized-mark.svg',
};

/**
 * Merge decoration config from brand + slideData.
 *
 * - Start with brand.visual.decorations (object with booleans).
 * - If slideData.decorations is an array: treat as "enable exactly these" (override brand).
 * - If slideData.decorations is an object: overlay fields on top of brand.
 * - If missing: use brand defaults.
 *
 * Unknown names are ignored. Missing values default to `false`.
 */
export function resolveDecorationConfig(brandDecorations, slideDecorations) {
  const brandCfg = brandDecorations && typeof brandDecorations === 'object' ? brandDecorations : {};
  const resolved = {};
  for (const name of DECORATION_NAMES) {
    resolved[name] = Boolean(brandCfg[name]);
  }

  if (Array.isArray(slideDecorations)) {
    // Explicit override — enable exactly these (all others disabled).
    for (const name of DECORATION_NAMES) resolved[name] = false;
    for (const name of slideDecorations) {
      if (DECORATION_NAMES.includes(name)) resolved[name] = true;
    }
  } else if (slideDecorations && typeof slideDecorations === 'object') {
    // Overlay — merge fields on top of brand defaults.
    for (const [k, v] of Object.entries(slideDecorations)) {
      if (DECORATION_NAMES.includes(k)) resolved[k] = Boolean(v);
    }
  }

  return resolved;
}

export function renderDecorations({ brand, slideData, pluginRoot, baseValues, slideNumber }) {
  const config = resolveDecorationConfig(
    brand.visual?.decorations,
    slideData?.decorations,
  );

  const anyEnabled = DECORATION_NAMES.some((n) => config[n]);
  if (!anyEnabled) return '';

  // Build values for decoration placeholders. Uses baseValues for colors,
  // fonts, and layout; layers on decoration-specific defaults.
  const slideDataObj = slideData && typeof slideData === 'object' ? slideData : {};
  const values = {
    ...baseValues,
    SLIDE_NUMBER_PADDED: String(slideNumber).padStart(2, '0'),
    // Pull-quote defaults (overridable via slideData)
    PULL_QUOTE_TEXT: slideDataObj.PULL_QUOTE_TEXT ?? '',
    PULL_QUOTE_Y: slideDataObj.PULL_QUOTE_Y ?? 920,
    PULL_QUOTE_WIDTH: slideDataObj.PULL_QUOTE_WIDTH ?? 600,
    PULL_QUOTE_Y_OFFSET: slideDataObj.PULL_QUOTE_Y_OFFSET ?? 880,
    // Oversized mark default (overridable via slideData)
    OVERSIZED_MARK_CHAR: slideDataObj.OVERSIZED_MARK_CHAR ?? '"',
  };

  // Decoration snippets contain user-visible text (PULL_QUOTE_TEXT,
  // OVERSIZED_MARK_CHAR) and numeric/layout values — escape them all.
  const escaped = escapeValues(values);

  const parts = [];
  for (const name of DECORATION_NAMES) {
    if (!config[name]) continue;
    // Pull-quote block only renders when we actually have text — otherwise
    // the tinted rect and empty <text> element show up as a ghost artifact
    // on slides that don't supply PULL_QUOTE_TEXT (e.g. title slides).
    if (name === 'pullQuoteBlock') {
      const text = String(values.PULL_QUOTE_TEXT ?? '').trim();
      if (!text) continue;
    }
    const file = DECORATION_FILE_MAP[name];
    if (!file) continue;
    const path = join(pluginRoot, 'templates', 'decorations', file);
    if (!existsSync(path)) continue;
    const snippet = readFileSync(path, 'utf8');
    parts.push(fillTemplate(snippet, escaped));
  }

  return parts.join('\n');
}

export function buildDotsNumbering(slideNumber, slideTotal, centerX, bottomY, accent, muted) {
  const spacing = 24;
  const radius = 5;
  const totalWidth = (slideTotal - 1) * spacing;
  const startX = centerX - totalWidth / 2;
  const circles = [];
  for (let i = 0; i < slideTotal; i++) {
    const cx = Math.round(startX + i * spacing);
    const isCurrent = i + 1 === slideNumber;
    if (isCurrent) {
      circles.push(`<circle cx="${cx}" cy="${bottomY}" r="${radius}" fill="${accent}"/>`);
    } else {
      circles.push(
        `<circle cx="${cx}" cy="${bottomY}" r="${radius}" fill="none" stroke="${muted}" stroke-width="2"/>`,
      );
    }
  }
  return `<g>${circles.join('')}</g>`;
}

export function renderNumbering({ brand, pluginRoot, baseValues, slideNumber, slideTotal }) {
  const numbering = brand.visual.numbering || {};
  const style = numbering.style ?? 'fraction-mono';
  if (style === 'none') return '';

  const width = baseValues.WIDTH;
  const centerX = baseValues.CENTER_X;
  const bottomY = baseValues.BOTTOM_Y;
  const accent = baseValues.COLOR_ACCENT;
  const muted = baseValues.COLOR_MUTED;

  if (style === 'dot') {
    return buildDotsNumbering(slideNumber, slideTotal, centerX, bottomY, accent, muted);
  }

  if (style === 'bar') {
    const barBgWidth = width - 200;
    const barProgressWidth = Math.round((slideNumber / slideTotal) * barBgWidth);
    const snippetPath = join(pluginRoot, 'templates', '_numbering-bar.svg');
    const snippet = readFileSync(snippetPath, 'utf8');
    const values = {
      ...baseValues,
      BAR_BG_WIDTH: barBgWidth,
      BAR_PROGRESS_WIDTH: barProgressWidth,
    };
    return fillTemplate(snippet, escapeValues(values));
  }

  // fraction-mono (default)
  const position = numbering.position ?? 'bottom-right';
  let numberingX, numberingY, numberingAnchor;
  if (position === 'bottom-center') {
    numberingX = centerX;
    numberingY = bottomY;
    numberingAnchor = 'middle';
  } else if (position === 'top-right') {
    numberingX = width - 100;
    numberingY = 140;
    numberingAnchor = 'end';
  } else {
    // bottom-right (default)
    numberingX = width - 100;
    numberingY = bottomY;
    numberingAnchor = 'end';
  }

  const snippetPath = join(pluginRoot, 'templates', '_numbering-fraction-mono.svg');
  const snippet = readFileSync(snippetPath, 'utf8');
  const values = {
    ...baseValues,
    NUMBERING_X: numberingX,
    NUMBERING_Y: numberingY,
    NUMBERING_ANCHOR: numberingAnchor,
    SLIDE_NUMBER_PADDED: String(slideNumber).padStart(2, '0'),
    SLIDE_TOTAL_PADDED: String(slideTotal).padStart(2, '0'),
  };
  return fillTemplate(snippet, escapeValues(values));
}
