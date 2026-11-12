import { expect, test, type Page } from '@playwright/test';
import { computeLayout } from '../../src/services/layout-engine';
import { EMPTY_METADATA } from '../../src/types/artwork';
import {
  decodeImage,
  download,
  fillDetails,
  makeImage,
  resetApp,
  storedProjects,
  uploadNew,
  waitForSaved,
  watchForProblems,
  withExifOrientation,
} from './helpers';

const FULL_DETAILS = { Edition: '1/10', Medium: 'Drypoint', Size: '25×15cm', Title: 'Untitled', Year: '2017' };

/** Geometry only depends on the crop size, so a dummy text measure is fine here. */
function expectedGeometry(width: number, height: number) {
  return computeLayout(width, height, EMPTY_METADATA, () => 0);
}

let problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems = watchForProblems(page);
  await resetApp(page);
});
test.afterEach(() => {
  expect(problems, 'console errors / CSP violations').toEqual([]);
});

async function toPreview(page: Page) {
  await page.getByRole('button', { name: 'Use this crop' }).click();
  await expect(page.getByRole('heading', { name: 'Artwork Details' })).toBeVisible();
}

test('PNG export copies the artwork pixel-for-pixel and justifies the metadata to its width', async ({ page }) => {
  const W = 1200;
  const H = 800;
  const source = await makeImage(page, W, H, 'image/png');
  await uploadNew(page, { name: 'scan.png', mimeType: 'image/png', buffer: source });
  await toPreview(page);
  await fillDetails(page, FULL_DETAILS);
  await waitForSaved(page);
  await page.getByRole('button', { name: 'Continue to Preview' }).click();

  const { download: dl, bytes } = await download(page, 'PNG');
  expect(dl.suggestedFilename()).toBe('2017_Untitled_Drypoint.png');
  await expect(page.getByText('Your file is ready: 2017_Untitled_Drypoint.png')).toBeVisible();

  const geo = expectedGeometry(W, H);
  const out = await decodeImage(page, bytes, 'image/png');
  expect([out.width, out.height]).toEqual([geo.sheetWidth, geo.sheetHeight]);
  expect(out.width).toBe(1800);

  // The on-screen preview has the same proportions as the exported file.
  const preview = await page.locator('.preview-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(preview[0] / preview[1]).toBeCloseTo(out.width / out.height, 2);

  // Artwork: identical pixels, no resampling.
  const src = await decodeImage(page, source, 'image/png');
  let mismatches = 0;
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 2) {
      const a = src.px(x, y);
      const b = out.px(geo.artwork.x + x, geo.artwork.y + y);
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) mismatches++;
    }
  }
  expect(mismatches).toBe(0);

  // Pure white margins and gap.
  const isWhite = (p: number[]) => p[0] === 255 && p[1] === 255 && p[2] === 255;
  for (let x = 0; x < out.width; x += 5) {
    expect(isWhite(out.px(x, 3))).toBe(true);
    expect(isWhite(out.px(x, geo.artwork.y - 1))).toBe(true);
    expect(isWhite(out.px(x, geo.artwork.y + H + 2))).toBe(true);
    expect(isWhite(out.px(x, out.height - 2))).toBe(true);
  }
  for (let y = 0; y < out.height; y += 5) {
    expect(isWhite(out.px(geo.artwork.x - 1, y))).toBe(true);
    expect(isWhite(out.px(geo.artwork.x + W, y))).toBe(true);
  }

  // Metadata: dark text spans the artwork width — starts at its left edge, ends at its right edge.
  let minX = Infinity;
  let maxX = -Infinity;
  for (let y = geo.artwork.y + H + 1; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = out.px(x, y);
      if (p[0] < 140 && p[1] < 140 && p[2] < 140) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  const tolerance = W * 0.01; // glyph side bearings
  expect(minX).toBeGreaterThanOrEqual(geo.artwork.x - 1);
  expect(minX).toBeLessThan(geo.artwork.x + tolerance);
  expect(maxX).toBeLessThanOrEqual(geo.artwork.x + W + 1);
  expect(maxX).toBeGreaterThan(geo.artwork.x + W - tolerance);
});

