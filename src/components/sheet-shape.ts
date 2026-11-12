import type { EditorSession } from '../app/state';
import { SHEET_RATIOS, type SheetRatioId } from '../services/layout-engine';
import { button, h } from '../utils/dom';
import { createArtworkPreview } from './artwork-preview';
import type { StepView } from './upload';

const LABELS: Record<SheetRatioId, string> = {
  auto: 'Automatic',
  '4:5': '4:5',
  '5:4': '5:4',
  '3:4': '3:4',
  '4:3': '4:3',
  '2:3': '2:3',
  '3:2': '3:2',
};

/** Chooses the shape of the white background. The artwork itself is not changed. */
export function createSheetStep(session: EditorSession, onContinue: () => void): StepView {
  const preview = createArtworkPreview(session, { maxHeightRatio: 0.6 });

  const options = new Map<SheetRatioId, HTMLButtonElement>();
  const group = h('div', { class: 'segmented segmented-sheet', role: 'group', 'aria-label': 'Shape of the background' });
  for (const id of SHEET_RATIOS) {
    const option = button(LABELS[id], () => session.setSheetRatio(id), { class: 'segmented-option' });
    options.set(id, option);
    group.append(option);
  }
  function mark() {
    for (const [id, option] of options) option.setAttribute('aria-pressed', String(id === session.sheetRatio));
  }
  const unsubscribe = session.subscribe((change) => {
    if (change === 'sheet') mark();
  });
  mark();

  const el = h(
    'section',
    { class: 'step step-sheet', 'aria-labelledby': 'sheet-heading' },
    h('h2', { id: 'sheet-heading', class: 'step-heading' }, 'Background Shape'),
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'details-form' },
        h(
          'p',
          { class: 'field-hint' },
          'Choose the shape of the white background. Your artwork and its details stay centred. ' +
            'Automatic fits the background to your artwork.',
        ),
        group,
        h(
          'div',
          { class: 'toolbar' },
          button('Edit details', () => session.setStep('details'), { class: 'btn' }),
          h('span', { class: 'toolbar-spacer' }),
          button('Continue to Preview', onContinue, { class: 'btn btn-primary' }),
        ),
      ),
      h('div', { class: 'split-preview' }, preview.el),
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
