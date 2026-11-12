import { UserFacingError } from '../utils/errors';

/** Pixels per inch used to size the PDF page (and recorded in PNG files). */
export const PRINT_DPI = 300;
/** PDF viewers reject pages larger than 200 inches (14 400 pt). */
const MAX_PAGE_POINTS = 14_400;

/**
 * Wraps the finished sheet in a single-page PDF whose page has the sheet's exact aspect
 * ratio. The JPEG is embedded as-is (DCTDecode), so it is not recompressed; jsPDF is
 * loaded only when a PDF is requested.
 */
export async function createPdf(jpeg: Blob, widthPx: number, heightPx: number, title: string): Promise<Blob> {
  let jsPDF: typeof import('jspdf').jsPDF;
  try {
    ({ jsPDF } = await import('jspdf'));
  } catch (error) {
    console.error(error);
    throw new UserFacingError('The PDF maker could not be loaded. Please check your internet connection and try again.');
  }
  try {
    const { width, height } = pdfPageSize(widthPx, heightPx);
    const doc = new jsPDF({
      orientation: width > height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [width, height],
      compress: true,
    });
    doc.setProperties({ title: title || 'Artwork', creator: 'ArtFrame' });
    doc.addImage(new Uint8Array(await jpeg.arrayBuffer()), 'JPEG', 0, 0, width, height, undefined, 'NONE');
    return doc.output('blob');
  } catch (error) {
    console.error(error);
    throw new UserFacingError('The PDF could not be created. Please try again, or download a PNG instead.');
  }
}

/** Page size in points at PRINT_DPI, reduced in density only if the page would exceed PDF limits. */
export function pdfPageSize(widthPx: number, heightPx: number): { width: number; height: number } {
  const dpi = Math.max(PRINT_DPI, (Math.max(widthPx, heightPx) * 72) / MAX_PAGE_POINTS);
  return { width: (widthPx / dpi) * 72, height: (heightPx / dpi) * 72 };
}