test('JPG, JPEG and PDF exports have the right names, size and contents', async ({ page }) => {
  const W = 900;
  const H = 1200;
  await uploadNew(page, { name: 'photo.png', mimeType: 'image/png', buffer: await makeImage(page, W, H, 'image/png') });
  await toPreview(page);
  await fillDetails(page, { Title: 'Blue Hour', Year: '2024', Medium: 'Oil on linen' });
  await page.getByRole('button', { name: 'Continue to Preview' }).click();
  const geo = expectedGeometry(W, H);

  for (const format of ['JPG', 'JPEG'] as const) {
    const { download: dl, bytes } = await download(page, format);
    expect(dl.suggestedFilename()).toBe(`2024_Blue_Hour_Oil_on_linen.${format.toLowerCase()}`);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    const out = await decodeImage(page, bytes, 'image/jpeg', { x: 0, y: 0, width: 20, height: 20 });
    expect([out.width, out.height]).toEqual([geo.sheetWidth, geo.sheetHeight]);
    for (const c of out.px(5, 5)) expect(c).toBeGreaterThanOrEqual(253); // white, not transparent/black
  }

  const { download: pdf, bytes } = await download(page, 'PDF');
  expect(pdf.suggestedFilename()).toBe('2024_Blue_Hour_Oil_on_linen.pdf');
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toContain('/DCTDecode');
  expect(text).toContain(`/Width ${geo.sheetWidth}`);
  expect(text).toContain(`/Height ${geo.sheetHeight}`);
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)!;
  expect(Number(box[1])).toBeCloseTo((geo.sheetWidth / 300) * 72, 0);
  expect(Number(box[2])).toBeCloseTo((geo.sheetHeight / 300) * 72, 0);
});

test('every aspect ratio crops correctly, and the ratio can be changed after entering details', async ({ page }) => {
  const W = 1600;
  const H = 1200;
  await uploadNew(page, { name: 'wide.png', mimeType: 'image/png', buffer: await makeImage(page, W, H, 'image/png') });
  await waitForSaved(page);
  const [initial] = await storedProjects(page);
  expect(initial.aspectRatio).toBe('original');
  expect(initial.crop).toEqual({ x: 0, y: 0, width: W, height: H });

  const ratios: [string, number][] = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['5:4', 5 / 4],
    ['4:5', 4 / 5],
    ['Original', W / H],
  ];
  for (const [label, ratio] of ratios) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Wait until the change has actually reached storage (autosave is debounced).
    await expect
      .poll(async () => {
        const [p] = await storedProjects(page);
        return Math.round((p.crop.width / p.crop.height) * 100) / 100;
      }, { message: label, timeout: 10_000 })
      .toBeCloseTo(ratio, 1);
    const [project] = await storedProjects(page);
    const crop = project.crop;
    expect(crop.width / crop.height, label).toBeCloseTo(ratio, 2);
    expect(crop.x + crop.width).toBeLessThanOrEqual(W);
    expect(crop.y + crop.height).toBeLessThanOrEqual(H);
    expect(crop.width === W || crop.height === H, `${label} uses the largest crop`).toBe(true);
  }
  await page.getByRole('button', { name: 'Free', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Free', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Enter details, then go back and change the ratio: details are kept, crop updates.
  await page.getByRole('button', { name: '4:3', exact: true }).click();
  await toPreview(page);
  await fillDetails(page, FULL_DETAILS);
  await page.getByRole('button', { name: 'Change crop' }).click();
  await expect(page.getByRole('button', { name: '4:3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Use this crop' })).toBeEnabled();
  await page.getByRole('button', { name: '4:5', exact: true }).click();
  await toPreview(page);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Untitled');
  await expect.poll(async () => (await storedProjects(page))[0].aspectRatio).toBe('4:5');
  await waitForSaved(page);
  const [project] = await storedProjects(page);
  expect(project.aspectRatio).toBe('4:5');
  expect(project.crop.width / project.crop.height).toBeCloseTo(0.8, 2);
  expect(project.metadata).toEqual({ edition: '1/10', medium: 'Drypoint', size: '25×15cm', title: 'Untitled', year: '2017' });

  // The export follows the new crop.
  await page.getByRole('button', { name: 'Continue to Preview' }).click();
  const { bytes } = await download(page, 'PNG');
  const geo = expectedGeometry(project.crop.width, project.crop.height);
  const out = await decodeImage(page, bytes, 'image/png', { x: 0, y: 0, width: 1, height: 1 });
  expect([out.width, out.height]).toEqual([geo.sheetWidth, geo.sheetHeight]);
});

