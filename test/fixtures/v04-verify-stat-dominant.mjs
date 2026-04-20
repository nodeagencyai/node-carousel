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
  ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,
  // Stat anchors
  ANCHOR_STAT_Y: 600,
  ANCHOR_STAT_LABEL_Y: 704,
  ANCHOR_STAT_CONTEXT_Y: 776,
  // Type
  TYPE_BODY: TYPE.body,
  TYPE_SUBHEAD: TYPE.subhead,
  TYPE_STAT: TYPE.stat,
  TYPE_LETTERSPACE_STAT: letterSpacingForSize(TYPE.stat),
  // Colors
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
  // Slots
  BACKGROUND: `<rect x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" fill="${roles.SURFACE}"/>`,
  DECORATIONS: '',
  NUMBERING: '',
  // Stat content
  STAT_VALUE: '73%',
  STAT_LABEL: 'of AI projects never ship',
  STAT_CONTEXT: 'Gartner, 2024',
  BRAND_HANDLE: '@nodeagency',
};

const pattern = process.argv[2];
const template = readFileSync(join(PLUGIN_ROOT, 'patterns', `${pattern}.svg`), 'utf8');
const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
mkdirSync(`/tmp/v04-${pattern}`, { recursive: true });
writeFileSync(`/tmp/v04-${pattern}/slide.svg`, out);
console.log(`\u2713 /tmp/v04-${pattern}/slide.svg`);
