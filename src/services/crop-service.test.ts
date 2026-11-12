import { describe, expect, it } from 'vitest';
import { ASPECT_RATIOS } from '../types/artwork';
import { aspectRatioValue, defaultCrop, normalizeCrop } from './crop-service';

const IMAGES: [number, number][] = [
  [4032, 3024], // landscape photo
  [3024, 4032], // portrait photo
  [3000, 3000], // square
  [8000, 1000], // very wide
  [1000, 8000], // very tall
  [1, 1],
];

describe('defaultCrop', () => {
  it.each(IMAGES)('stays inside a %i×%i image for every ratio', (w, h) => {
    for (const id of ASPECT_RATIOS) {
      const crop = defaultCrop(id, w, h);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(w);
      expect(crop.y + crop.height).toBeLessThanOrEqual(h);
      expect(crop.width).toBeGreaterThan(0);
      expect(crop.height).toBeGreaterThan(0);
    }
  });

  it('uses the whole image for Original and Free', () => {
    expect(defaultCrop('original', 4032, 3024)).toEqual({ x: 0, y: 0, width: 4032, height: 3024 });
    expect(defaultCrop('free', 4032, 3024)).toEqual({ x: 0, y: 0, width: 4032, height: 3024 });
  });

  it.each(['16:9', '9:16', '3:4', '4:3', '5:4', '4:5'] as const)('makes the largest centred %s crop', (id) => {
    const [rw, rh] = id.split(':').map(Number);
    for (const [w, h] of IMAGES.slice(0, 5)) {
      const crop = defaultCrop(id, w, h);
      expect(crop.width / crop.height).toBeCloseTo(rw / rh, 2);
      // Touches both edges of one axis (largest possible), centred on the other.
      expect(crop.width === w || crop.height === h).toBe(true);
      expect(Math.abs(crop.x - (w - crop.x - crop.width))).toBeLessThanOrEqual(1);
      expect(Math.abs(crop.y - (h - crop.y - crop.height))).toBeLessThanOrEqual(1);
    }
  });
});

describe('aspectRatioValue', () => {
  it('reads the original image ratio and leaves Free unconstrained', () => {
    expect(aspectRatioValue('original', 3000, 2000)).toBe(1.5);
    expect(aspectRatioValue('free', 3000, 2000)).toBeNaN();
    expect(aspectRatioValue('9:16', 1, 1)).toBeCloseTo(0.5625);
  });
});

describe('normalizeCrop', () => {
  it('rounds and clamps to the image', () => {
    expect(normalizeCrop({ x: -3.2, y: 10.6, width: 5000.4, height: 200.2 }, 4000, 3000)).toEqual({
      x: 0,
      y: 11,
      width: 4000,
      height: 200,
    });
  });

  it('rejects an empty crop', () => {
    expect(normalizeCrop({ x: 0, y: 0, width: 0, height: 0 }, 4000, 3000)).toBeNull();
  });
});
