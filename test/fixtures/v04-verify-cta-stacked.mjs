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
const buttonWidth = 560;
const buttonHeight = 112;
const buttonX = Math.round((CANVAS.width - buttonWidth) / 2);   // 260
const buttonY = 816;
const buttonRx = Math.round(buttonHeight / 2);                    // 56 — pill shape
const buttonTextY = buttonY + Math.round(buttonHeight * 0.642);   // 888 — optical center for 36px text
const subtextY = buttonY + buttonHeight + 64;                     // 992
const hookDY = Math.round(TYPE.headline * 1.18);                  // 104 — airy display line-height

const values = {
  WIDTH: CANVAS.width,
  HEIGHT: CANVAS.height,
  CENTER_X: centerX,
  COL_1_X: COLS[0],
  WIDTH_MINUS_MARGIN: CANVAS.width - GRID.sideMargin,
  ANCHOR_BODY_TOP: ANCHORS.BODY_TOP,
  ANCHOR_BODY_BOTTOM: ANCHORS.BODY_BOTTOM,
  ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,
  // CTA geometry
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
  // Type
  TYPE_BODY: TYPE.body,
  TYPE_BODY_LARGE: TYPE.bodyLarge,
  TYPE_HEADLINE: TYPE.headline,
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
  // Content — terminal CTA slide
  HOOK_LINE_1: 'Building one',
  HOOK_LINE_2: 'yourself?',
  BUTTON: 'DM AUDIT',
  SUBTEXT: "I'll review your setup",
  BRAND_HANDLE: '@nodeagency',
};

const pattern = process.argv[2];
const template = readFileSync(join(PLUGIN_ROOT, 'patterns', `${pattern}.svg`), 'utf8');
const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
mkdirSync(`/tmp/v04-${pattern}`, { recursive: true });
writeFileSync(`/tmp/v04-${pattern}/slide.svg`, out);
console.log(`\u2713 /tmp/v04-${pattern}/slide.svg`);
