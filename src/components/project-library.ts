import {
  deleteProject,
  getProject,
  getThumbnail,
  isStorageAvailable,
  listProjects,
  saveProject,
  storageEstimate,
} from '../services/storage-service';
import type { Project } from '../types/project';
import { confirmDialog, promptDialog } from '../utils/dialog';
import { button, formatDate, h } from '../utils/dom';
import { userMessage } from '../utils/errors';
import { ObjectUrlSet } from '../utils/memory-manager';
import type { StepView } from './upload';

export function displayName(project: Project): string {
  return project.name.trim() || project.metadata.title.trim() || 'Untitled artwork';
}

export function createLibrary(actions: { onCreate(): void; onOpen(id: string): void }): StepView {
  const urls = new ObjectUrlSet();
  const list = h('ul', { class: 'library-list', 'aria-label': 'Saved artworks' });
  const message = h('p', { class: 'error-text', role: 'alert' });
  const usage = h('p', { class: 'field-hint' });
  let destroyed = false;

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
          h('p', { class: 'empty-title' }, 'No saved artworks yet'),
          h('p', { class: 'field-hint' }, 'Upload a photo or scan of your work to make your first artwork sheet.'),
          button('Create New Artwork', actions.onCreate, { class: 'btn btn-primary' }),
        ),
      );
    } else {
      list.replaceChildren(...projects.map(row));
      void Promise.all(projects.map(loadThumbnail));
    }
    const estimate = await storageEstimate();
    if (estimate && !destroyed) {
      const usedMb = estimate.usage / 1024 / 1024;
      const amount = usedMb < 1 ? 'less than 1 MB' : `about ${Math.round(usedMb)} MB`;
      usage.textContent = `Saved artworks are using ${amount} of this device's browser storage.`;
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
        h('span', { class: 'field-hint' }, `Last changed ${formatDate(project.modifiedAt)}`),
      ),
    );
    open.addEventListener('click', () => actions.onOpen(project.id));
    return h(
      'li',
      { class: 'library-item' },
      open,
      h(
        'div',
        { class: 'library-actions' },
        button('Open', () => actions.onOpen(project.id), { class: 'btn', 'aria-label': `Open ${name}` }),
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
    const name = await promptDialog('Name shown in My Artworks (this is not printed on the sheet):', displayName(project), 'Rename');
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
    const ok = await confirmDialog(`Delete “${name}”? This removes the saved picture and details from this device. It cannot be undone.`, {
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
      button('Create New Artwork', actions.onCreate, { class: 'btn btn-primary' }),
    ),
    message,
    list,
    h(
      'aside',
      { class: 'storage-note' },
      h('h2', { class: 'field-label' }, 'About saving'),
      h(
        'p',
        { class: 'field-hint' },
        'Your artworks are saved automatically, but only in this browser on this device. ' +
          'They are not backed up and do not appear on your other devices. Clearing your browser’s data removes them. ' +
          'Keep the files you download as your permanent copies.',
      ),
      usage,
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
