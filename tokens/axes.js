// 6 orthogonal variation axes. Each carousel samples one value per axis.
// See docs/research/2026-04-20-creator-visual-patterns.md § "orthogonal axes".

export const AXES = {
  // How content fills the grid
  density: [
    { name: 'airy', bodyColumns: 4, padding: 'SECTION' },    // 4 of 6 cols, lots of breathing
    { name: 'balanced', bodyColumns: 5, padding: 'DEFAULT' },
    { name: 'dense', bodyColumns: 6, padding: 'SNUG' },
  ],
  // Where the visual weight lands
  composition: [
    'centered',         // symmetric, classic
    'ragged-left',      // editorial, asymmetric left
    'ragged-right',     // mirror of ragged-left
    'split-vertical',   // 2-zone stacked
    'split-horizontal', // 2-zone side-by-side
  ],
  // Which word/element takes the accent color
  emphasis: [
    'first-word',
    'last-word',
    'middle-noun',
    'hero-only',        // only the stat/number gets accent
    'none',             // pure monochrome, no accent word
  ],
  // How many focal elements per slide
  hierarchy: [
    { name: 'single', maxFocal: 1 },     // one hero thing
    { name: 'pair', maxFocal: 2 },       // hero + sub
    { name: 'list', maxFocal: 5 },       // bullet-style
  ],
  // Where the brand accent appears
  accentPlacement: [
    'headline-word',
    'underline-rule',
    'corner-chip',
    'border-frame',
    'tint-surface',
    'none',
  ],
  // Which decorative atoms compose on each slide
  decorationMix: [
    [],                            // clean
    ['cornerMarks'],
    ['accentRule'],
    ['accentRule', 'numberBadges'],
    ['oversizedMark'],
    ['pullQuoteBlock'],
    ['cornerMarks', 'accentRule'],
  ],
};

// Sample an axis profile for a carousel given a seeded RNG.
// This is the "personality" of this specific carousel run.
export function sampleCarouselAxes(rng) {
  return {
    density: rng.pick(AXES.density),
    composition: rng.pick(AXES.composition),
    emphasis: rng.pick(AXES.emphasis),
    hierarchy: rng.pick(AXES.hierarchy),
    accentPlacement: rng.pick(AXES.accentPlacement),
    decorationMix: rng.pick(AXES.decorationMix),
  };
}
