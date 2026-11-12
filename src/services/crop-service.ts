import type { AspectRatioId, CropRect } from '../types/artwork';

export const ASPECT_RATIO_LABELS: Record<AspectRatioId, string> = {
  original: 'Original',
  free: 'Free',
  '16:9': '16:9',
  '9:16': '9:16',
  '3:4': '3:4',
  '4:3': '4:3',
  '5:4': '5:4',
  '4:5': '4:5',
};

/** Width ÷ height for the ratio, or NaN for free cropping (the Cropper.js convention). */
export function aspectRatioValue(id: AspectRatioId, imageWidth: number, imageHeight: number): number {
  switch (id) {
    case 'original':
      return imageWidth / imageHeight;
    case 'free':
      return NaN;
    default: {
      const [w, h] = id.split(':').map(Number);
      return w / h;
    }
  }
}

/** The largest crop of the given ratio, centred in the image. */
export function defaultCrop(id: AspectRatioId, imageWidth: number, imageHeight: number): CropRect {
  const ratio = aspectRatioValue(id, imageWidth, imageHeight);
  if (id === 'original' || !Number.isFinite(ratio)) {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  }
  let width = imageWidth;
  let height = Math.round(width / ratio);
  if (height > imageHeight) {
    height = imageHeight;
    width = Math.round(height * ratio);
  }
  return {
    x: Math.floor((imageWidth - width) / 2),
    y: Math.floor((imageHeight - height) / 2),
    width,
    height,
  };
}

/** Rounds to whole pixels and clamps inside the image; null for an empty rectangle. */
export function normalizeCrop(rect: CropRect, imageWidth: number, imageHeight: number): CropRect | null {
  const x = Math.min(Math.max(0, Math.round(rect.x)), imageWidth - 1);
  const y = Math.min(Math.max(0, Math.round(rect.y)), imageHeight - 1);
  const width = Math.min(Math.round(rect.width), imageWidth - x);
  const height = Math.min(Math.round(rect.height), imageHeight - y);
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}
