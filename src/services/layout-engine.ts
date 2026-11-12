import { METADATA_FIELDS, type ArtworkMetadata } from '../types/artwork';

/**
 * Proportional layout defaults. Every distance is a multiple of the cropped artwork
 * width (W), so the sheet scales with the artwork and the preview is an exact miniature
 * of the export. Recalibrate the composition here; the renderer reads nothing else.
 * Sheet width is W + 2 × artworkX × W (1.5 W, so the artwork fills two thirds of it).
 */
export const LAYOUT = {
  artworkX: 0.25,
  topMargin: 0.16,
  metadataGap: 0.02,
  fontSize: 0.035,
  /** Smallest font the metadata may shrink to before the line is reported as too long. */
  minFontSize: 0.022,
  /** Line box height as a multiple of the base font size. */
  lineHeight: 1.25,
  bottomMargin: 0.25,
  /** Smallest acceptable space between two fields, as a multiple of the font size. */
  minFieldSpacing: 1.0,
  textColor: '#1a1a1a',
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
} as const;

/** Advance width of `text` at `fontSize` pixels in LAYOUT.fontFamily. */
export type MeasureText = (text: string, fontSize: number) => number;

export interface PlacedField {
  text: string;
  x: number;
  width: number;
}

export interface SheetLayout {
  sheetWidth: number;
  sheetHeight: number;
  artwork: { x: number; y: number; width: number; height: number };
  metadata: {
    /** Top of the text line (draw with textBaseline = 'top'). */
    y: number;
    fontSize: number;
    fields: PlacedField[];
    /** True when the fields cannot fit on one line even at the minimum font size. */
    overflow: boolean;
  };
}

export function metadataValues(metadata: ArtworkMetadata): string[] {
  return METADATA_FIELDS.map((field) => metadata[field].trim()).filter((value) => value.length > 0);
}

/**
 * Lays out the sheet for an artwork crop of `artworkWidth` × `artworkHeight` pixels.
 * The artwork sits at integer coordinates at its own size: it is drawn 1:1, never resampled.
 */
export function computeLayout(
  artworkWidth: number,
  artworkHeight: number,
  metadata: ArtworkMetadata,
  measure: MeasureText,
): SheetLayout {
  const W = artworkWidth;
  const artX = Math.round(LAYOUT.artworkX * W);
  const artY = Math.round(LAYOUT.topMargin * W);
  const baseFont = LAYOUT.fontSize * W;
  const textY = artY + artworkHeight + Math.round(LAYOUT.metadataGap * W);
  const sheetHeight = Math.round(textY + baseFont * LAYOUT.lineHeight + LAYOUT.bottomMargin * W);
  // Equal side margins: sheet = artwork + 2 × left margin (= 1.5 W up to rounding).
  const sheetWidth = W + 2 * artX;

  const { fontSize, fields, overflow } = justify(
    metadataValues(metadata),
    artX,
    W,
    baseFont,
    LAYOUT.minFontSize * W,
    measure,
  );

  return {
    sheetWidth,
    sheetHeight,
    artwork: { x: artX, y: artY, width: W, height: artworkHeight },
    metadata: { y: textY, fontSize, fields, overflow },
  };
}

/**
 * Spreads the values across exactly `lineWidth`: first value flush left, last flush right,
 * equal gaps between. A single value is left-aligned. Text shrinks proportionally when
 * needed; below the minimum size the values are laid out left to right and flagged.
 */
export function justify(
  values: string[],
  left: number,
  lineWidth: number,
  baseFont: number,
  minFont: number,
  measure: MeasureText,
): { fontSize: number; fields: PlacedField[]; overflow: boolean } {
  if (values.length === 0) return { fontSize: baseFont, fields: [], overflow: false };

  const requiredAt = (fontSize: number) =>
    values.reduce((sum, v) => sum + measure(v, fontSize), 0) +
    (values.length - 1) * LAYOUT.minFieldSpacing * fontSize;

  let fontSize = baseFont;
  const required = requiredAt(fontSize);
  if (required > lineWidth) {
    // Widths scale linearly with font size, so one proportional step lands on the fit;
    // the loop only absorbs rounding in real font rasterisation.
    fontSize = baseFont * (lineWidth / required);
    while (fontSize >= minFont && requiredAt(fontSize) > lineWidth) fontSize *= 0.99;
    if (fontSize < minFont) {
      fontSize = minFont;
      let x = left;
      const fields = values.map((text) => {
        const width = measure(text, fontSize);
        const field = { text, x, width };
        x += width + LAYOUT.minFieldSpacing * fontSize;
        return field;
      });
      return { fontSize, fields, overflow: true };
    }
  }

  const widths = values.map((v) => measure(v, fontSize));
  if (values.length === 1) {
    return { fontSize, fields: [{ text: values[0], x: left, width: widths[0] }], overflow: false };
  }
  const gap = (lineWidth - widths.reduce((a, b) => a + b, 0)) / (values.length - 1);
  let x = left;
  const fields = values.map((text, i) => {
    const field = { text, x, width: widths[i] };
    x += widths[i] + gap;
    return field;
  });
  // Pin the last field exactly to the right edge, absorbing floating-point drift.
  const last = fields[fields.length - 1];
  last.x = left + lineWidth - last.width;
  return { fontSize, fields, overflow: false };
}
