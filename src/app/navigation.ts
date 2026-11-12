import { createCropStep } from '../components/crop-editor';
import { createPreviewStep } from '../components/export-controls';
import { createDetailsStep } from '../components/metadata-form';
import { createSheetStep } from '../components/sheet-shape';
import { displayName } from '../components/project-library';
import { createUploadStep, type StepView } from '../components/upload';
import { button, h } from '../utils/dom';
import type { EditorSession, EditorStep } from './state';

const STEPS: { step: EditorStep; label: string; short: string }[] = [
  { step: 'upload', label: 'Upload', short: 'Upload' },
  { step: 'crop', label: 'Crop', short: 'Crop' },
  { step: 'details', label: 'Details', short: 'Details' },
  { step: 'sheet', label: 'Background', short: 'Layout' },
  { step: 'preview', label: 'Preview and Download', short: 'Download' },
];

/** The editing screen: title bar with save status, step tabs, and the current step. */
export function createEditor(session: EditorSession, onClose: () => void): StepView {
  const title = h('h1', { class: 'page-heading editor-title' });
  const saveState = h('div', { class: 'save-state', role: 'status', 'aria-live': 'polite' });
  const notice = h('p', { class: 'warning-text', role: 'status' }, session.notice);
  const content = h('div', { class: 'editor-content' });
  let current: StepView | null = null;
  let shownStep: EditorStep | null = null;

  // Phones show a short label so all four steps fit across the screen.
  const tabs = STEPS.map(({ step, label, short }, i) => {
    const tab = h(
      'button',
      { type: 'button', class: 'step-tab', 'aria-label': `${i + 1}. ${label}` },
      h('span', { class: 'step-tab-long' }, `${i + 1}. ${label}`),
      h('span', { class: 'step-tab-short', 'aria-hidden': 'true' }, short),
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
        saveState.replaceChildren(session.image ? '' : 'Saved automatically once you upload a picture');
    }
  }

  function renderSteps() {
    STEPS.forEach(({ step }, i) => {
      tabs[i].disabled = step !== 'upload' && !session.image;
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
        current = createPreviewStep(session);
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
