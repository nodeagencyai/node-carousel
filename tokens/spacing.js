// 8px base unit. space-1 = 4px is reserved for within-element (icon padding, etc).
// Rest all multiples of 8 to stay on baseline grid.
// See docs/research/2026-04-20-grid-and-spacing-systems.md.

export const SPACE = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 16,
  '4': 24,
  '5': 32,
  '6': 48,
  '7': 64,
  '8': 96,
  '9': 144,
  '10': 192,
};

// Semantic aliases
export const SPACING = {
  tight: SPACE['2'],        // 8 — within-element
  snug: SPACE['3'],         // 16 — bullets, inline
  default: SPACE['4'],      // 24 — between related elements
  group: SPACE['5'],        // 32 — between grouped items
  section: SPACE['6'],      // 48 — between zones
  zone: SPACE['7'],         // 64 — major zones
  hero: SPACE['8'],         // 96 — hero breathing
  dominant: SPACE['9'],     // 144 — dominant whitespace
};

// Optical equivalence: larger elements need proportionally more space before them.
// Returns space in px. Use as y-offset before an element of the given size.
export function opticalSpacing(elementTypeSize, role = 'peer') {
  const factor = { peer: 1.0, subordinate: 0.75, footer: 2.0 }[role] ?? 1.0;
  const raw = elementTypeSize * factor;
  // Round to nearest 8 (baseline grid).
  return Math.round(raw / 8) * 8;
}
