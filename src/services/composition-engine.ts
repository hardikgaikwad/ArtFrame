import type { CropRect } from '../types/artwork';
import { fontString } from '../utils/text-measurement';
import { fitWithin } from '../utils/image-dimensions';
import { releaseCanvas } from '../utils/memory-manager';
import { LAYOUT, type SheetLayout } from './layout-engine';

export interface DrawSource {
  image: CanvasImageSource;
  /** Source pixels per full-resolution pixel: 1 for the original, < 1 for the preview copy. */
  scale: number;
}

/**
 * Draws the horizontal band [bandTop, bandTop + bandHeight) of the sheet (in full-resolution
 * sheet pixels) onto `ctx`, scaled by `outputScale`. Preview and export both use this, so
 * they cannot drift apart. At outputScale 1 with the original source, artwork pixels are
 * copied 1:1 to integer positions — the image is never resampled.
 */
export function drawSheetBand(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  crop: CropRect,
  source: DrawSource,
  outputScale: number,
  bandTop: number,
  bandHeight: number,
): void {
  ctx.save();
  ctx.setTransform(outputScale, 0, 0, outputScale, 0, -bandTop * outputScale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, bandTop, layout.sheetWidth, bandHeight);

  // Only the artwork rows inside this band are drawn, so strip rendering never
  // asks the browser to process the whole source image per strip.
  const art = layout.artwork;
  const top = Math.max(art.y, bandTop);
  const bottom = Math.min(art.y + art.height, bandTop + bandHeight);
  if (bottom > top) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const s = source.scale;
    ctx.drawImage(
      source.image,
      crop.x * s,
      (crop.y + (top - art.y)) * s,
      crop.width * s,
      (bottom - top) * s,
      art.x,
      top,
      art.width,
      bottom - top,
    );
  }

  const meta = layout.metadata;
  if (meta.fields.length && meta.y < bandTop + bandHeight && meta.y + meta.fontSize * 1.5 > bandTop) {
    ctx.fillStyle = LAYOUT.textColor;
    ctx.font = fontString(meta.fontSize);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (const field of meta.fields) ctx.fillText(field.text, field.x, meta.y);
  }
  ctx.restore();
}

export function drawWholeSheet(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  crop: CropRect,
  source: DrawSource,
  outputScale: number,
): void {
  drawSheetBand(ctx, layout, crop, source, outputScale, 0, layout.sheetHeight);
}

/**
 * A reduced copy of the image for on-screen preview only. Export never uses it.
 */
export function createPreviewSource(image: CanvasImageSource, width: number, height: number, maxSide = 1600): {
  source: DrawSource;
  release(): void;
} {
  const size = fitWithin(width, height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, size.width, size.height);
  return { source: { image: canvas, scale: size.width / width }, release: () => releaseCanvas(canvas) };
}
