import type { Project, ProjectAssets } from '../types/project';

/**
 * IndexedDB persistence. Three stores:
 *  - projects:   small records, rewritten on every autosave
 *  - assets:     original/working image Blobs, written only when the image changes
 *  - thumbnails: library thumbnails, kept apart so refreshing one never rewrites
 *                multi-megabyte image Blobs and the library loads without them
 *
 * Binary data is stored as raw bytes (ArrayBuffer + MIME type) rather than as Blob
 * objects. The bytes are exactly those of the uploaded file, but this sidesteps the
 * Blob-in-IndexedDB failures some WebKit builds have had. It is converted back to a
 * Blob on read, so callers only ever see Blobs.
 */
const DB_NAME = 'artframe-db';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const ASSETS = 'assets';
const THUMBNAILS = 'thumbnails';

interface StoredBytes {
  bytes: ArrayBuffer;
  type: string;
}

interface StoredAssets {
  projectId: string;
  original: StoredBytes;
  working: StoredBytes | null;
  originalMimeType: string;
}

interface ThumbnailRecord {
  projectId: string;
  image: StoredBytes;
}

async function toStored(blob: Blob): Promise<StoredBytes> {
  return { bytes: await blob.arrayBuffer(), type: blob.type };
}

function fromStored(stored: StoredBytes): Blob {
  return new Blob([stored.bytes], { type: stored.type });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' }).createIndex('modifiedAt', 'modifiedAt');
      }
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains(THUMBNAILS)) db.createObjectStore(THUMBNAILS, { keyPath: 'projectId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema: close so it is not blocked; reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Runs `body` in one transaction and resolves when it commits (not merely when requests succeed). */
async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T | undefined;
    const request = body(tx);
    if (request) request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new DOMException('Transaction failed', 'UnknownError'));
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

export async function isStorageAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

export async function listProjects(): Promise<Project[]> {
  const all = (await transact<Project[]>([PROJECTS], 'readonly', (tx) => tx.objectStore(PROJECTS).getAll())) ?? [];
  return all.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return transact<Project>([PROJECTS], 'readonly', (tx) => tx.objectStore(PROJECTS).get(id));
}

export async function getAssets(projectId: string): Promise<ProjectAssets | undefined> {
  const stored = await transact<StoredAssets>([ASSETS], 'readonly', (tx) => tx.objectStore(ASSETS).get(projectId));
  if (!stored) return undefined;
  return {
    projectId: stored.projectId,
    original: fromStored(stored.original),
    working: stored.working ? fromStored(stored.working) : null,
    originalMimeType: stored.originalMimeType,
  };
}

export async function getThumbnail(projectId: string): Promise<Blob | undefined> {
  const record = await transact<ThumbnailRecord>([THUMBNAILS], 'readonly', (tx) =>
    tx.objectStore(THUMBNAILS).get(projectId),
  );
  return record ? fromStored(record.image) : undefined;
}

export async function saveProject(project: Project): Promise<void> {
  await transact([PROJECTS], 'readwrite', (tx) => void tx.objectStore(PROJECTS).put(project));
}

/** Saves a new or replaced image together with its project record, atomically. */
export async function saveProjectWithAssets(project: Project, assets: ProjectAssets): Promise<void> {
  // Read the bytes before the transaction starts: awaiting inside it would let it auto-commit.
  const stored: StoredAssets = {
    projectId: assets.projectId,
    original: await toStored(assets.original),
    working: assets.working ? await toStored(assets.working) : null,
    originalMimeType: assets.originalMimeType,
  };
  await transact([PROJECTS, ASSETS, THUMBNAILS], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).put(project);
    tx.objectStore(ASSETS).put(stored);
    // The old thumbnail shows the previous image; a new one follows shortly.
    tx.objectStore(THUMBNAILS).delete(project.id);
  });
}

export async function saveThumbnail(projectId: string, blob: Blob): Promise<void> {
  const record: ThumbnailRecord = { projectId, image: await toStored(blob) };
  await transact([THUMBNAILS], 'readwrite', (tx) => void tx.objectStore(THUMBNAILS).put(record));
}

export async function deleteProject(id: string): Promise<void> {
  await transact([PROJECTS, ASSETS, THUMBNAILS], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).delete(id);
    tx.objectStore(ASSETS).delete(id);
    tx.objectStore(THUMBNAILS).delete(id);
  });
}

/** Asks the browser not to evict saved artworks under storage pressure. Not supported by every browser. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return quota ? { usage, quota } : null;
  } catch {
    return null;
  }
}
