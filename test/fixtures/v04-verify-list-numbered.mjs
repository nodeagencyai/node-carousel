import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TYPE, letterSpacingForSize, lineHeightForSize, fontStack } from '../../tokens/typography.js';
import { SPACING } from '../../tokens/spacing.js';
import { CANVAS, COLS, ANCHORS, GRID } from '../../tokens/grid.js';
import { buildColorRoles } from '../../tokens/color-roles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..', '..');

const fonts = { display: 'Instrument Serif', body: 'Inter' };
const colors = { background: '#0f0f0f', text: '#FFFFFF', accent: '#29F2FE', muted: '#999999' };
const roles = buildColorRoles(colors);

// Row spacing for list-numbered: 96px (numbers are taller — need more breathing)
const ROW_SPACING = 96;

const values = {
  WIDTH: CANVAS.width,
  HEIGHT: CANVAS.height,
  COL_1_X: COLS[0],
  WIDTH_MINUS_MARGIN: CANVAS.width - GRID.sideMargin,
  ANCHOR_BODY_TOP: ANCHORS.BODY_TOP,
  ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,
  LIST_GROUP_Y: ANCHORS.BODY_TOP + 192,  // headline + space-10 gap = 552
  TYPE_BODY: TYPE.body,
  TYPE_BODY_LARGE: TYPE.bodyLarge,
  TYPE_LABEL: TYPE.label,
  TYPE_SUBHEAD: TYPE.subhead,
  SUBHEAD_LETTER_SPACING: letterSpacingForSize(TYPE.subhead),
  // Cumulative row offsets for the 5 rows (0, 96, 192, 288, 384)
  ROW_SPACING_NUMBERED: ROW_SPACING,
  ROW_SPACING_NUMBERED_2: ROW_SPACING * 2,
  ROW_SPACING_NUMBERED_3: ROW_SPACING * 3,
  ROW_SPACING_NUMBERED_4: ROW_SPACING * 4,
  SURFACE: roles.SURFACE,
  ON_SURFACE: roles.ON_SURFACE,
  SURFACE_MUTED: roles.SURFACE_MUTED,
  ACCENT: roles.ACCENT,
  FONT_DISPLAY: fonts.display,
  FONT_BODY: fonts.body,
  FONT_DISPLAY_URL: fonts.display.replace(/\s+/g, '+'),
  FONT_BODY_URL: fonts.body.replace(/\s+/g, '+'),
  FONT_DISPLAY_STACK: fontStack(fonts.display, 'serif'),
  FONT_BODY_STACK: fontStack(fonts.body, 'sans'),
  BACKGROUND: `<rect x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" fill="${roles.SURFACE}"/>`,
  DECORATIONS: '',
  NUMBERING: '',
  BRAND_HANDLE: '@nodeagency',
  // Content — realistic 3-bullet slide (tests empty-slot handling)
  HEADLINE: 'The five tells',
  ITEM_1: 'Stack grew beyond your team',
  ITEM_2: 'Features no one uses ship anyway',
  ITEM_3: 'Onboarding takes a week to explain',
  ITEM_4: '',
  ITEM_5: '',
  // Arrows/numbers: simulate what render.mjs will compute — only present when ITEM has content
  ARROW_1: '\u2192', ARROW_2: '\u2192', ARROW_3: '\u2192', ARROW_4: '', ARROW_5: '',
  ITEM_NUMBER_1: '01', ITEM_NUMBER_2: '02', ITEM_NUMBER_3: '03', ITEM_NUMBER_4: '', ITEM_NUMBER_5: '',
};

const pattern = process.argv[2];
const template = readFileSync(join(PLUGIN_ROOT, 'patterns', `${pattern}.svg`), 'utf8');
const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
mkdirSync(`/tmp/v04-${pattern}`, { recursive: true });
writeFileSync(`/tmp/v04-${pattern}/slide.svg`, out);
console.log(`\u2713 /tmp/v04-${pattern}/slide.svg`);
