import type { EditorSession } from '../app/state';
import { drawWholeSheet } from '../services/composition-engine';
import { h } from '../utils/dom';
import { releaseCanvas } from '../utils/memory-manager';
import type { StepView } from './upload';

/**
 * Live preview: the full-resolution layout drawn at screen size from the reduced
 * preview copy. Redraws are batched to one per animation frame.
 */
export function createArtworkPreview(session: EditorSession, options: { maxHeightRatio?: number } = {}): StepView {
  const canvas = h('canvas', { class: 'preview-canvas', role: 'img', 'aria-label': 'Preview of your artwork sheet' });
  const el = h('div', { class: 'preview-frame' }, canvas);
  const maxHeightRatio = options.maxHeightRatio ?? 0.7;
  let frame = 0;

  function draw() {
    frame = 0;
    const layout = session.layout();
    const crop = session.crop;
    const preview = session.preview;
    const available = el.clientWidth;
    if (!layout || !crop || !preview || available <= 0) return;
    const maxHeight = Math.max(240, window.innerHeight * maxHeightRatio);
    const cssScale = Math.min(available / layout.sheetWidth, maxHeight / layout.sheetHeight);
    const cssWidth = Math.floor(layout.sheetWidth * cssScale);
    const cssHeight = Math.floor(layout.sheetHeight * cssScale);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    // The canvas can be a fraction of a pixel larger than the scaled sheet; keep that edge white.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawWholeSheet(ctx, layout, crop, preview.source, canvas.width / layout.sheetWidth);
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const unsubscribe = session.subscribe((change) => {
    if (change === 'metadata' || change === 'crop' || change === 'sheet' || change === 'image') schedule();
  });
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resizeObserver?.observe(el);
  window.addEventListener('resize', schedule);
  schedule();

  return {
    el,
    destroy() {
      cancelAnimationFrame(frame);
      unsubscribe();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', schedule);
      releaseCanvas(canvas);
    },
  };
}
