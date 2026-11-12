import { createCropStep } from '../components/crop-editor';
import { createPreviewStep } from '../components/export-controls';
import { createDetailsStep } from '../components/metadata-form';
import { createSheetStep } from '../components/sheet-shape';
import { displayName } from '../components/project-library';
import { createUploadStep, type StepView } from '../components/upload';
import { button, h } from '../utils/dom';
import type { EditorSession, EditorStep } from './state';

/** The steps shown in the progress bar. Choosing the picture happens before the editor opens. */
export const STEPS: { step: EditorStep; label: string }[] = [
  { step: 'crop', label: 'Crop' },
  { step: 'details', label: 'Details' },
  { step: 'sheet', label: 'Background' },
  { step: 'preview', label: 'Download' },
];

/** The editing screen: title bar with save status, numbered steps, and the current step. */
export function createEditor(session: EditorSession, onClose: () => void): StepView {
  const title = h('h1', { class: 'page-heading editor-title' });
  const saveState = h('div', { class: 'save-state', role: 'status', 'aria-live': 'polite' });
  const notice = h('p', { class: 'warning-text', role: 'status' }, session.notice);
  const content = h('div', { class: 'editor-content' });
  let current: StepView | null = null;
  let shownStep: EditorStep | null = null;

  // A numbered progress bar; any step can be revisited by tapping it.
  const tabs = STEPS.map(({ step, label }, i) => {
    const tab = h(
      'button',
      { type: 'button', class: 'step-tab', 'aria-label': `${i + 1}. ${label}` },
      h('span', { class: 'step-number', 'aria-hidden': 'true' }, String(i + 1)),
      h('span', { class: 'step-label', 'aria-hidden': 'true' }, label),
    );
    tab.addEventListener('click', () => session.setStep(step));
    return tab;
  });

  function renderTitle() {
    title.textContent = session.project.image ? displayName(session.project) : 'New Artwork';
  }

  function renderSaveState() {
    const status = session.saveStatus;
    saveState.className = `save-state save-${status}`;
    switch (status) {
      case 'saving':
        saveState.replaceChildren('Saving…');
        break;
      case 'saved':
        saveState.replaceChildren('Saved');
        break;
      case 'error':
        saveState.replaceChildren(
          h('span', {}, 'Save failed. '),
          h('span', { class: 'save-detail' }, session.saveMessage),
          button('Try again', () => void session.flush(), { class: 'btn btn-small' }),
        );
        break;
      default:
        saveState.replaceChildren();
    }
  }

  function renderSteps() {
    const currentIndex = STEPS.findIndex(({ step }) => step === session.step);
    STEPS.forEach(({ step }, i) => {
      tabs[i].disabled = !session.image;
      tabs[i].classList.toggle('is-done', currentIndex >= 0 && i < currentIndex);
      if (step === session.step) tabs[i].setAttribute('aria-current', 'step');
      else tabs[i].removeAttribute('aria-current');
    });
    if (shownStep === session.step) return;
    current?.destroy();
    shownStep = session.step;
    const goto = (step: EditorStep) => () => session.setStep(step);
    switch (session.step) {
      case 'upload':
        current = createUploadStep(session, goto('crop'));
        break;
      case 'crop':
        current = createCropStep(session, goto('details'));
        break;
      case 'details':
        current = createDetailsStep(session, goto('sheet'));
        break;
      case 'sheet':
        current = createSheetStep(session, goto('preview'));
        break;
      case 'preview':
        current = createPreviewStep(session, onClose);
        break;
    }
    content.replaceChildren(current.el);
    window.scrollTo(0, 0);
  }

  const unsubscribe = session.subscribe((change) => {
    if (change === 'save') renderSaveState();
    if (change === 'step' || change === 'image') {
      renderSteps();
      renderSaveState();
    }
    if (change === 'metadata' || change === 'image') renderTitle();
  });

  renderTitle();
  renderSaveState();
  renderSteps();

  const el = h(
    'div',
    { class: 'editor' },
    h(
      'div',
      { class: 'editor-bar' },
      button('‹ My Artworks', onClose, { class: 'btn btn-quiet' }),
      title,
      saveState,
    ),
    h('nav', { class: 'step-tabs', 'aria-label': 'Steps' }, ...tabs),
    notice,
    content,
  );
  return {
    el,
    destroy() {
      unsubscribe();
      current?.destroy();
      current = null;
    },
  };
}
