import { createLibrary } from '../components/project-library';
import type { StepView } from '../components/upload';
import { confirmDialog } from '../utils/dialog';
import { button, h } from '../utils/dom';
import { loadUpload } from '../services/image-loader';
import { userMessage } from '../utils/errors';
import { createEditor } from './navigation';
import { EditorSession } from './state';

/**
 * Top-level view switching between My Artworks and the editor. There is no URL routing:
 * the address never changes, so nothing about local projects appears in links or history.
 * One history entry is pushed while editing so the Android back button returns to the library.
 */
export function startApp(root: HTMLElement): void {
  const main = h('main', { class: 'main', id: 'main' });
  const banner = h('p', { class: 'error-text app-error', role: 'alert' });
  let view: StepView | null = null;
  let session: EditorSession | null = null;
  let inEditorHistory = false;

  const header = h(
    'header',
    { class: 'app-header' },
    h('a', { class: 'skip-link', href: '#main' }, 'Skip to content'),
    button('ArtFrame', () => void showLibrary(), { class: 'brand' }),
  );
  root.replaceChildren(header, banner, main);

  function mount(next: StepView) {
    view?.destroy();
    view = next;
    main.replaceChildren(next.el);
    window.scrollTo(0, 0);
  }

  /** Saves and closes the current artwork. Returns false if the artist chose to stay. */
  async function closeSession(): Promise<boolean> {
    if (!session) return true;
    await session.flush();
    if (session.hasUnsavedChanges) {
      const leave = await confirmDialog(
        'Your latest changes could not be saved on this device. If you leave now, they will be lost.',
        { confirmLabel: 'Leave without saving', cancelLabel: 'Stay', danger: true },
      );
      if (!leave) return false;
    }
    view?.destroy();
    view = null;
    session.dispose();
    session = null;
    return true;
  }

  async function showLibrary(fromHistory = false) {
    if (!(await closeSession())) {
      if (fromHistory) pushEditorHistory();
      return;
    }
    if (inEditorHistory && !fromHistory) {
      inEditorHistory = false;
      history.back();
    }
    inEditorHistory = false;
    banner.textContent = '';
    mount(createLibrary({ onCreate: createFromFile, onOpen: (id) => void openEditor(id) }));
  }

  /**
   * New artwork: the picture is chosen first (straight from My Artworks), so the editor
   * opens on Crop. Nothing is created if opening the picture fails; the error shows in the library.
   */
  async function createFromFile(file: File, onProgress: (message: string) => void) {
    if (!(await closeSession())) return;
    const upload = await loadUpload(file, onProgress);
    onProgress('Saving…');
    const next = EditorSession.createNew();
    await next.setImage(file, upload);
    next.setStep('crop');
    banner.textContent = '';
    session = next;
    mount(createEditor(next, () => void showLibrary()));
    if (!inEditorHistory) pushEditorHistory();
  }

  async function openEditor(projectId: string) {
    if (!(await closeSession())) return;
    banner.textContent = '';
    let next: EditorSession;
    try {
      next = await EditorSession.open(projectId);
    } catch (error) {
      banner.textContent = userMessage(error, 'This artwork could not be opened. Please try again.');
      void showLibrary();
      return;
    }
    session = next;
    mount(createEditor(next, () => void showLibrary()));
    if (!inEditorHistory) pushEditorHistory();
  }

  function pushEditorHistory() {
    history.pushState({ artframe: 'editor' }, '', location.pathname);
    inEditorHistory = true;
  }

  window.addEventListener('popstate', () => {
    if (session) void showLibrary(true);
  });

  // Save straight away when the tab is hidden: mobile browsers may discard it without warning.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void session?.flush();
  });
  window.addEventListener('pagehide', () => void session?.flush());
  window.addEventListener('beforeunload', (event) => {
    if (session && (session.hasUnsavedChanges || session.saveStatus === 'saving')) {
      void session.flush();
      event.preventDefault();
    }
  });

  history.replaceState(null, '', location.pathname);
  void showLibrary();
}
