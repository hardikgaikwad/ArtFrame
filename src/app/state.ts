import { createPreviewSource, drawWholeSheet, type DrawSource } from '../services/composition-engine';
import { defaultCrop } from '../services/crop-service';
import { decodeImage, type DecodedImage, type LoadedUpload } from '../services/image-loader';
import { computeLayout, sheetRatioValue, type SheetLayout, type SheetRatioId } from '../services/layout-engine';
import {
  getAssets,
  getProject,
  requestPersistentStorage,
  saveProject,
  saveProjectWithAssets,
  saveThumbnail,
} from '../services/storage-service';
import { EMPTY_METADATA, type AspectRatioId, type CropRect, type MetadataField } from '../types/artwork';
import type { Project, ProjectAssets } from '../types/project';
import { debounce } from '../utils/dom';
import { UserFacingError, userMessage } from '../utils/errors';
import { releaseCanvas } from '../utils/memory-manager';
import { measureText } from '../utils/text-measurement';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type EditorStep = 'upload' | 'crop' | 'details' | 'sheet' | 'preview';
export type SessionChange = 'image' | 'crop' | 'metadata' | 'sheet' | 'save' | 'step';

const AUTOSAVE_DELAY_MS = 600;
const THUMBNAIL_WIDTH = 360;

let persistenceRequested = false;

function newProjectId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The artwork currently being edited: its record, its decoded full-resolution image,
 * the reduced preview copy, and autosave. One session exists at a time.
 */
export class EditorSession {
  project: Project;
  /** Full-resolution, upright image: the only source used for cropping and export. */
  image: DecodedImage | null = null;
  /** Reduced copy for the live preview and thumbnails only. */
  preview: { source: DrawSource; release(): void } | null = null;
  step: EditorStep;
  saveStatus: SaveStatus = 'idle';
  saveMessage = '';
  /** False until the project has an image and has been written to storage once. */
  persisted: boolean;
  /** A message to show once when the editor opens. */
  notice = '';

  private listeners = new Set<(change: SessionChange) => void>();
  private dirty = false;
  private thumbnailDirty = false;
  /** A new or replacement image not yet written to storage. */
  private pendingAssets: ProjectAssets | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private cachedLayout: { key: string; layout: SheetLayout } | null = null;
  private readonly scheduleSave = debounce(() => void this.flush(), AUTOSAVE_DELAY_MS);

  private constructor(project: Project, persisted: boolean) {
    this.project = project;
    this.persisted = persisted;
    this.step = project.image ? (project.crop ? 'details' : 'crop') : 'upload';
  }

  static createNew(): EditorSession {
    const now = Date.now();
    return new EditorSession(
      {
        id: newProjectId(),
        name: '',
        metadata: { ...EMPTY_METADATA },
        aspectRatio: 'free',
        sheetRatio: 'auto',
        crop: null,
        image: null,
        createdAt: now,
        modifiedAt: now,
      },
      false,
    );
  }

  static async open(id: string): Promise<EditorSession> {
    const project = await getProject(id);
    if (!project) throw new UserFacingError('This artwork could not be found. It may have been deleted.');
    let image: DecodedImage | null = null;
    let notice = '';
    if (project.image) {
      const assets = await getAssets(id);
      if (assets) {
        try {
          image = await decodeImage(assets.working ?? assets.original);
        } catch {
          throw new UserFacingError('The picture for this artwork could not be opened on this device.');
        }
      } else {
        // The details survive; only the picture needs uploading again.
        project.image = null;
        project.crop = null;
        notice = 'The picture for this artwork is missing. Please upload it again; your details are kept.';
      }
    }
    const session = new EditorSession(project, true);
    session.notice = notice;
    if (image) session.attachImage(image);
    return session;
  }