test('phone photos with EXIF rotation come out upright, rotated exactly once', async ({ page }) => {
  // Stored sideways (200×100, red left / blue right) with "rotate 90° clockwise" in EXIF:
  // displayed upright it is 100×200 with red on top and blue at the bottom.
  const jpeg = withExifOrientation(await makeImage(page, 200, 100, 'image/jpeg', 'halves'), 6);
  await uploadNew(page, { name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: jpeg });
  await waitForSaved(page);
  const [project] = await storedProjects(page);
  expect([project.image.width, project.image.height]).toEqual([100, 200]);

  await toPreview(page);
  await page.getByRole('button', { name: 'Continue to Preview' }).click();
  const { bytes } = await download(page, 'PNG');
  const geo = expectedGeometry(100, 200);
  const out = await decodeImage(page, bytes, 'image/png');
  expect([out.width, out.height]).toEqual([geo.sheetWidth, geo.sheetHeight]);
  const top = out.px(geo.artwork.x + 50, geo.artwork.y + 20);
  const bottom = out.px(geo.artwork.x + 50, geo.artwork.y + 180);
  expect(top[0]).toBeGreaterThan(200);
  expect(top[2]).toBeLessThan(60);
  expect(bottom[2]).toBeGreaterThan(200);
  expect(bottom[0]).toBeLessThan(60);
});

test('accepts JPEG and WebP, very wide and very tall pictures', async ({ page }) => {
  const cases: [string, 'image/jpeg' | 'image/webp', number, number][] = [
    ['wide.jpg', 'image/jpeg', 2400, 400],
    ['tall.webp', 'image/webp', 300, 1800],
    ['square.webp', 'image/webp', 800, 800],
  ];
  for (const [name, type, w, h] of cases) {
    await page.getByRole('button', { name: 'ArtFrame', exact: true }).click();
    await uploadNew(page, { name, mimeType: type, buffer: await makeImage(page, w, h, type) });
    await waitForSaved(page);
    const projects = await storedProjects(page);
    const project = projects.find((p) => p.image.originalFileName === name);
    expect([project.image.width, project.image.height], name).toEqual([w, h]);
    expect(project.image.format).toBe(type === 'image/jpeg' ? 'jpeg' : 'webp');
  }
});

