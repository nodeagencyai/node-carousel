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

const centerX = Math.round(CANVAS.width / 2);

const values = {
  WIDTH: CANVAS.width,
  HEIGHT: CANVAS.height,
  CENTER_X: centerX,
  COL_1_X: COLS[0],
  WIDTH_MINUS_MARGIN: CANVAS.width - GRID.sideMargin,
  ANCHOR_BODY_TOP: ANCHORS.BODY_TOP,
  ANCHOR_BODY_BOTTOM: ANCHORS.BODY_BOTTOM,
  ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,
  // Split-comparison zone anchors — quarter positions for balanced two-zone layout
  LEFT_ZONE_CENTER_X: 270,           // quarter of 1080
  RIGHT_ZONE_CENTER_X: 810,          // three-quarters of 1080
  ANCHOR_ZONE_LABEL_Y: 440,          // label above content lines
  ANCHOR_LINE_1_Y: 560,              // row 1 (80px gap from label)
  ANCHOR_LINE_2_Y: 648,              // row 2 (88px row spacing — matches display at 36px)
  ANCHOR_LINE_3_Y: 736,              // row 3
  // Type
  TYPE_BODY: TYPE.body,
  TYPE_BODY_LARGE: TYPE.bodyLarge,
  // Colors
  SURFACE: roles.SURFACE,
  ON_SURFACE: roles.ON_SURFACE,
  SURFACE_MUTED: roles.SURFACE_MUTED,
  ACCENT: roles.ACCENT,
  ON_ACCENT: roles.ON_ACCENT,
  // Fonts
  FONT_DISPLAY: fonts.display,
  FONT_BODY: fonts.body,
  FONT_DISPLAY_URL: fonts.display.replace(/\s+/g, '+'),
  FONT_BODY_URL: fonts.body.replace(/\s+/g, '+'),
  FONT_DISPLAY_STACK: fontStack(fonts.display, 'serif'),
  FONT_BODY_STACK: fontStack(fonts.body, 'sans'),
  // Slots
  BACKGROUND: `<rect x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" fill="${roles.SURFACE}"/>`,
  DECORATIONS: '',
  NUMBERING: '',
  // Content — before/after narrative
  LEFT_LABEL: 'BEFORE',
  LEFT_LINE_1: 'Manual triage',
  LEFT_LINE_2: 'Inbox chaos',
  LEFT_LINE_3: 'Missed replies',
  RIGHT_LABEL: 'AFTER',
  RIGHT_LINE_1: 'AI-routed tickets',
  RIGHT_LINE_2: 'Zero inbox',
  RIGHT_LINE_3: 'Zero misses',
  BRAND_HANDLE: '@nodeagency',
};

const pattern = process.argv[2];
const template = readFileSync(join(PLUGIN_ROOT, 'patterns', `${pattern}.svg`), 'utf8');
const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
mkdirSync(`/tmp/v04-${pattern}`, { recursive: true });
writeFileSync(`/tmp/v04-${pattern}/slide.svg`, out);
console.log(`\u2713 /tmp/v04-${pattern}/slide.svg`);
