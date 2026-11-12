import type { EditorSession } from '../app/state';
import type { MetadataField } from '../types/artwork';
import { button, h } from '../utils/dom';
import { createArtworkPreview } from './artwork-preview';
import type { StepView } from './upload';

const FIELDS: { field: MetadataField; label: string; example: string }[] = [
  { field: 'edition', label: 'Edition', example: 'e.g. 1/10, A/P, Monoprint' },
  { field: 'medium', label: 'Medium', example: 'e.g. Drypoint' },
  { field: 'size', label: 'Size', example: 'e.g. 25×15cm' },
  { field: 'title', label: 'Title', example: 'e.g. Untitled' },
  { field: 'year', label: 'Year', example: 'e.g. 2017' },
];

export const OVERFLOW_MESSAGE =
  'These details are too long to fit on one line under the artwork. Please shorten some of them.';

export function createDetailsStep(session: EditorSession, onContinue: () => void): StepView {
  const preview = createArtworkPreview(session, { maxHeightRatio: 0.6 });
  const warning = h('p', { class: 'warning-text', role: 'status', 'aria-live': 'polite' });

  const inputs = FIELDS.map(({ field, label, example }) => {
    const id = `field-${field}`;
    const input = h('input', {
      type: 'text',
      id,
      name: field,
      class: 'input',
      placeholder: example,
      autocomplete: 'off',
      autocapitalize: field === 'edition' ? 'off' : 'sentences',
      spellcheck: field === 'title' || field === 'medium' ? 'true' : 'false',
      maxlength: 200,
      enterkeyhint: 'next',
    });
    input.value = session.project.metadata[field];
    input.addEventListener('input', () => session.updateMetadata(field, input.value));
    return h('div', { class: 'field' }, h('label', { for: id, class: 'field-label' }, label), input);
  });

  // The keyboard's "next" key moves between fields instead of leaving the step.
  inputs.forEach((wrapper, i) => {
    wrapper.querySelector('input')!.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || i === inputs.length - 1) return;
      event.preventDefault();
      inputs[i + 1].querySelector('input')!.focus();
    });
  });

  function updateWarning() {
    const overflow = session.layout()?.metadata.overflow ?? false;
    warning.textContent = overflow ? OVERFLOW_MESSAGE : '';
  }
  const unsubscribe = session.subscribe((change) => {
    if (change === 'metadata' || change === 'crop') updateWarning();
  });
  updateWarning();

  const form = h(
    'form',
    { class: 'details-form', novalidate: true },
    h('p', { class: 'field-hint' }, 'All details are optional. Anything left empty is left off the sheet.'),
    ...inputs,
    warning,
    h(
      'div',
      { class: 'toolbar' },
      button('Change crop', () => session.setStep('crop'), { class: 'btn' }),
      h('span', { class: 'toolbar-spacer' }),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Continue to Background'),
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onContinue();
  });

  const el = h(
    'section',
    { class: 'step step-details', 'aria-labelledby': 'details-heading' },
    h('h2', { id: 'details-heading', class: 'step-heading' }, 'Artwork Details'),
    h('div', { class: 'split' }, form, h('div', { class: 'split-preview' }, preview.el)),
  );
  return {
    el,
    destroy() {
      unsubscribe();
      preview.destroy();
    },
  };
}
