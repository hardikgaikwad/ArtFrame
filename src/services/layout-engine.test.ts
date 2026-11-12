import { describe, expect, it } from 'vitest';
import { EMPTY_METADATA, type ArtworkMetadata } from '../types/artwork';
import { computeLayout, LAYOUT, type MeasureText } from './layout-engine';

// Deterministic stand-in for canvas measureText: every character is 0.5 em wide.
const measure: MeasureText = (text, fontSize) => text.length * fontSize * 0.5;

const FULL: ArtworkMetadata = { edition: '1/10', medium: 'Drypoint', size: '25×15cm', title: 'Untitled', year: '2017' };

function meta(partial: Partial<ArtworkMetadata>): ArtworkMetadata {
  return { ...EMPTY_METADATA, ...partial };
}

describe('sheet geometry', () => {
  it('follows the proportional defaults', () => {
    const layout = computeLayout(4000, 3000, FULL, measure);
    expect(layout.sheetWidth).toBe(6000);
    expect(layout.artwork).toEqual({ x: 1000, y: 640, width: 4000, height: 3000 });
    expect(layout.metadata.y).toBe(640 + 3000 + 80);
    expect(layout.sheetHeight).toBe(Math.round(3720 + 140 * LAYOUT.lineHeight + 1000));
  });

  it('centres the artwork with equal side margins at any size', () => {
    for (const [w, h] of [[1000, 1000], [1333, 777], [3001, 9999], [9000, 1200], [17, 31]]) {
      const layout = computeLayout(w, h, FULL, measure);
      expect(layout.artwork.width).toBe(w);
      expect(layout.artwork.height).toBe(h);
      expect(layout.sheetWidth - layout.artwork.x - layout.artwork.width).toBe(layout.artwork.x);
      expect(Number.isInteger(layout.artwork.x) && Number.isInteger(layout.artwork.y)).toBe(true);
      // Margins round to whole pixels, so tiny images deviate slightly.
      if (w >= 100) expect(layout.artwork.width / layout.sheetWidth).toBeCloseTo(2 / 3, 2);
    }
  });

  it('does not change sheet size when metadata changes', () => {
    const a = computeLayout(2000, 1500, FULL, measure);
    const b = computeLayout(2000, 1500, EMPTY_METADATA, measure);
    expect([a.sheetWidth, a.sheetHeight]).toEqual([b.sheetWidth, b.sheetHeight]);
  });
});

describe('metadata justification', () => {
  const W = 4000;
  const left = 1000;
  const right = left + W;

  function fieldsFor(m: ArtworkMetadata) {
    return computeLayout(W, 3000, m, measure).metadata;
  }

  it('spans exactly the artwork width with equal gaps when all fields are set', () => {
    const { fields, overflow } = fieldsFor(FULL);
    expect(overflow).toBe(false);
    expect(fields.map((f) => f.text)).toEqual(['1/10', 'Drypoint', '25×15cm', 'Untitled', '2017']);
    expect(fields[0].x).toBe(left);
    expect(fields[4].x + fields[4].width).toBeCloseTo(right, 6);
    const gaps = fields.slice(1).map((f, i) => f.x - (fields[i].x + fields[i].width));
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
  });

  it.each([
    ['edition', ['Drypoint', '25×15cm', 'Untitled', '2017']],
    ['medium', ['1/10', '25×15cm', 'Untitled', '2017']],
    ['size', ['1/10', 'Drypoint', 'Untitled', '2017']],
    ['title', ['1/10', 'Drypoint', '25×15cm', '2017']],
    ['year', ['1/10', 'Drypoint', '25×15cm', 'Untitled']],
  ] as const)('removes an empty %s completely and re-justifies', (empty, expected) => {
    const { fields } = fieldsFor({ ...FULL, [empty]: '' });
    expect(fields.map((f) => f.text)).toEqual(expected);
    expect(fields[0].x).toBe(left);
    expect(fields.at(-1)!.x + fields.at(-1)!.width).toBeCloseTo(right, 6);
  });

  it('puts two fields at the far edges', () => {
    const { fields } = fieldsFor(meta({ medium: 'Drypoint', year: '2017' }));
    expect(fields[0].x).toBe(left);
    expect(fields[1].x + fields[1].width).toBeCloseTo(right, 6);
  });

  it('left-aligns a single field', () => {
    const { fields } = fieldsFor(meta({ year: '2017' }));
    expect(fields).toHaveLength(1);
    expect(fields[0].x).toBe(left);
  });

  it('draws nothing when every field is empty or whitespace', () => {
    expect(fieldsFor(EMPTY_METADATA).fields).toEqual([]);
    expect(fieldsFor(meta({ title: '   ', year: '\t' })).fields).toEqual([]);
  });

  it('shows edition values exactly as typed, never with a label', () => {
    for (const edition of ['1/10', 'A/P', 'H/C', 'Monoprint', '2/15']) {
      const { fields } = fieldsFor(meta({ edition, year: '2017' }));
      expect(fields[0].text).toBe(edition);
      expect(fields.some((f) => /edition/i.test(f.text))).toBe(false);
    }
  });

  it('keeps special characters', () => {
    const { fields } = fieldsFor(meta({ title: 'Él & <ñ> "quote" 日本', size: '25×15 cm' }));
    expect(fields.map((f) => f.text)).toEqual(['25×15 cm', 'Él & <ñ> "quote" 日本']);
  });

  it('shrinks the font proportionally when the line is too long, and still fits exactly', () => {
    const long = { ...FULL, title: 'A rather long title that needs a smaller font to fit' };
    const { fields, fontSize, overflow } = fieldsFor(long);
    expect(overflow).toBe(false);
    expect(fontSize).toBeLessThan(LAYOUT.fontSize * W);
    expect(fontSize).toBeGreaterThanOrEqual(LAYOUT.minFontSize * W);
    expect(fields[0].x).toBe(left);
    expect(fields.at(-1)!.x + fields.at(-1)!.width).toBeCloseTo(right, 6);
    for (let i = 1; i < fields.length; i++) {
      expect(fields[i].x - (fields[i - 1].x + fields[i - 1].width)).toBeGreaterThanOrEqual(fontSize * LAYOUT.minFieldSpacing - 1e-6);
    }
  });

  it('flags overflow instead of clipping or overlapping when even the minimum font is too big', () => {
    const { fields, fontSize, overflow } = fieldsFor({ ...FULL, title: 'x'.repeat(400) });
    expect(overflow).toBe(true);
    expect(fontSize).toBe(LAYOUT.minFontSize * W);
    expect(fields.map((f) => f.text)).toContain('x'.repeat(400));
    for (let i = 1; i < fields.length; i++) {
      expect(fields[i].x).toBeGreaterThan(fields[i - 1].x + fields[i - 1].width);
    }
  });
});
