import type { EditorSession } from '../app/state';
import { SHEET_RATIOS, type SheetRatioId } from '../services/layout-engine';
import { button, h } from '../utils/dom';
import { createArtworkPreview } from './artwork-preview';
import type { StepView } from './upload';

const LABELS: Record<SheetRatioId, string> = {
  auto: 'Automatic',
  '1:1': '1:1',
  '4:5': '4:5',
  '5:4': '5:4',
  '3:4': '3:4',
  '4:3': '4:3',
  '2:3': '2:3',
  '3:2': '3:2',
  '16:9': '16:9',
  '9:16': '9:16',
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

  // Size of artwork: a slider plus − / + buttons (5% steps). The range depends on the
  // artwork and background shape, so it is read back from the layout after every change.
  const percent = (scale: number) => Math.round(scale * 100);
  const slider = h('input', { type: 'range', id: 'artwork-size', class: 'size-slider', step: 1 });
  const value = h('output', { class: 'size-value', for: 'artwork-size', 'aria-live': 'polite' });
  const nudge = (direction: 1 | -1) => {
    const scale = session.layout()?.scale;
    if (!scale) return;
    const next = Math.round((scale.value + direction * 0.05) * 20) / 20;
    session.setArtworkScale(Math.min(Math.max(next, scale.min), scale.max));
  };
  const smaller = button('−', () => nudge(-1), { class: 'btn size-step', 'aria-label': 'Make artwork smaller' });
  const larger = button('+', () => nudge(1), { class: 'btn size-step', 'aria-label': 'Make artwork larger' });
  const reset = button('Reset size', () => session.setArtworkScale(1), { class: 'btn btn-small' });
  slider.addEventListener('input', () => session.setArtworkScale(Number(slider.value) / 100));

  function syncSize() {
    const scale = session.layout()?.scale;
    if (!scale) return;
    slider.min = String(percent(scale.min));
    slider.max = String(percent(scale.max));
    slider.value = String(percent(scale.value));
    slider.setAttribute('aria-valuetext', `${percent(scale.value)}%`);
    value.textContent = `${percent(scale.value)}%`;
    smaller.disabled = percent(scale.value) <= percent(scale.min);
    larger.disabled = percent(scale.value) >= percent(scale.max);
    reset.disabled = percent(scale.value) === 100;
  }

  const sizeControl = h(
    'div',
    { class: 'size-control' },
    h(
      'div',
      { class: 'size-heading' },
      h('label', { class: 'field-label', for: 'artwork-size' }, 'Size of artwork'),
      value,
    ),
    h('div', { class: 'size-row' }, smaller, slider, larger),
    h('div', { class: 'size-footer' }, reset),
  );

  const unsubscribe = session.subscribe((change) => {
    if (change === 'sheet') mark();
    if (change === 'sheet' || change === 'crop' || change === 'metadata') syncSize();
  });
  mark();
  syncSize();

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
        sizeControl,
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
