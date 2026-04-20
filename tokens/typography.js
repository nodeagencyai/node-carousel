// Perfect Fourth modular scale (ratio 1.333), base 16px
// Every value quantized to 4px so it lands on the 8px baseline grid.
// See docs/research/2026-04-20-typography-systems.md for derivation.

export const TYPE_SCALE = {
  '-2': 12,   // micro caption
  '-1': 12,
  '0': 16,    // body base
  '+1': 20,
  '+2': 28,
  '+3': 36,   // large body
  '+4': 48,   // label
  '+5': 64,   // sub-headline
  '+6': 88,   // headline
  '+7': 116,  // hero headline
  '+8': 156,  // display stat (replaces current 240)
  '+9': 208,  // hero stat
  '+10': 276, // oversized hero display
};

// Semantic aliases — use these in templates, not raw steps.
export const TYPE = {
  micro: TYPE_SCALE['-1'],       // 12
  caption: TYPE_SCALE['+1'],     // 20 (upgrade from 16)
  body: TYPE_SCALE['+2'],        // 28
  bodyLarge: TYPE_SCALE['+3'],   // 36
  label: TYPE_SCALE['+4'],       // 48
  subhead: TYPE_SCALE['+5'],     // 64
  headline: TYPE_SCALE['+6'],    // 88
  hero: TYPE_SCALE['+7'],        // 116
  stat: TYPE_SCALE['+8'],        // 156 (replaces broken 280)
  statHero: TYPE_SCALE['+9'],    // 208
};

// Letter-spacing at display scale — tightens with size.
// Add to the CSS class in templates.
export function letterSpacingForSize(px) {
  if (px <= 36) return '0';
  if (px <= 64) return '-0.02em';
  if (px <= 120) return '-0.03em';
  if (px <= 200) return '-0.04em';
  return '-0.05em';
}

// Line-height at display scale.
export function lineHeightForSize(px) {
  if (px <= 36) return 1.4;
  if (px <= 64) return 1.15;
  if (px <= 120) return 1.05;
  return 1.0;
}

// Font stack by class — always include fallback.
export function fontStack(familyName, kind = 'sans') {
  const fallback = kind === 'serif' ? 'serif' : kind === 'mono' ? 'ui-monospace, monospace' : 'sans-serif';
  return `'${familyName}', ${fallback}`;
}
