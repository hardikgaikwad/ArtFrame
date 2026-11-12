import {
  deleteProject,
  getProject,
  getThumbnail,
  isStorageAvailable,
  listProjects,
  saveProject,
} from '../services/storage-service';
import { ACCEPT_ATTRIBUTE } from '../services/image-loader';
import type { Project } from '../types/project';
import { confirmDialog, promptDialog } from '../utils/dialog';
import { button, friendlyDate, h } from '../utils/dom';
import { userMessage } from '../utils/errors';
import { ObjectUrlSet } from '../utils/memory-manager';
import type { StepView } from './upload';

export function displayName(project: Project): string {
  return project.name.trim() || project.metadata.title.trim() || 'Untitled artwork';
}

export function createLibrary(actions: {
  onCreate(file: File, onProgress: (message: string) => void): Promise<void>;
  onOpen(id: string): void;
}): StepView {
  const urls = new ObjectUrlSet();
  const list = h('ul', { class: 'library-list', 'aria-label': 'Saved artworks' });
  const message = h('p', { class: 'error-text', role: 'alert' });
  const status = h('p', { class: 'status-text', role: 'status', 'aria-live': 'polite' });
  let destroyed = false;

  // "New Artwork" opens the photo picker straight away, as camera and messaging apps do.
  const input = h('input', { type: 'file', accept: ACCEPT_ATTRIBUTE, class: 'visually-hidden', id: 'upload-input', tabindex: -1 });
  const createBtn = button('New Artwork', () => input.click(), { class: 'btn btn-primary btn-new', 'aria-label': 'New Artwork' });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void create(file);
  });

  async function create(file: File) {
    message.textContent = '';
    createBtn.disabled = true;
    status.textContent = 'Opening your picture…';
    try {
      await actions.onCreate(file, (text) => (status.textContent = text));
    } catch (error) {
      message.textContent = userMessage(error, 'This picture could not be opened. Please try another photo.');
    } finally {
      if (!destroyed) {
        status.textContent = '';
        createBtn.disabled = false;
      }
    }
  }

  async function refresh() {
    if (!(await isStorageAvailable())) {
      list.replaceChildren();
      message.textContent =
        'Saving is not available in this browser (private browsing can block it). ' +
        'You can still create and download artwork sheets, but they will not be kept.';
      return;
    }
    let projects: Project[];
    try {
      projects = await listProjects();
    } catch (error) {
      message.textContent = userMessage(error, 'Your saved artworks could not be loaded. Please reload the page.');
      return;
    }
    if (destroyed) return;
    urls.revokeAll();
    thumbs.clear();
    if (projects.length === 0) {
      list.replaceChildren(
        h(
          'li',
          { class: 'empty-state' },
          h('p', { class: 'empty-title' }, 'No artworks yet'),
          h('p', { class: 'field-hint' }, 'Tap “New Artwork” and choose a photo of your work.'),
        ),
      );
    } else {
      list.replaceChildren(...projects.map(row));
      void Promise.all(projects.map(loadThumbnail));
    }
  }

  const thumbs = new Map<string, HTMLElement>();

  function row(project: Project): HTMLElement {
    const name = displayName(project);
    const thumb = h('span', { class: 'library-thumb', 'aria-hidden': 'true' });
    thumbs.set(project.id, thumb);
    const open = h(
      'button',
      { type: 'button', class: 'library-open' },
      thumb,
      h(
        'span',
        { class: 'library-text' },
        h('span', { class: 'library-name' }, name),
        h('span', { class: 'field-hint' }, friendlyDate(project.modifiedAt)),
      ),
      h('span', { class: 'library-chevron', 'aria-hidden': 'true' }, '›'),
    );
    open.addEventListener('click', () => actions.onOpen(project.id));
    return h(
      'li',
      { class: 'library-item' },
      open,
      h(
        'div',
        { class: 'library-actions' },
        button('Open', () => actions.onOpen(project.id), { class: 'btn btn-primary', 'aria-label': `Open ${name}` }),
        button('Rename', () => void rename(project.id), { class: 'btn', 'aria-label': `Rename ${name}` }),
        button('Delete', () => void remove(project.id, name), { class: 'btn btn-danger-quiet', 'aria-label': `Delete ${name}` }),
      ),
    );
  }

  async function loadThumbnail(project: Project) {
    try {
      const blob = await getThumbnail(project.id);
      const holder = thumbs.get(project.id);
      if (!blob || !holder || destroyed) return;
      holder.replaceChildren(h('img', { src: urls.create(blob), alt: '' }));
    } catch {
      // A missing thumbnail only affects the library picture.
    }
  }

  async function rename(id: string) {
    const project = await getProject(id);
    if (!project) return;
    const name = await promptDialog('New name (only shown here, not on the picture):', displayName(project), 'Rename');
    if (name === null) return;
    try {
      project.name = name;
      project.modifiedAt = Date.now();
      await saveProject(project);
      await refresh();
    } catch (error) {
      message.textContent = userMessage(error, 'The artwork could not be renamed. Please try again.');
    }
  }

  async function remove(id: string, name: string) {
    const ok = await confirmDialog(`Delete “${name}”? This cannot be undone.`, {
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(id);
      await refresh();
    } catch (error) {
      message.textContent = userMessage(error, 'The artwork could not be deleted. Please try again.');
    }
  }

  const el = h(
    'section',
    { class: 'library', 'aria-labelledby': 'library-heading' },
    h(
      'div',
      { class: 'library-header' },
      h('h1', { id: 'library-heading', class: 'page-heading' }, 'My Artworks'),
      createBtn,
    ),
    input,
    status,
    message,
    list,
    h(
      'footer',
      { class: 'storage-note' },
      h('p', { class: 'field-hint' }, 'Your work is saved on this device only. Keep the files you download.'),
      h('p', { class: 'field-hint' }, h('a', { href: '/licenses/index.html', class: 'quiet-link' }, 'Open-source licences')),
    ),
  );

  void refresh();
  return {
    el,
    destroy() {
      destroyed = true;
      urls.revokeAll();
    },
  };
}
