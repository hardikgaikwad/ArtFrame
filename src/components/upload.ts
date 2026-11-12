import type { EditorSession } from '../app/state';
import { ACCEPT_ATTRIBUTE, loadUpload } from '../services/image-loader';
import { confirmDialog } from '../utils/dialog';
import { h } from '../utils/dom';
import { userMessage } from '../utils/errors';
import { stepFooter } from './step-footer';

export interface StepView {
  el: HTMLElement;
  destroy(): void;
}

export function createUploadStep(session: EditorSession, onUploaded: () => void): StepView {
  const input = h('input', { type: 'file', accept: ACCEPT_ATTRIBUTE, class: 'visually-hidden', id: 'upload-input' });
  const status = h('p', { class: 'status-text', role: 'status', 'aria-live': 'polite' });
  const error = h('p', { class: 'error-text', role: 'alert' });
  let busy = false;

  const zone = h(
    'label',
    { class: 'upload-zone', for: 'upload-input' },
    h('span', { class: 'upload-zone-title' }, 'Choose a photo'),
    h('span', { class: 'upload-zone-hint' }, 'Tap here to pick a photo or scan of your artwork.'),
  );

  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    error.textContent = '';
    if (session.image) {
      const ok = await confirmDialog(
        'Replace the picture for this artwork? Your crop will be reset. Your artwork details will be kept.',
        { confirmLabel: 'Replace picture' },
      );
      if (!ok) return;
    }
    busy = true;
    zone.classList.add('is-busy');
    status.textContent = 'Opening your picture…';
    try {
      const upload = await loadUpload(file, (message) => (status.textContent = message));
      status.textContent = 'Saving…';
      await session.setImage(file, upload);
      status.textContent = '';
      onUploaded();
    } catch (err) {
      status.textContent = '';
      error.textContent = userMessage(err, 'This picture could not be opened. Please try another file.');
    } finally {
      busy = false;
      zone.classList.remove('is-busy');
      input.value = '';
    }
  }

  input.addEventListener('change', () => void handleFile(input.files?.[0]));
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('is-dragging');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-dragging');
    void handleFile(event.dataTransfer?.files[0]);
  });

  const el = h(
    'section',
    { class: 'step step-upload', 'aria-labelledby': 'upload-heading' },
    h('h2', { id: 'upload-heading', class: 'step-heading' }, session.image ? 'Use a different picture' : 'Add your picture'),
    input,
    zone,
    status,
    error,
    session.image ? stepFooter(() => session.setStep('crop'), h('span')) : null,
  );
  return { el, destroy() {} };
}