  subscribe(listener: (change: SessionChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: SessionChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private attachImage(image: DecodedImage): void {
    this.preview?.release();
    this.image?.release();
    this.image = image;
    this.preview = createPreviewSource(image.element, image.width, image.height);
    this.cachedLayout = null;
  }

  setStep(step: EditorStep): void {
    if (step !== 'upload' && !this.image) return;
    this.step = step;
    this.emit('step');
  }

  /** The crop to use: the saved one, or the default for the current ratio. */
  get crop(): CropRect | null {
    const info = this.project.image;
    if (!info) return null;
    return this.project.crop ?? defaultCrop(this.project.aspectRatio, info.width, info.height);
  }

  /** Full-resolution sheet layout, shared by preview and export. */
  layout(): SheetLayout | null {
    const crop = this.crop;
    if (!crop) return null;
    const ratio = sheetRatioValue(this.sheetRatio);
    const scale = this.artworkScale;
    const key = JSON.stringify([crop.width, crop.height, ratio, scale, this.project.metadata]);
    if (this.cachedLayout?.key !== key) {
      this.cachedLayout = {
        key,
        layout: computeLayout(crop.width, crop.height, this.project.metadata, measureText, ratio, scale),
      };
    }
    return this.cachedLayout.layout;
  }

  /** Uses a new image (first upload or replacement) and stores it immediately. */
  async setImage(file: File, upload: LoadedUpload): Promise<void> {
    this.attachImage(upload.image);
    const { width, height } = upload.image;
    this.project.image = {
      width,
      height,
      format: upload.format,
      originalMimeType: upload.mimeType,
      originalFileName: file.name,
    };
    this.project.crop = defaultCrop(this.project.aspectRatio, width, height);
    this.project.modifiedAt = Date.now();
    this.emit('image');

    this.pendingAssets = {
      projectId: this.project.id,
      original: file,
      working: upload.working,
      originalMimeType: upload.mimeType,
    };
    this.dirty = true;
    this.thumbnailDirty = true;
    await this.flush();
  }

  updateMetadata(field: MetadataField, value: string): void {
    if (this.project.metadata[field] === value) return;
    this.project.metadata[field] = value;
    this.touch();
    this.emit('metadata');
  }

  get sheetRatio(): SheetRatioId {
    return this.project.sheetRatio ?? 'auto';
  }

  get artworkScale(): number {
    return this.project.artworkScale ?? 1;
  }

  /** Stored as chosen; the layout limits it to what fits this artwork and background. */
  setArtworkScale(scale: number): void {
    const rounded = Math.round(scale * 100) / 100;
    if (this.artworkScale === rounded) return;
    this.project.artworkScale = rounded;
    this.touch();
    this.emit('sheet');
  }

  setSheetRatio(sheetRatio: SheetRatioId): void {
    if (this.sheetRatio === sheetRatio) return;
    this.project.sheetRatio = sheetRatio;
    this.touch();
    this.emit('sheet');
  }

  setAspectRatio(aspectRatio: AspectRatioId, crop: CropRect): void {
    this.project.aspectRatio = aspectRatio;
    this.setCrop(crop);
  }

  setCrop(crop: CropRect): void {
    const current = this.project.crop;
    if (
      current &&
      current.x === crop.x &&
      current.y === crop.y &&
      current.width === crop.width &&
      current.height === crop.height
    ) {
      return;
    }
    this.project.crop = crop;
    this.touch();
    this.emit('crop');
  }

  private touch(): void {
    this.project.modifiedAt = Date.now();
    this.dirty = true;
    this.thumbnailDirty = true;
    if (this.persisted || this.pendingAssets) this.scheduleSave();
  }

  /** Writes pending changes now, queued behind any save in progress. Never rejects. */
  flush(): Promise<void> {
    this.scheduleSave.cancel();
    this.saveChain = this.saveChain.then(() => this.writePending());
    return this.saveChain;
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty || this.pendingAssets !== null || this.saveStatus === 'error';
  }

  private async writePending(): Promise<void> {
    // Nothing is stored for a new artwork until it has a picture.
    if (!this.dirty || (!this.persisted && !this.pendingAssets)) return;
    this.dirty = false;
    const assets = this.pendingAssets;
    this.setSaveStatus('saving');
    try {
      if (assets) {
        await saveProjectWithAssets(this.project, assets);
        this.pendingAssets = null;
        this.persisted = true;
        if (!persistenceRequested) {
          persistenceRequested = true;
          void requestPersistentStorage();
        }
      } else {
        await saveProject(this.project);
      }
      await this.writeThumbnail();
      this.setSaveStatus(this.dirty ? 'saving' : 'saved');
    } catch (error) {
      this.dirty = true;
      this.setSaveStatus('error', saveErrorMessage(error));
    }
  }

  /** Thumbnails are a convenience: failing to make one never fails the save. */
  private async writeThumbnail(): Promise<void> {
    if (!this.thumbnailDirty) return;
    this.thumbnailDirty = false;
    try {
      const blob = await this.renderThumbnail();
      if (blob) await saveThumbnail(this.project.id, blob);
    } catch (error) {
      console.warn('Thumbnail not saved', error);
    }
  }

  private renderThumbnail(): Promise<Blob | null> {
    const layout = this.layout();
    const crop = this.crop;
    if (!layout || !crop || !this.preview) return Promise.resolve(null);
    const scale = THUMBNAIL_WIDTH / layout.sheetWidth;
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = Math.max(1, Math.round(layout.sheetHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return Promise.resolve(null);
    drawWholeSheet(ctx, layout, crop, this.preview.source, scale);
    return new Promise((resolve) =>
      canvas.toBlob(
        (blob) => {
          releaseCanvas(canvas);
          resolve(blob);
        },
        'image/jpeg',
        0.85,
      ),
    );
  }

  private setSaveStatus(status: SaveStatus, message = ''): void {
    this.saveStatus = status;
    this.saveMessage = message;
    this.emit('save');
  }

  dispose(): void {
    this.scheduleSave.cancel();
    this.listeners.clear();
    this.preview?.release();
    this.image?.release();
    this.preview = null;
    this.image = null;
  }
}

function saveErrorMessage(error: unknown): string {
  return userMessage(
    error,
    'Your changes could not be saved on this device. Saving may be blocked in private browsing. ' +
      'You can still download your artwork sheet.',
  );
}
