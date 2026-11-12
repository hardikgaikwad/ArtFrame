import type { SheetRatioId } from '../services/layout-engine';
import type { ArtworkMetadata, AspectRatioId, CropRect, ImageInfo } from './artwork';

/** Small, frequently updated project record (the `projects` object store). */
export interface Project {
  id: string;
  /** Library display name; the library falls back to the title when empty. */
  name: string;
  metadata: ArtworkMetadata;
  /** Shape of the crop. */
  aspectRatio: AspectRatioId;
  /** Shape of the white background. Missing in projects saved before this option existed. */
  sheetRatio?: SheetRatioId;
  crop: CropRect | null;
  image: ImageInfo | null;
  createdAt: number;
  modifiedAt: number;
}

/** Large binary data for a project (the `assets` object store). */
export interface ProjectAssets {
  projectId: string;
  /** The untouched uploaded file. Never modified. */
  original: Blob;
  /** Lossless browser-decodable copy, only when the original cannot be decoded natively (HEIC outside Safari). */
  working: Blob | null;
  originalMimeType: string;
}
