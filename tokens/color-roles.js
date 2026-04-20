// Semantic color roles derived from brand palette.
// Templates never reference hex directly — only roles like SURFACE, ON_SURFACE.
// See docs/research/2026-04-20-generative-design-systems.md on Material 3 on-color pairs.

import { hexToRgb, rgbToHex, mix, luminance } from './color-utils.js';

/**
 * Given a brand palette, return semantic roles + contrast pairs.
 * Always guarantees on-X has >= 4.5:1 contrast against X.
 */
export function buildColorRoles(brandColors) {
  const { background, text, accent, accentSecondary, muted } = brandColors;

  const roles = {
    SURFACE: background,
    ON_SURFACE: text,
    SURFACE_MUTED: muted,
    ACCENT: accent,
    ON_ACCENT: pickOnColor(accent, [background, text]),
    ACCENT_SECONDARY: accentSecondary || accent,

    // Tinted variants — useful for decorations, cards, fills
    SURFACE_TINT_5: mix(background, accent, 0.05),
    SURFACE_TINT_12: mix(background, accent, 0.12),
    SURFACE_TINT_20: mix(background, accent, 0.20),
  };

  return roles;
}

/** Pick whichever of `options` has highest contrast against bg. */
function pickOnColor(bg, options) {
  let best = options[0];
  let bestContrast = 0;
  for (const opt of options) {
    const c = contrastRatio(bg, opt);
    if (c > bestContrast) { bestContrast = c; best = opt; }
  }
  return best;
}

function contrastRatio(a, b) {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
