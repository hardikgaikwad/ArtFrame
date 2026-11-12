import { describe, expect, it } from 'vitest';
import { EMPTY_METADATA } from '../types/artwork';
import { artworkFilename } from './filename-generator';

describe('artworkFilename', () => {
  it('builds year_title_medium', () => {
    expect(
      artworkFilename({ edition: '1/10', medium: 'Drypoint', size: '25×15cm', title: 'Untitled', year: '2017' }, 'png'),
    ).toBe('2017_Untitled_Drypoint.png');
  });

  it('omits empty fields', () => {
    expect(artworkFilename({ ...EMPTY_METADATA, title: 'Untitled' }, 'jpg')).toBe('Untitled.jpg');
    expect(artworkFilename({ ...EMPTY_METADATA, year: '2017', medium: 'Oil' }, 'pdf')).toBe('2017_Oil.pdf');
  });

  it('falls back to a generic name', () => {
    expect(artworkFilename(EMPTY_METADATA, 'jpeg')).toBe('ArtFrame_artwork.jpeg');
    expect(artworkFilename({ ...EMPTY_METADATA, title: '???' }, 'png')).toBe('ArtFrame_artwork.png');
  });

  it('removes characters that are invalid in filenames', () => {
    expect(artworkFilename({ ...EMPTY_METADATA, title: 'A/B: "C"*<D>|?\\E', year: '2017' }, 'png')).toBe(
      '2017_A_B_C_D_E.png',
    );
    expect(artworkFilename({ ...EMPTY_METADATA, title: '  ..Hidden.. ' }, 'png')).toBe('Hidden.png');
  });

  it('keeps accented and non-Latin letters', () => {
    expect(artworkFilename({ ...EMPTY_METADATA, title: 'Été à Paris', medium: '木版画' }, 'png')).toBe(
      'Été_à_Paris_木版画.png',
    );
  });

  it('limits very long names', () => {
    const name = artworkFilename({ ...EMPTY_METADATA, title: 'x'.repeat(500) }, 'png');
    expect(name.length).toBeLessThanOrEqual(124);
    expect(name.endsWith('.png')).toBe(true);
  });
});
