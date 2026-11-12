import { describe, expect, it } from 'vitest';
import { pdfPageSize } from './pdf-service';
import { sniffFormat } from './image-loader';

function blobOf(bytes: number[] | string): Blob {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  return new Blob([data]);
}

function ftyp(major: string, compatible: string[]): Blob {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size + 8);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(`ftyp${major}\0\0\0\0${compatible.join('')}`), 4);
  return new Blob([bytes]);
}

describe('sniffFormat', () => {
  it('recognises formats by content, not by name', async () => {
    expect(await sniffFormat(blobOf([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(await sniffFormat(blobOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(await sniffFormat(blobOf('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(await sniffFormat(ftyp('heic', ['mif1', 'heic']))).toBe('heic');
    expect(await sniffFormat(ftyp('heix', ['mif1']))).toBe('heic');
    expect(await sniffFormat(ftyp('mif1', ['mif1', 'heic']))).toBe('heic');
    expect(await sniffFormat(ftyp('msf1', ['hevc']))).toBe('heic');
  });

  it('rejects unsupported and invalid files', async () => {
    expect(await sniffFormat(blobOf('GIF89a'))).toBeNull();
    expect(await sniffFormat(blobOf('%PDF-1.7'))).toBeNull();
    expect(await sniffFormat(blobOf('hello world, not a picture'))).toBeNull();
    expect(await sniffFormat(blobOf([]))).toBeNull();
    expect(await sniffFormat(ftyp('avif', ['mif1', 'avif']))).toBeNull();
    expect(await sniffFormat(ftyp('mif1', ['mif1', 'avif']))).toBeNull();
    expect(await sniffFormat(ftyp('isom', ['mp41']))).toBeNull();
  });
});

describe('pdfPageSize', () => {
  it('sizes the page at 300 pixels per inch', () => {
    expect(pdfPageSize(3000, 4500)).toEqual({ width: 720, height: 1080 });
  });

  it('keeps the aspect ratio when the page would exceed PDF limits', () => {
    const page = pdfPageSize(90000, 30000);
    expect(page.width).toBeCloseTo(14400);
    expect(page.width / page.height).toBeCloseTo(3);
  });
});
