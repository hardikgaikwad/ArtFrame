import { UserFacingError } from '../utils/errors';

/**
 * Converts HEIC/HEIF to a lossless PNG working copy, entirely on the device.
 * heic-to (LGPL-3.0, libheif) is ~3 MB, so it is loaded only when a HEIC file needs it.
 * The `csp` build avoids eval; it runs in a blob: worker (allowed by worker-src).
 * libheif applies the file's rotation/mirroring, so the PNG comes out upright.
 */
export async function convertHeicToPng(blob: Blob): Promise<Blob> {
  let heicTo: typeof import('heic-to/csp').heicTo;
  try {
    ({ heicTo } = await import('heic-to/csp'));
  } catch (error) {
    console.error(error);
    throw new UserFacingError(
      'The HEIC photo converter could not be loaded. Please check your internet connection and try again.',
    );
  }
  try {
    return await heicTo({ blob, type: 'image/png' });
  } catch (error) {
    console.error(error);
    throw new UserFacingError(
      'This HEIC photo could not be converted. It may be damaged, or this device may not have enough memory. ' +
        'Try again, or save the photo as JPG first.',
    );
  }
}
