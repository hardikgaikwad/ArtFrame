import type { ArtworkMetadata, ExportFormat } from '../types/artwork';

const MAX_BASE_LENGTH = 120;

/** Builds e.g. `2017_Untitled_Drypoint.png` from the populated fields, safe on common filesystems. */
export function artworkFilename(metadata: ArtworkMetadata, format: ExportFormat): string {
  const parts = [metadata.year, metadata.title, metadata.medium].map(sanitizePart).filter(Boolean);
  let base = parts.join('_') || 'ArtFrame_artwork';
  if (base.length > MAX_BASE_LENGTH) base = base.slice(0, MAX_BASE_LENGTH).replace(/[_.\s-]+$/, '');
  return `${base}.${format}`;
}

function sanitizePart(value: string): string {
  return (
    value
      .normalize('NFC')
      // Characters reserved on Windows, macOS and Android, plus control characters.
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      // No leading or trailing dots/underscores (hidden files, Windows quirks).
      .replace(/^[._]+|[._]+$/g, '')
  );
}
