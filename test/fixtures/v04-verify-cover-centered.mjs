import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TYPE, letterSpacingForSize, lineHeightForSize, fontStack } from '../../tokens/typography.js';
import { CANVAS, COLS, ANCHORS, GRID } from '../../tokens/grid.js';
import { buildColorRoles } from '../../tokens/color-roles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..', '..');

const fonts = { display: 'Instrument Serif', body: 'Inter' };
const colors = { background: '#0f0f0f', text: '#FFFFFF', accent: '#29F2FE', muted: '#999999' };
const roles = buildColorRoles(colors);

const values = {
  WIDTH: CANVAS.width,
  HEIGHT: CANVAS.height,
  CENTER_X: Math.round(CANVAS.width / 2),
  COL_1_X: COLS[0],
  WIDTH_MINUS_MARGIN: CANVAS.width - GRID.sideMargin,
  ANCHOR_FLAG_TOP: ANCHORS.FLAG_TOP,
  ANCHOR_GOLDEN_UPPER: ANCHORS.GOLDEN_UPPER,
  ANCHOR_OPTICAL_CENTER: ANCHORS.OPTICAL_CENTER,
  ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,
  TYPE_HERO: TYPE.hero,
  TYPE_BODY: TYPE.body,
  TITLE_LETTER_SPACING: letterSpacingForSize(TYPE.hero),
  TITLE_LINE_HEIGHT: lineHeightForSize(TYPE.hero),
  HEADLINE_DY: Math.round(TYPE.hero * lineHeightForSize(TYPE.hero)),
  // Pattern-specific derived values
  ACCENT_RULE_Y: ANCHORS.FLAG_TOP + 24,
  ACCENT_RULE_X_END: COLS[0] + 120,
  HEADLINE_BOTTOM_Y: 820,
  KICKER_CENTERED_Y: ANCHORS.FLAG_TOP + 80,
  // Color roles
  SURFACE: roles.SURFACE,
  ON_SURFACE: roles.ON_SURFACE,
  SURFACE_MUTED: roles.SURFACE_MUTED,
  ACCENT: roles.ACCENT,
  // Fonts
  FONT_DISPLAY: fonts.display,
  FONT_BODY: fonts.body,
  FONT_DISPLAY_URL: fonts.display.replace(/\s+/g, '+'),
  FONT_BODY_URL: fonts.body.replace(/\s+/g, '+'),
  FONT_DISPLAY_STACK: fontStack(fonts.display, 'serif'),
  FONT_BODY_STACK: fontStack(fonts.body, 'sans'),
  // Simple solid background for verification
  BACKGROUND: `<rect x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" fill="${roles.SURFACE}"/>`,
  DECORATIONS: '',
  NUMBERING: '',
  // Content
  KICKER: '5 SIGNS',
  HEADLINE_LINE_1: 'Your lead magnet',
  HEADLINE_LINE_2: "isn't converting",
  BRAND_HANDLE: '@nodeagency',
};

const pattern = process.argv[2];
const template = readFileSync(join(PLUGIN_ROOT, 'patterns', `${pattern}.svg`), 'utf8');
const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
mkdirSync(`/tmp/v04-${pattern}`, { recursive: true });
writeFileSync(`/tmp/v04-${pattern}/slide.svg`, out);
console.log(`\u2713 /tmp/v04-${pattern}/slide.svg`);
