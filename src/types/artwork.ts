/** The five optional artwork fields, in the order they appear on the sheet. */
export interface ArtworkMetadata {
  edition: string;
  medium: string;
  size: string;
  title: string;
  year: string;
}

export const METADATA_FIELDS = ['edition', 'medium', 'size', 'title', 'year'] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

export const EMPTY_METADATA: ArtworkMetadata = { edition: '', medium: '', size: '', title: '', year: '' };

export const ASPECT_RATIOS = ['free', 'original', '16:9', '9:16', '3:4', '4:3', '5:4', '4:5'] as const;
export type AspectRatioId = (typeof ASPECT_RATIOS)[number];

/** Integer pixel rectangle in the upright (EXIF-oriented) full-resolution image. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic';

export interface ImageInfo {
  /** Upright full-resolution size in pixels. */
  width: number;
  height: number;
  format: ImageFormat;
  originalMimeType: string;
  originalFileName: string;
}

export type ExportFormat = 'png' | 'jpg' | 'jpeg' | 'pdf';
