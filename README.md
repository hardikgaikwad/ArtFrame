# ArtFrame

ArtFrame turns a photo or scan of a physical artwork into a consistently formatted
artwork documentation sheet: the artwork centred on a white sheet, with its details
(edition, medium, size, title, year) on one justified line underneath.

Everything happens in the browser. Pictures are never uploaded anywhere.

**Workflow:** Upload → Crop → Details → Preview and Download. Work is saved
automatically in the browser, and any number of artworks can be kept and reopened.

---

## Technology

| | Version | Used for |
|---|---|---|
| Vite | 8.3.8 | Build and dev server |
| TypeScript | 7.0.2 | Application code (no framework) |
| Cropper.js | 1.7.0 | Crop interface (loaded when the Crop step opens) |
| heic-to | 1.6.7 | HEIC/HEIF decoding (loaded only for HEIC files the browser can't open) |
| jsPDF | 4.2.1 | PDF export (loaded only when PDF is chosen) |
| Vitest | 5.1.0 | Unit tests (dev only) |
| Playwright | 1.65.0 | End-to-end tests in Chromium and WebKit (dev only) |

Native browser APIs: Canvas 2D, IndexedDB, CompressionStream, Storage API, Web Share.

All versions are pinned exactly in `package.json`, and `package-lock.json` is committed.
`npm audit` reported 0 vulnerabilities when the dependencies were installed (November 2026).

The spec asked for Node.js 26.x. The project was built and tested with Node 24.13.1,
which Vite 8 supports. `engines` requires Node ≥ 24.

**Bundle size (production build):** the initial JavaScript is about 15 KB gzipped.
Cropper.js (~14 KB gzipped), jsPDF (~130 KB) and heic-to (~810 KB) are separate chunks
that load only when needed. jsPDF's optional `html2canvas`/`dompurify`/`canvg` chunks are
emitted by the build but are never requested, because ArtFrame does not use jsPDF's HTML features.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest)
npx playwright install chromium webkit   # once
npm run test:e2e     # builds, serves the production build, runs Playwright
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ with the production security headers
```

## Deployment (Vercel)

ArtFrame is a static site with no server code and no environment variables.

1. Push the repository to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Vercel reads `vercel.json`: framework **Vite**, build command `npm run build`,
   output directory `dist`. Nothing needs changing.
4. Deploy. Every later push to the main branch redeploys automatically.

Or from the command line: `npx vercel` (preview) and `npx vercel --prod`.

`vercel.json` also sets the security headers (Content Security Policy, `nosniff`,
no referrer, no framing, HSTS). `vite preview` and the e2e tests serve the same headers,
read from `vercel.json`, so CSP problems show up before deployment.

There is no URL routing: the address is always `/`, so no rewrites are needed and no
project information ever appears in a URL.

## Architecture

```
src/
  app/          app.ts (library ⇄ editor switching), navigation.ts (editor steps), state.ts (EditorSession + autosave)
  components/   upload, crop-editor, metadata-form, artwork-preview, export-controls, project-library
  services/     image-loader, heic-converter, crop-service, layout-engine, composition-engine,
                png-encoder, export-service, pdf-service, storage-service
  utils/        dom helpers, dialogs, errors, filenames, text measurement, canvas/memory management
  types/        artwork.ts, project.ts
```

Key decisions:

- **One layout, two renderings.** `layout-engine.ts` computes the sheet in full-resolution
  pixels. Preview and export both call the same drawing function
  (`composition-engine.ts › drawSheetBand`); the preview just applies a scale. All layout
  proportions live in the `LAYOUT` object, so the composition can be retuned in one place.
- **The artwork is copied 1:1.** In an export, the cropped artwork is drawn at its own size at
  integer coordinates. Only the white border and the text are added, and the artwork is never
  resampled. An e2e test checks this pixel by pixel.
- **Streamed PNG export.** iPads limit canvas size well below what a 12-megapixel photo's
  sheet needs. PNG export therefore renders the sheet in horizontal strips and compresses
  each strip with the browser's native `CompressionStream` (`png-encoder.ts`). This produces a
  full-size, lossless PNG without ever allocating a full-size canvas. JPG/JPEG/PDF need a
  full-size canvas. If the device can't provide one, ArtFrame says so and offers a full-size
  PNG, or a smaller JPG/PDF that the artist must choose explicitly. Resolution is never reduced silently.
- **EXIF orientation is applied once, by the browser.** At startup ArtFrame checks that the
  browser rotates a tagged test JPEG itself. Cropper.js's own EXIF handling is turned off to
  avoid double rotation. Crop coordinates are stored in upright, full-resolution pixels.
- **Storage** uses IndexedDB `artframe-db` v1 with three stores: `projects` (small records,
  autosaved after a 600 ms pause in typing), `assets` (the untouched original file plus a
  working copy when needed), and `thumbnails`. The spec suggested putting thumbnails in
  `assets`. They are kept separate so that refreshing a thumbnail never rewrites the
  multi-megabyte image, and so the library can load without the large blobs.
- **No framework.** A small `h()` element helper inserts all text as text nodes, never as HTML.

## Image quality

- The uploaded file is stored untouched and is never modified or re-encoded.
- JPEG/PNG/WebP are decoded directly from the original. HEIC is decoded natively where the
  browser can (Safari). Elsewhere it is converted on the device to a **lossless PNG** working
  copy, and the original HEIC is kept as well.
- The on-screen preview uses a reduced copy (max 1600 px). Exports always use the full-resolution image.
- **PNG** is lossless and recommended. It records 300 pixels per inch.
- **JPG / JPEG** are the same format (quality 0.98) with different file extensions. JPEG is lossy.
- **PDF** is a single raster page sized at 300 pixels per inch with the sheet's exact
  proportions. Inside it is the quality-0.98 JPEG, embedded without recompression.
- No format can restore detail that was already lost in the camera's own JPEG/HEIC compression.

## Local storage behaviour

- Artworks are stored only in this browser on this device. They do not sync and are not backed up.
- Clearing browser data, or "Remove website data" on iPad, deletes them. Downloaded files are the
  permanent copies.
- ArtFrame asks for persistent storage where the browser supports it (Chrome). Safari does
  not offer this, and may remove data for sites that haven't been visited in a long time.
- If saving fails (storage full, private browsing), the status reads **Save failed** with a
  **Try again** button. Leaving with unsaved changes asks for confirmation first.

## Browser compatibility

Targets: **Chrome on Android** (Samsung Galaxy M32 5G) and **Safari on iPadOS 17**
(iPad 6th generation). Any recent Chrome, Edge, Firefox or Safari should work.

Required: ES2022, Canvas 2D, IndexedDB with Blob storage, `<dialog>`, and EXIF-aware image
decoding. Streamed PNG export uses `CompressionStream` (Chrome 80+, Safari 16.4+). Without it,
PNG falls back to a single full-size canvas.

## Known limitations

- **Reference calibration pending.** The spec mentions two reference artwork images and an
  approved example composition. They were not in the repository, so the layout uses the
  spec's proportional defaults (`LAYOUT` in `src/services/layout-engine.ts`), ready to be tuned.
- **HEIC is not covered by automated tests.** No HEIC encoder was available to make a test
  file. It needs a real iPhone/iPad photo on both target devices.
- **Large JPG/JPEG/PDF on iPad.** These need one full-size canvas, which an iPad 6 may not be able
  to allocate for big photos. ArtFrame then offers a full-size PNG, or a smaller JPG/PDF that the
  artist chooses explicitly.
- **Safari Private Browsing** may add slight noise to canvas pixels as anti-fingerprinting
  protection, and may block saving. Use a normal window for final exports.
- Metadata is drawn in the device's system sans-serif (Helvetica on iPad, Roboto on
  Android), so letterforms differ slightly between devices. The justification is measured on
  the device doing the export, so alignment is always exact.
- An internet connection is needed to load the app (and the optional parts on first use).
  There is no offline mode yet. A service worker can be added later without restructuring.

## Licences

ArtFrame's own code: all rights reserved by the project owner unless a licence is added.

Third-party code shipped to the browser:

- **Cropper.js** 1.7.0 — MIT © Chen Fengyuan
- **jsPDF** 4.2.1 — MIT © James Hall, yWorks GmbH and contributors; with fflate (MIT),
  fast-png (MIT), and the optional chunks html2canvas (MIT), DOMPurify (MPL-2.0 / Apache-2.0)
  and canvg (MIT)
- **heic-to** 1.6.7 — **LGPL-3.0**, bundling libheif (LGPL-3.0) and libde265 (LGPL-3.0)

LGPL-3.0 notes for heic-to: it is shipped unmodified as its own separately loaded file
(`dist/assets/heic-to-*.js`), so it can be replaced with another build without changing ArtFrame.
Source code: <https://github.com/hoppergee/heic-to>, libheif:
<https://github.com/strukturag/libheif>, libde265: <https://github.com/strukturag/libde265>.
Licence texts are in `node_modules/heic-to/LICENSE` and on those pages. **Before public
deployment, check that these obligations suit your distribution** (for example, link the
licence and source from an About section).