test('rejects files that are not supported pictures with a clear message', async ({ page }) => {
  await page.getByRole('button', { name: 'Create New Artwork' }).first().click();
  await page.locator('#upload-input').setInputFiles({
    name: 'notes.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('this is not an image'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'not a picture ArtFrame can open' })).toBeVisible();

  // Right signature, broken content.
  await page.locator('#upload-input').setInputFiles({
    name: 'broken.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'could not be opened' })).toBeVisible();
  expect(await storedProjects(page)).toEqual([]);
});

test('details that cannot fit on one line show a warning and block download', async ({ page }) => {
  await uploadNew(page, { name: 'a.png', mimeType: 'image/png', buffer: await makeImage(page, 600, 400, 'image/png') });
  await toPreview(page);
  await fillDetails(page, { ...FULL_DETAILS, Title: 'An extraordinarily long title '.repeat(6) });
  await expect(page.getByText('too long to fit on one line')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Preview' }).click();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await fillDetails(page, { Title: 'Short' });
  await expect(page.getByText('too long to fit on one line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to Preview' }).click();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
});

test('saves several artworks, restores them after reload, renames, replaces and deletes', async ({ page }) => {
  await uploadNew(page, { name: 'first.png', mimeType: 'image/png', buffer: await makeImage(page, 500, 400, 'image/png') });
  await toPreview(page);
  await fillDetails(page, { Title: 'First', Year: '2019' });
  await waitForSaved(page);
  await page.getByRole('button', { name: '‹ My Artworks' }).click();

  await uploadNew(page, { name: 'second.png', mimeType: 'image/png', buffer: await makeImage(page, 400, 500, 'image/png') });
  await toPreview(page);
  await fillDetails(page, { Title: 'Second', Edition: 'A/P' });
  // Reload straight after typing: the change must survive an interrupted session.
  await page.waitForTimeout(800);
  await page.reload();

  const names = page.locator('.library-name');
  await expect(names).toHaveText(['Second', 'First']);
  await expect(page.locator('.library-thumb img')).toHaveCount(2);

  await page.getByRole('button', { name: 'Open First' }).first().click();
  await expect(page.getByRole('heading', { name: 'Artwork Details' })).toBeVisible();
  await expect(page.getByLabel('Year', { exact: true })).toHaveValue('2019');
  await page.getByRole('button', { name: '1. Upload' }).click();

  // Replacing asks first; cancelling keeps the old picture.
  const replacement = { name: 'replacement.png', mimeType: 'image/png', buffer: await makeImage(page, 700, 300, 'image/png') };
  await page.locator('#upload-input').setInputFiles(replacement);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect((await storedProjects(page)).find((p) => p.metadata.title === 'First').image.width).toBe(500);
  await page.locator('#upload-input').setInputFiles(replacement);
  await page.getByRole('dialog').getByRole('button', { name: 'Replace picture' }).click();
  await expect(page.getByRole('heading', { name: 'Crop Image' })).toBeVisible();
  await waitForSaved(page);
  const replaced = (await storedProjects(page)).find((p) => p.metadata.title === 'First');
  expect([replaced.image.width, replaced.image.height]).toEqual([700, 300]);
  expect(replaced.metadata.year).toBe('2019');

  await page.getByRole('button', { name: '‹ My Artworks' }).click();
  await expect(names).toHaveText(['First', 'Second']);

  await page.getByRole('button', { name: 'Rename Second' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Second (studio copy)');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
  await expect(names).toHaveText(['Second (studio copy)', 'First']);

  await page.getByRole('button', { name: 'Delete First' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(names).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete First' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(names).toHaveText(['Second (studio copy)']);

  await page.reload();
  await expect(names).toHaveText(['Second (studio copy)']);
  const stored = await storedProjects(page);
  expect(stored).toHaveLength(1);
  expect(stored[0].metadata.edition).toBe('A/P');
});

test('large pictures export at full size', async ({ page }) => {
  test.setTimeout(240_000);
  const W = 4000;
  const H = 3000;
  await uploadNew(page, { name: 'big.png', mimeType: 'image/png', buffer: await makeImage(page, W, H, 'image/png', 'halves') });
  await toPreview(page);
  await fillDetails(page, FULL_DETAILS);
  await page.getByRole('button', { name: 'Continue to Preview' }).click();
  const { bytes } = await download(page, 'PNG');
  const geo = expectedGeometry(W, H);
  // Read a band across the red/blue boundary at the bottom of the artwork: a resampled
  // image would blur the boundary; an exact copy switches colour between two adjacent pixels.
  const y = geo.artwork.y + H - 2;
  const edge = geo.artwork.x + W / 2;
  const out = await decodeImage(page, bytes, 'image/png', { x: edge - 2, y, width: 4, height: 1 });
  expect([out.width, out.height]).toEqual([geo.sheetWidth, geo.sheetHeight]);
  expect(out.px(edge - 1, y)).toEqual([255, 0, 0]);
  expect(out.px(edge, y)).toEqual([0, 0, 255]);
});

test('metadata text crossing a PNG strip boundary matches a whole-sheet render', async ({ page }) => {
  // 3000×1200 → sheet 4500 wide, strips of 888 rows; the text line (y≈1740–1845) spans the boundary at 1776.
  const W = 3000;
  const H = 1200;
  await uploadNew(page, { name: 'band.png', mimeType: 'image/png', buffer: await makeImage(page, W, H, 'image/png', 'halves') });
  await toPreview(page);
  await fillDetails(page, FULL_DETAILS);
  await page.getByRole('button', { name: 'Continue to Preview' }).click();
  const geo = expectedGeometry(W, H);
  const boundary = Math.floor(4_000_000 / geo.sheetWidth) * 2;
  expect(boundary).toBeGreaterThan(geo.metadata.y);
  expect(boundary).toBeLessThan(geo.metadata.y + W * 0.035);

  const region = { x: geo.artwork.x, y: geo.metadata.y, width: W, height: Math.ceil(W * 0.035 * 1.25) };
  const png = await decodeImage(page, (await download(page, 'PNG')).bytes, 'image/png', region);
  const jpg = await decodeImage(page, (await download(page, 'JPG')).bytes, 'image/jpeg', region);
  let maxDiff = 0;
  let dark = 0;
  for (let i = 0; i < png.region.data.length; i += 4) {
    for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(png.region.data[i + c] - jpg.region.data[i + c]));
    if (png.region.data[i] < 128) dark++;
  }
  expect(dark).toBeGreaterThan(500); // text is really there
  expect(maxDiff).toBeLessThan(48); // only JPEG noise, no seam or shift at the strip boundary
});
