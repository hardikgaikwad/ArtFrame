/**
 * Canvas allocation and release. Mobile browsers fail oversized canvases silently
 * (iOS Safari returns a context that draws nothing), so every large canvas is verified
 * by drawing and reading back a pixel before it is trusted.
 */

// Hard browser ceilings (Chromium: 32767 px per side, ~268 MP area). Anything above
// these is rejected without trying, because attempting it can crash the tab.
const MAX_SIDE = 32767;
const MAX_AREA = 268_435_456;

export function estimateCanvasBytes(width: number, height: number): number {
  return width * height * 4;
}

const MB = 1024 * 1024;

/**
 * Largest single canvas we are willing to allocate. Mobile browsers often kill the tab
 * instead of failing an oversized allocation, so we refuse before trying. Chrome reports
 * approximate device RAM (navigator.deviceMemory); Safari does not, so it gets a
 * conservative fixed budget (iPad canvas limits are lower than this anyway).
 */
export function canvasMemoryBudget(): number {
  const deviceGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (!deviceGb) return 256 * MB;
  return Math.min(512 * MB, Math.max(128 * MB, (deviceGb * 1024 * MB) / 8));
}

/** Creates an opaque canvas of the given size, or returns null when the device cannot provide one. */
export function tryCreateCanvas(
  width: number,
  height: number,
  options: { willReadFrequently?: boolean } = {},
): HTMLCanvasElement | null {
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_AREA) {
    return null;
  }
  if (estimateCanvasBytes(width, height) > canvasMemoryBudget()) return null;
  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: options.willReadFrequently ?? false });
    if (!ctx || canvas.width !== width || canvas.height !== height) {
      releaseCanvas(canvas);
      return null;
    }
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const pixel = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    // A canvas the device could not really allocate reads back black. The check is
    // deliberately not exact: privacy features (e.g. Brave) add ±1 noise to readback.
    if (pixel[0] < 200 || pixel[1] > 55 || pixel[2] > 55) {
      releaseCanvas(canvas);
      return null;
    }
    return canvas;
  } catch {
    releaseCanvas(canvas);
    return null;
  }
}

/** Frees the canvas backing store immediately (Safari otherwise keeps it until GC). */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * The largest scale (≤ 1, to 1% precision) at which a width × height canvas can be
 * allocated on this device. Only used to *offer* a smaller file; never applied silently.
 */
export function largestSupportedScale(width: number, height: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const canvas = tryCreateCanvas(Math.round(width * mid), Math.round(height * mid));
    if (canvas) {
      lo = mid;
      releaseCanvas(canvas);
    } else {
      hi = mid;
    }
  }
  return Math.floor(lo * 100) / 100;
}

/** Tracks object URLs for one owner so they can all be revoked together. */
export class ObjectUrlSet {
  private urls = new Set<string>();

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  revokeAll(): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

let readbackExact: boolean | null = null;

/**
 * Whether pixels read back from a canvas are exactly what was drawn. Anti-fingerprinting
 * features (Brave Shields, Firefox resistFingerprinting, Safari Private Browsing) add small
 * random changes, which would also slightly alter exported artwork pixels.
 */
export function canvasReadbackIsExact(): boolean {
  if (readbackExact !== null) return readbackExact;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return (readbackExact = false);
  const pattern = ctx.createImageData(size, size);
  for (let i = 0; i < pattern.data.length; i += 4) {
    pattern.data[i] = (i * 7) & 0xff;
    pattern.data[i + 1] = (i * 13) & 0xff;
    pattern.data[i + 2] = (i * 29) & 0xff;
    pattern.data[i + 3] = 255;
  }
  ctx.putImageData(pattern, 0, 0);
  const back = ctx.getImageData(0, 0, size, size).data;
  readbackExact = back.every((value, i) => value === pattern.data[i]);
  releaseCanvas(canvas);
  return readbackExact;
}
