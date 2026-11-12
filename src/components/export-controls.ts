import type { EditorSession } from '../app/state';
import {
  canShareFile,
  downloadBlob,
  ExportTooLargeError,
  renderExport,
  shareBlob,
} from '../services/export-service';
import { canStreamPng } from '../services/png-encoder';
import type { ExportFormat } from '../types/artwork';
import { button, h } from '../utils/dom';
import { userMessage } from '../utils/errors';
import { artworkFilename } from '../utils/filename-generator';
import { createArtworkPreview } from './artwork-preview';
import { OVERFLOW_MESSAGE } from './metadata-form';
import type { StepView } from './upload';

const FORMATS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'png', label: 'PNG', hint: 'Best quality. Recommended.' },
  { format: 'jpg', label: 'JPG', hint: 'Smaller file, very slightly compressed.' },
  { format: 'jpeg', label: 'JPEG', hint: 'The same as JPG, with “.jpeg” at the end of the name.' },
  { format: 'pdf', label: 'PDF', hint: 'For printing or sending as a document.' },
];

let lastFormat: ExportFormat = 'png';

export function createPreviewStep(session: EditorSession): StepView {
  const preview = createArtworkPreview(session, { maxHeightRatio: 0.65 });
  const status = h('p', { class: 'status-text', role: 'status', 'aria-live': 'polite' });
  const progress = h('progress', { class: 'progress', max: 100, value: 0, hidden: true });
  const result = h('div', { class: 'export-result', 'aria-live': 'polite' });
  let busy = false;

  const options = FORMATS.map(({ format, label, hint }) => {
    const id = `format-${format}`;
    const radio = h('input', {
      type: 'radio',
      name: 'format',
      id,
      value: format,
      class: 'radio',
      'aria-labelledby': `${id}-label`,
      'aria-describedby': `${id}-hint`,
    });
    radio.checked = format === lastFormat;
    radio.addEventListener('change', () => {
      lastFormat = format;
      result.replaceChildren();
    });
    return h(
      'label',
      { class: 'format-option', for: id },
      radio,
      h(
        'span',
        { class: 'format-text' },
        h('span', { class: 'format-label', id: `${id}-label` }, label),
        h('span', { class: 'format-hint', id: `${id}-hint` }, hint),
      ),
    );
  });

  const downloadBtn = button('Download', () => void runExport(1), { class: 'btn btn-primary btn-large' });
  const overflowNote = h('p', { class: 'warning-text' });

  function selectedFormat(): ExportFormat {
    return (options.map((o) => o.querySelector('input')!).find((r) => r.checked)?.value as ExportFormat) ?? 'png';
  }

  function refreshAvailability() {
    const overflow = session.layout()?.metadata.overflow ?? false;
    overflowNote.textContent = overflow ? `${OVERFLOW_MESSAGE} Go back to Details to edit them.` : '';
    downloadBtn.disabled = overflow || busy;
  }
  const unsubscribe = session.subscribe((change) => {
    if (change === 'metadata' || change === 'crop' || change === 'sheet') refreshAvailability();
  });

  async function runExport(scale: number, format = selectedFormat()) {
    const layout = session.layout();
    const crop = session.crop;
    if (busy || !layout || !crop || !session.image || layout.metadata.overflow) return;
    busy = true;
    refreshAvailability();
    result.replaceChildren();
    progress.hidden = false;
    progress.value = 0;
    status.textContent = 'Preparing your file… This can take a little while for large pictures.';
    const filename = artworkFilename(session.project.metadata, format);
    try {
      const blob = await renderExport(
        {
          format,
          layout,
          crop,
          source: { image: session.image.element, scale: 1 },
          scale,
          title: session.project.metadata.title.trim(),
        },
        (fraction) => (progress.value = Math.round(fraction * 100)),
      );
      status.textContent = '';
      downloadBlob(blob, filename);
      showReady(blob, filename, scale);
    } catch (error) {
      status.textContent = '';
      showFailure(error, format);
    } finally {
      busy = false;
      progress.hidden = true;
      refreshAvailability();
    }
  }

  function showReady(blob: Blob, filename: string, scale: number) {
    const actions = h(
      'div',
      { class: 'toolbar' },
      button('Download again', () => downloadBlob(blob, filename), { class: 'btn' }),
    );
    if (canShareFile(blob, filename)) {
      actions.append(
        button(
          'Share or Save to Files',
          () =>
            void shareBlob(blob, filename).catch((error: unknown) => {
              if (!(error instanceof DOMException && error.name === 'AbortError')) {
                status.textContent = 'Sharing did not work. Please use Download again.';
              }
            }),
          { class: 'btn' },
        ),
      );
    }
    result.replaceChildren(
      h('p', { class: 'success-text' }, `Your file is ready: ${filename}`),
      scale < 1
        ? h('p', { class: 'field-hint' }, `This file was made at ${Math.round(scale * 100)}% of full size, as you chose.`)
        : '',
      h('p', { class: 'field-hint' }, 'If the download did not start, tap “Download again” or use “Share or Save to Files”.'),
      actions,
    );
  }

  function showFailure(error: unknown, format: ExportFormat) {
    const message = userMessage(error, 'The file could not be created. Your artwork is safe. Please try again.');
    const parts: Node[] = [h('p', { class: 'error-text', role: 'alert' }, message)];
    if (error instanceof ExportTooLargeError) {
      const actions = h('div', { class: 'toolbar' });
      if (format !== 'png' && canStreamPng()) {
        actions.append(button('Download full-size PNG instead', () => void runExport(1, 'png'), { class: 'btn btn-primary' }));
      }
      if (error.maxScale > 0) {
        const percent = Math.round(error.maxScale * 100);
        actions.append(
          button(`Make a smaller ${format.toUpperCase()} (${percent}% of full size)`, () => void runExport(error.maxScale, format), {
            class: 'btn',
          }),
        );
      }
      parts.push(
        h(
          'p',
          { class: 'field-hint' },
          'A smaller file has less detail than your original picture. Your saved artwork is not changed.',
        ),
        actions,
      );
    }
    result.replaceChildren(...parts);
  }

  refreshAvailability();

  const el = h(
    'section',
    { class: 'step step-preview', 'aria-labelledby': 'preview-heading' },
    h('h2', { id: 'preview-heading', class: 'step-heading' }, 'Preview and Download'),
    h(
      'div',
      { class: 'split' },
      h('div', { class: 'split-preview' }, preview.el),
      h(
        'div',
        { class: 'export-panel' },
        h('fieldset', { class: 'format-group' }, h('legend', { class: 'field-label' }, 'File type'), ...options),
        h(
          'p',
          { class: 'field-hint' },
          'PNG keeps every detail of your picture exactly. JPG and JPEG are slightly compressed to make smaller files. ' +
            'No file type can bring back detail that was not in the original photo.',
        ),
        overflowNote,
        downloadBtn,
        progress,
        status,
        result,
        h(
          'div',
          { class: 'toolbar' },
          button('Change background', () => session.setStep('sheet'), { class: 'btn' }),
          button('Edit details', () => session.setStep('details'), { class: 'btn' }),
          button('Change crop', () => session.setStep('crop'), { class: 'btn' }),
        ),
      ),
    ),
  );

  return {
    el,
    destroy() {
      unsubscribe();
      preview.destroy();
    },
  };
}
