import type { ImageFormat } from '../types/artwork';
import { UserFacingError } from '../utils/errors';
import { withExifOrientation } from '../utils/image-dimensions';
import { convertHeicToPng } from './heic-converter';

/** Upload limits chosen to stay within the memory of the target tablet and phone. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;

const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

export const ACCEPT_ATTRIBUTE = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

/** A decoded, upright image ready for drawing. Keep it alive while drawing; call release() when done. */
export interface DecodedImage {
  element: HTMLImageElement;
  url: string;
  width: number;
  height: number;
  release(): void;
}

export interface LoadedUpload {
  format: ImageFormat;
  mimeType: string;
  /** Lossless decodable copy when the original cannot be decoded by this browser. */
  working: Blob | null;
  image: DecodedImage;
}

/** Identifies the format from the file's leading bytes; extensions and MIME types are not trusted. */
export async function sniffFormat(blob: Blob): Promise<ImageFormat | null> {
  const b = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp') {
    const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'];
    const major = ascii(8, 12);
    if (heicBrands.includes(major)) return 'heic';
    if (major === 'mif1' || major === 'msf1') {
      // Generic HEIF container: accept unless it is really AVIF.
      const boxSize = Math.min(new DataView(b.buffer).getUint32(0), b.length);
      const compatible: string[] = [];
      for (let i = 16; i + 4 <= boxSize; i += 4) compatible.push(ascii(i, i + 4));
      if (compatible.some((brand) => heicBrands.includes(brand))) return 'heic';
      if (!compatible.some((brand) => brand === 'avif' || brand === 'avis')) return 'heic';
    }
  }
  return null;
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  const element = new Image();
  element.decoding = 'async';
  element.src = url;
  const loaded = new Promise<void>((resolve, reject) => {
    if (element.complete && element.naturalWidth) resolve();
    element.onload = () => resolve();
    element.onerror = () => reject(new Error('Image failed to load'));
  });
  try {
    try {
      await element.decode();
    } catch {
      // WebKit has rejected decode() for some large but valid images; the load event decides.
      await loaded;
    }
    if (!element.naturalWidth || !element.naturalHeight) throw new Error('Image has no dimensions');
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    element,
    url,
    // naturalWidth/Height are already EXIF-oriented (verified by browserAppliesExifOrientation).
    width: element.naturalWidth,
    height: element.naturalHeight,
    release() {
      element.removeAttribute('src');
      URL.revokeObjectURL(url);
    },
  };
}

let orientationProbe: Promise<boolean> | null = null;

/**
 * Feature test: decode a 2×1 JPEG tagged "rotate 90°" and check it comes out 1×2.
 * Modern Chrome and Safari orient images on decode; the app relies on that single
 * orientation step (and disables Cropper.js's own EXIF handling) to avoid double rotation.
 */
export function browserAppliesExifOrientation(): Promise<boolean> {
  orientationProbe ??= (async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillRect(0, 0, 2, 1);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg'));
    if (!jpeg) return false;
    const tagged = withExifOrientation(new Uint8Array(await jpeg.arrayBuffer()), 6);
    try {
      const image = await decodeImage(new Blob([tagged as BlobPart], { type: 'image/jpeg' }));
      const upright = image.width === 1 && image.height === 2;
      image.release();
      return upright;
    } catch {
      return false;
    }
  })();
  return orientationProbe;
}

/** Validates and decodes an uploaded file. The file itself is never modified. */
export async function loadUpload(file: File, onStatus?: (message: string) => void): Promise<LoadedUpload> {
  if (file.size === 0) throw new UserFacingError('This file is empty. Please choose another picture.');
  if (file.size > MAX_FILE_BYTES) {
    throw new UserFacingError('This picture file is too large to open (over 100 MB). Please choose a smaller file.');
  }
  const format = await sniffFormat(file);
  if (!format) {
    throw new UserFacingError(
      'This file is not a picture ArtFrame can open. Please choose a photo or scan saved as JPG, PNG, WebP or HEIC.',
    );
  }
  if (format === 'jpeg' && !(await browserAppliesExifOrientation())) {
    throw new UserFacingError(
      'This browser is too old to show photos the right way up. Please update your browser and try again.',
    );
  }

  const mimeType = file.type || MIME_BY_FORMAT[format];
  let working: Blob | null = null;
  let image: DecodedImage;
  try {
    image = await decodeImage(file);
  } catch {
    if (format !== 'heic') {
      throw new UserFacingError('This picture could not be opened. The file may be damaged. Please try another file.');
    }
    // This browser cannot display HEIC itself: make a lossless PNG copy on the device.
    onStatus?.('Converting your photo…');
    working = await convertHeicToPng(file);
    try {
      image = await decodeImage(working);
    } catch {
      throw new UserFacingError('This photo could not be opened after converting it. Please try another file.');
    }
  }

  if (image.width * image.height > MAX_PIXELS) {
    image.release();
    throw new UserFacingError(
      'This picture is too large for this device to work with (over 100 megapixels). Please choose a smaller version.',
    );
  }
  return { format, mimeType, working, image };
}
