/**
 * Streaming lossless PNG encoder.
 *
 * The sheet is rendered in horizontal strips and each strip is filtered and deflated
 * as it arrives, so a full-resolution PNG never needs a full-size canvas. This is what
 * lets an iPad (whose canvas limit is far below a 12 MP photo's sheet) export at full size.
 * Compression uses the browser's native CompressionStream (zlib format, as PNG requires).
 */

/** Yields consecutive RGBA rows (4 bytes per pixel, top to bottom) in batches. */
export type RowSource = AsyncIterable<Uint8ClampedArray>;

const PNG_SIGNATURE: Uint8Array<ArrayBuffer> = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const FILTER_UP = 2;

export function canStreamPng(): boolean {
  return typeof CompressionStream === 'function';
}

export async function encodePng(
  width: number,
  height: number,
  rows: RowSource,
  options: { dpi?: number; onRows?: (done: number) => void } = {},
): Promise<Blob> {
  const parts: BlobPart[] = [PNG_SIGNATURE];

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB (the sheet is always opaque)
  parts.push(chunk('IHDR', ihdr));
  parts.push(chunk('sRGB', new Uint8Array([0])));
  if (options.dpi) {
    const pixelsPerMetre = Math.round(options.dpi / 0.0254);
    const phys = new Uint8Array(9);
    const physView = new DataView(phys.buffer);
    physView.setUint32(0, pixelsPerMetre);
    physView.setUint32(4, pixelsPerMetre);
    phys[8] = 1; // unit: metre
    parts.push(chunk('pHYs', phys));
  }

  const compressor = new CompressionStream('deflate');
  const writer = compressor.writable.getWriter();
  const idatChunks: BlobPart[] = [];
  const collect = (async () => {
    const reader = compressor.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      idatChunks.push(chunk('IDAT', value));
    }
  })();

  const stride = width * 4;
  const rowBytes = width * 3 + 1;
  let previous: Uint8Array = new Uint8Array(width * 3);
  let current: Uint8Array = new Uint8Array(width * 3);
  let rowsDone = 0;
  try {
    for await (const batch of rows) {
      const batchRows = batch.length / stride;
      if (!Number.isInteger(batchRows)) throw new Error('Row batch is not a whole number of rows');
      const out = new Uint8Array(batchRows * rowBytes);
      for (let r = 0; r < batchRows; r++) {
        const src = r * stride;
        const dst = r * rowBytes;
        out[dst] = FILTER_UP;
        for (let x = 0, s = src, c = 0; x < width; x++, s += 4) {
          current[c] = batch[s];
          out[dst + 1 + c] = (batch[s] - previous[c]) & 0xff;
          c++;
          current[c] = batch[s + 1];
          out[dst + 1 + c] = (batch[s + 1] - previous[c]) & 0xff;
          c++;
          current[c] = batch[s + 2];
          out[dst + 1 + c] = (batch[s + 2] - previous[c]) & 0xff;
          c++;
        }
        [previous, current] = [current, previous];
      }
      await writer.ready;
      await writer.write(out);
      rowsDone += batchRows;
      options.onRows?.(rowsDone);
    }
    if (rowsDone !== height) throw new Error(`Expected ${height} rows, received ${rowsDone}`);
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await collect.catch(() => {});
    throw error;
  }
  await collect;

  parts.push(...idatChunks);
  parts.push(chunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
