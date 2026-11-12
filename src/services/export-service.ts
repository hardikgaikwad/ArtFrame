import type { CropRect, ExportFormat } from '../types/artwork';
import { UserFacingError } from '../utils/errors';
import { largestSupportedScale, releaseCanvas, tryCreateCanvas } from '../utils/memory-manager';
import { drawSheetBand, drawWholeSheet, type DrawSource } from './composition-engine';
import type { SheetLayout } from './layout-engine';
import { canStreamPng, encodePng } from './png-encoder';
import { createPdf, PRINT_DPI } from './pdf-service';

export const JPEG_QUALITY = 0.98;
/** Pixels per PNG strip (~16 MB of canvas memory). */
const STRIP_PIXELS = 4_000_000;

export interface ExportRequest {
  format: ExportFormat;
  layout: SheetLayout;
  crop: CropRect;
  /** Must be the full-resolution image (scale 1), never the preview copy. */
  source: DrawSource;
  /** 1 = full size. Anything smaller is only ever used when the artist explicitly chose it. */
  scale: number;
  title: string;
}

/** The device cannot hold the canvas this export needs. `maxScale` is the largest size it can make (0 = none). */
export class ExportTooLargeError extends UserFacingError {
  constructor(readonly maxScale: number) {
    super('This device does not have enough memory to make this file at full size.');
    this.name = 'ExportTooLargeError';
  }
}

export function outputSize(layout: SheetLayout, scale: number): { width: number; height: number } {
  return { width: Math.round(layout.sheetWidth * scale), height: Math.round(layout.sheetHeight * scale) };
}

export async function renderExport(request: ExportRequest, onProgress?: (fraction: number) => void): Promise<Blob> {
  if (request.source.scale !== 1) throw new Error('Export must use the full-resolution image');
  const { width, height } = outputSize(request.layout, request.scale);

  if (request.format === 'png' && canStreamPng()) {
    return renderPngInStrips(request, width, height, onProgress);
  }

  const canvas = tryCreateCanvas(width, height);
  if (!canvas) throw new ExportTooLargeError(largestSupportedScale(width, height));
  let blob: Blob;
  try {
    const ctx = canvas.getContext('2d', { alpha: false })!;
    drawWholeSheet(ctx, request.layout, request.crop, request.source, request.scale);
    onProgress?.(0.5);
    const type = request.format === 'png' ? 'image/png' : 'image/jpeg';
    blob = await canvasToBlob(canvas, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined);
  } finally {
    releaseCanvas(canvas);
  }
  if (request.format === 'pdf') {
    onProgress?.(0.8);
    blob = await createPdf(blob, width, height, request.title);
  }
  onProgress?.(1);
  return blob;
}

async function renderPngInStrips(
  request: ExportRequest,
  width: number,
  height: number,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const stripHeight = Math.max(1, Math.min(height, Math.floor(STRIP_PIXELS / width)));
  // willReadFrequently keeps the strip in CPU memory, since every strip is read back.
  const strip = tryCreateCanvas(width, stripHeight, { willReadFrequently: true });
  if (!strip) throw new ExportTooLargeError(0);
  const ctx = strip.getContext('2d', { alpha: false, willReadFrequently: true })!;
  const { layout, crop, source, scale } = request;

  async function* rows() {
    for (let y = 0; y < height; y += stripHeight) {
      const rowsInStrip = Math.min(stripHeight, height - y);
      drawSheetBand(ctx, layout, crop, source, scale, y / scale, rowsInStrip / scale);
      yield ctx.getImageData(0, 0, width, rowsInStrip).data;
      // Let the page repaint the progress indicator between strips.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  try {
    return await encodePng(width, height, rows(), {
      dpi: PRINT_DPI,
      onRows: (done) => onProgress?.(done / height),
    });
  } finally {
    releaseCanvas(strip);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ExportTooLargeError(0))),
      type,
      quality,
    );
  });
}

/** Starts a browser download. The temporary URL is revoked later: revoking at once breaks Safari downloads. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFile(blob: Blob, filename: string): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });
  } catch {
    return false;
  }
}

/** Opens the system share sheet (Save Image / Save to Files on iPad). Must be called from a tap. */
export async function shareBlob(blob: Blob, filename: string): Promise<void> {
  await navigator.share({ files: [new File([blob], filename, { type: blob.type })] });
}
