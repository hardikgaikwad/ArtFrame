import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng } from './png-encoder';

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readChunks(bytes: Uint8Array): Chunk[] {
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const chunks: Chunk[] = [];
  for (let pos = 8; pos < bytes.length; ) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    expect(view.getUint32(pos + 8 + length)).toBe(crc32(bytes, pos + 4, pos + 8 + length));
    chunks.push({ type, data });
    pos += 12 + length;
  }
  return chunks;
}

/** Decodes the Up-filtered RGB scanlines produced by the encoder back to RGB. */
function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = width * 3;
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (rowBytes + 1)]).toBe(2);
    for (let i = 0; i < rowBytes; i++) {
      const up = y > 0 ? out[(y - 1) * rowBytes + i] : 0;
      out[y * rowBytes + i] = (raw[y * (rowBytes + 1) + 1 + i] + up) & 0xff;
    }
  }
  return out;
}

describe('encodePng', () => {
  it('encodes RGBA strips losslessly into a valid PNG', async () => {
    const width = 37;
    const height = 23;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = (i * 7) & 0xff;
      rgba[i * 4 + 1] = (i * 13 + 5) & 0xff;
      rgba[i * 4 + 2] = (i * 31 + 9) & 0xff;
      rgba[i * 4 + 3] = 255;
    }
    // Uneven strip sizes, as produced by the last strip of an export.
    async function* strips() {
      for (const [start, end] of [[0, 10], [10, 20], [20, 23]]) {
        yield rgba.slice(start * width * 4, end * width * 4);
      }
    }
    const blob = await encodePng(width, height, strips(), { dpi: 300 });
    expect(blob.type).toBe('image/png');
    const chunks = readChunks(new Uint8Array(await blob.arrayBuffer()));

    expect(chunks[0].type).toBe('IHDR');
    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), chunks[0].data[8], chunks[0].data[9]]).toEqual([width, height, 8, 2]);
    const phys = chunks.find((c) => c.type === 'pHYs')!;
    expect(new DataView(phys.data.buffer, phys.data.byteOffset).getUint32(0)).toBe(11811);
    expect(chunks.at(-1)!.type).toBe('IEND');

    const idat = chunks.filter((c) => c.type === 'IDAT');
    const compressed = new Uint8Array(idat.reduce((n, c) => n + c.data.length, 0));
    let offset = 0;
    for (const c of idat) {
      compressed.set(c.data, offset);
      offset += c.data.length;
    }
    const rgb = unfilter(new Uint8Array(inflateSync(compressed)), width, height);
    for (let i = 0; i < width * height; i++) {
      expect([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]).toEqual([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    }
  });

  it('fails when the row count does not match', async () => {
    async function* strips() {
      yield new Uint8ClampedArray(4 * 4 * 2);
    }
    await expect(encodePng(4, 3, strips())).rejects.toThrow(/Expected 3 rows/);
  });
});

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
