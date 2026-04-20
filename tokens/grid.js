// 1080x1350 Instagram 4:5. 6-col grid chosen because it divides 1080
// cleanly with 72px side margins and 24px gutters (6*136 + 5*24 + 2*72 = 1080).
// 24px baseline rows, 56 rows tall (56 * 24 = 1344, plus 6px top offset).
// See docs/research/2026-04-20-grid-and-spacing-systems.md.

export const CANVAS = { width: 1080, height: 1350 };

export const GRID = {
  columns: 6,
  columnWidth: 136,
  gutter: 24,
  sideMargin: 72,
  topMargin: 96,      // clears IG UI overlay
  bottomMargin: 96,   // clears like/save buttons
  rowHeight: 24,      // baseline
};

// Precomputed column x-positions
export const COLS = (() => {
  const xs = [];
  let x = GRID.sideMargin;
  for (let i = 0; i < GRID.columns; i++) {
    xs.push(x);
    x += GRID.columnWidth + GRID.gutter;
  }
  return xs;
})();

// Named vertical anchors on the 1080x1350 canvas.
// All values land on 8px baseline (multiples of 8).
export const ANCHORS = {
  // Flag zone (above-the-fold of IG scroll)
  FLAG_TOP: 96,          // kicker/category lives here
  FLAG_BOTTOM: 200,

  // Golden ratio upper third — hero headline on cover slides
  GOLDEN_UPPER: 515,

  // Optical center — headline on body slides (slightly above geometric)
  OPTICAL_CENTER: 620,

  // Geometric center
  CENTER: 675,

  // Body zones
  BODY_TOP: 360,
  BODY_BOTTOM: 1152,

  // Footer zone (brand attribution, numbering)
  FOOTER_TOP: 1176,
  FOOTER_CENTER: 1224,
  FOOTER_BOTTOM: 1256,
};

// Convenience: column x-position for span
export function col(startCol, span = 1) {
  const x = COLS[startCol];
  const width = span * GRID.columnWidth + (span - 1) * GRID.gutter;
  return { x, width };
}

// Convenience: row y-position (1-indexed from topMargin)
export function row(n) {
  return GRID.topMargin + (n - 1) * GRID.rowHeight;
}
