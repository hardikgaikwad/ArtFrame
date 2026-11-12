import { readFile } from 'node:fs/promises';
import { expect, type Download, type Page } from '@playwright/test';

export interface Fixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Generates a test image in the browser: deterministic per-pixel noise (so any
 * resampling of the artwork is detectable) or, with `halves`, solid red left / blue right.
 */
export async function makeImage(
  page: Page,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg' | 'image/webp',
  pattern: 'noise' | 'halves' = 'noise',
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height, type, pattern }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      if (pattern === 'halves') {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, width / 2, height);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(width / 2, 0, width / 2, height);
      } else {
        const data = ctx.createImageData(width, height);
        let seed = 12345;
        for (let i = 0; i < data.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          data.data[i] = seed >>> 24;
          data.data[i + 1] = (seed >>> 16) & 0xff;
          data.data[i + 2] = (seed >>> 8) & 0xff;
          data.data[i + 3] = 255;
        }
        ctx.putImageData(data, 0, 0);
      }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.95));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { width, height, type, pattern },
  );
  return Buffer.from(base64, 'base64');
}

/** Same EXIF splice as src/utils/image-dimensions.ts. */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const app1 = Buffer.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

export function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || /Content Security Policy|Refused to/i.test(text)) problems.push(text);
  });
  page.on('pageerror', (error) => problems.push(String(error)));
  return problems;
}

export async function resetApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('artframe-db');
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My Artworks' })).toBeVisible();
}

export async function uploadNew(page: Page, fixture: Fixture): Promise<void> {
  // "New Artwork" opens the system picker; the test hands the file to its input directly.
  await expect(page.getByRole('button', { name: 'New Artwork' })).toBeEnabled();
  await page.locator('#upload-input').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Crop', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Next: Details' })).toBeEnabled({ timeout: 30_000 });
}

export async function fillDetails(page: Page, values: Partial<Record<'Edition' | 'Medium' | 'Size' | 'Title' | 'Year', string>>) {
  for (const [label, value] of Object.entries(values)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
}

export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 15_000 });
}

export async function download(page: Page, format: 'PNG' | 'JPG' | 'JPEG' | 'PDF'): Promise<{ download: Download; bytes: Buffer }> {
  // Other file types sit behind the "File type" disclosure.
  const picker = page.locator('.format-picker');
  if (!(await picker.evaluate((el) => (el as HTMLDetailsElement).open))) await picker.locator('summary').click();
  await page.getByLabel(new RegExp(`^${format}\\b`)).check();
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const dl = await pending;
  const bytes = await readFile((await dl.path())!);
  return { download: dl, bytes };
}

/** Reads the projects store directly, to check what was really saved. */
export async function storedProjects(page: Page): Promise<any[]> {
  return page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open('artframe-db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('projects').objectStore('projects').getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

export interface Raster {
  width: number;
  height: number;
  /** RGBA pixels of the requested region. */
  region: { x: number; y: number; width: number; height: number; data: Buffer };
  px(x: number, y: number): [number, number, number];
}

/** Decodes an exported image in the browser and returns its size plus the pixels of one region. */
export async function decodeImage(
  page: Page,
  bytes: Buffer,
  mimeType: string,
  region?: { x: number; y: number; width: number; height: number },
): Promise<Raster> {
  const result = await page.evaluate(
    async ({ base64, mimeType, region }) => {
      const binary = atob(base64);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([data], { type: mimeType }));
      const r = region ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
      const canvas = document.createElement('canvas');
      canvas.width = r.width;
      canvas.height = r.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, -r.x, -r.y);
      const pixels = new Uint8Array(ctx.getImageData(0, 0, r.width, r.height).data.buffer);
      let out = '';
      for (let i = 0; i < pixels.length; i += 0x8000) out += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
      return { width: bitmap.width, height: bitmap.height, r, pixels: btoa(out) };
    },
    { base64: bytes.toString('base64'), mimeType, region },
  );
  const data = Buffer.from(result.pixels, 'base64');
  const r = result.r;
  return {
    width: result.width,
    height: result.height,
    region: { ...r, data },
    px(x, y) {
      const i = ((y - r.y) * r.width + (x - r.x)) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}
