import type Cropper from 'cropperjs';
import type { EditorSession } from '../app/state';
import { ASPECT_RATIO_LABELS, aspectRatioValue, defaultCrop, normalizeCrop } from '../services/crop-service';
import { ASPECT_RATIOS, type AspectRatioId, type CropRect } from '../types/artwork';
import { button, debounce, h } from '../utils/dom';
import type { StepView } from './upload';

let cropperModule: Promise<typeof import('cropperjs')> | null = null;

/** Cropper.js and its stylesheet load only when the crop step first opens. */
function loadCropper() {
  cropperModule ??= Promise.all([import('cropperjs'), import('cropperjs/dist/cropper.css')]).then(([mod]) => mod);
  cropperModule.catch(() => (cropperModule = null));
  return cropperModule;
}

export function createCropStep(session: EditorSession, onConfirm: () => void): StepView {
  const info = session.project.image!;
  const image = h('img', { src: session.image!.url, alt: 'Artwork to crop', class: 'crop-image' });
  const stage = h('div', { class: 'crop-stage' }, image);
  const status = h('p', { class: 'status-text', role: 'status' }, 'Loading…');
  let cropper: Cropper | null = null;
  let destroyed = false;

  const ratioButtons = new Map<AspectRatioId, HTMLButtonElement>();
  const ratioGroup = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Shape of the crop' });
  for (const id of ASPECT_RATIOS) {
    const btn = button(ASPECT_RATIO_LABELS[id], () => selectRatio(id), { class: 'segmented-option' });
    ratioButtons.set(id, btn);
    ratioGroup.append(btn);
  }

  function markRatio(id: AspectRatioId) {
    for (const [ratio, btn] of ratioButtons) btn.setAttribute('aria-pressed', String(ratio === id));
  }

  /** Reads the crop in original-image pixels. Cropper's natural size is the upright size. */
  function currentCrop(): CropRect | null {
    if (!cropper) return null;
    return normalizeCrop(cropper.getData(true), info.width, info.height);
  }

  const saveCrop = debounce(() => {
    const crop = currentCrop();
    if (crop) session.setCrop(crop);
  }, 300);

  function selectRatio(id: AspectRatioId) {
    markRatio(id);
    if (!cropper) return;
    cropper.setAspectRatio(aspectRatioValue(id, info.width, info.height));
    if (id !== 'free') cropper.setData(defaultCrop(id, info.width, info.height));
    const crop = currentCrop();
    if (crop) session.setAspectRatio(id, crop);
  }

  function reset() {
    if (!cropper) return;
    cropper.reset();
    const id = session.project.aspectRatio;
    cropper.setData(defaultCrop(id, info.width, info.height));
    const crop = currentCrop();
    if (crop) session.setCrop(crop);
  }

  const zoomOut = button('Zoom out', () => cropper?.zoom(-0.1), { class: 'btn', disabled: true });
  const zoomIn = button('Zoom in', () => cropper?.zoom(0.1), { class: 'btn', disabled: true });
  const resetBtn = button('Reset crop', reset, { class: 'btn', disabled: true });
  const confirm = button(
    'Use this crop',
    () => {
      saveCrop.cancel();
      const crop = currentCrop();
      if (crop) session.setCrop(crop);
      onConfirm();
    },
    { class: 'btn btn-primary', disabled: true },
  );

  markRatio(session.project.aspectRatio);

  loadCropper()
    .then(({ default: CropperClass }) => {
      if (destroyed) return;
      const id = session.project.aspectRatio;
      const initial = session.crop!;
      cropper = new CropperClass(image, {
        viewMode: 1,
        dragMode: 'move',
        aspectRatio: aspectRatioValue(id, info.width, info.height),
        autoCropArea: 1,
        // The browser has already applied EXIF orientation; letting Cropper.js do it too would rotate twice.
        checkOrientation: false,
        checkCrossOrigin: false,
        background: false,
        toggleDragModeOnDblclick: false,
        zoomOnWheel: true,
        wheelZoomRatio: 0.1,
        responsive: true,
        restore: true,
        minContainerHeight: 240,
        ready() {
          cropper!.setData(initial);
          for (const control of [zoomOut, zoomIn, resetBtn, confirm]) control.disabled = false;
          status.textContent = 'Drag to move the picture. Pinch or use the zoom buttons to zoom. Drag the corners to change the crop.';
        },
        cropend: () => saveCrop(),
        zoom: () => saveCrop(),
      });
    })
    .catch((error) => {
      console.error(error);
      status.textContent = 'The crop tool could not be loaded. Please check your internet connection and try again.';
      status.classList.add('error-text');
    });

  const el = h(
    'section',
    { class: 'step step-crop', 'aria-labelledby': 'crop-heading' },
    h('h2', { id: 'crop-heading', class: 'step-heading' }, 'Crop Image'),
    h('p', { class: 'field-hint', id: 'ratio-label' }, 'Shape'),
    ratioGroup,
    stage,
    status,
    h('div', { class: 'toolbar' }, zoomOut, zoomIn, resetBtn, h('span', { class: 'toolbar-spacer' }), confirm),
  );

  return {
    el,
    destroy() {
      destroyed = true;
      // Keep the latest crop when leaving the step by any route.
      saveCrop.cancel();
      const crop = currentCrop();
      if (crop) session.setCrop(crop);
      cropper?.destroy();
      cropper = null;
    },
  };
}
