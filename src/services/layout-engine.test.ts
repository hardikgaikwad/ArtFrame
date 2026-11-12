import { describe, expect, it } from 'vitest';
import { EMPTY_METADATA, type ArtworkMetadata } from '../types/artwork';
import { computeLayout, LAYOUT, SHEET_RATIOS, sheetRatioValue, type MeasureText } from './layout-engine';

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

describe('background shape', () => {
  const sizes: [number, number][] = [
    [4000, 3000], // landscape
    [3000, 4000], // portrait
    [3000, 3000], // square
    [6000, 1000], // very wide
    [1000, 6000], // very tall
  ];

  it.each(SHEET_RATIOS.filter((id) => id !== 'auto'))('gives the sheet a %s shape around any artwork', (id) => {
    const ratio = sheetRatioValue(id)!;
    for (const [w, h] of sizes) {
      const auto = computeLayout(w, h, FULL, measure);
      const layout = computeLayout(w, h, FULL, measure, ratio);
      // Exact shape, to the pixel.
      expect(Math.abs(layout.sheetWidth / layout.sheetHeight - ratio)).toBeLessThan(1 / Math.min(layout.sheetWidth, layout.sheetHeight));
      // Only ever grows: automatic margins are the minimum.
      expect(layout.sheetWidth).toBeGreaterThanOrEqual(auto.sheetWidth);
      expect(layout.sheetHeight).toBeGreaterThanOrEqual(auto.sheetHeight);
      expect(layout.sheetWidth === auto.sheetWidth || layout.sheetHeight === auto.sheetHeight).toBe(true);
      // Artwork unchanged in size, centred left-right.
      expect(layout.artwork.width).toBe(w);
      expect(layout.artwork.height).toBe(h);
      const left = layout.artwork.x;
      const right = layout.sheetWidth - left - w;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      // Visual centre: the artwork-and-details block sits slightly above the middle.
      const top = layout.artwork.y;
      const blockBottom = layout.metadata.y + LAYOUT.fontSize * w * LAYOUT.lineHeight;
      const bottom = layout.sheetHeight - blockBottom;
      expect(top).toBeLessThan(bottom);
      expect(top).toBeGreaterThanOrEqual(auto.artwork.y);
      expect(bottom).toBeGreaterThanOrEqual(auto.sheetHeight - (auto.metadata.y + LAYOUT.fontSize * w * LAYOUT.lineHeight) - 1);
      if (layout.sheetHeight > auto.sheetHeight) {
        // Taller background: block middle at exactly the visual centre of the height
        // (a little lower on portrait backgrounds).
        // The minimum (automatic) top margin wins when the background grows only slightly.
        const centre = ratio < 1 ? LAYOUT.visualCentrePortrait : LAYOUT.visualCentre;
        if (top > auto.artwork.y) {
          expect(Math.abs((top + blockBottom) / 2 - centre * layout.sheetHeight)).toBeLessThanOrEqual(1);
        } else {
          expect((top + blockBottom) / 2).toBeGreaterThan(centre * layout.sheetHeight);
        }
      } else {
        // Wider background: same vertical placement as Automatic.
        expect(top).toBe(auto.artwork.y);
      }
      // Details stay directly under the artwork, exactly as wide.
      expect(layout.metadata.y - (layout.artwork.y + h)).toBe(Math.round(LAYOUT.metadataGap * w));
      expect(layout.metadata.fields[0].x).toBe(left);
      const last = layout.metadata.fields.at(-1)!;
      expect(last.x + last.width).toBeCloseTo(left + w, 6);
    }
  });

  it('leaves the automatic layout unchanged', () => {
    expect(computeLayout(4000, 3000, FULL, measure, sheetRatioValue('auto'))).toEqual(computeLayout(4000, 3000, FULL, measure));
  });
});

describe('visual centre by background orientation', () => {
  it('places the artwork lower on portrait backgrounds than on square or landscape ones', () => {
    // A wide artwork, so every shape below makes the background taller.
    const mid = (id: Parameters<typeof sheetRatioValue>[0]) => {
      const l = computeLayout(4000, 1000, FULL, measure, sheetRatioValue(id));
      return (l.artwork.y + l.metadata.y + LAYOUT.fontSize * 4000 * LAYOUT.lineHeight) / 2 / l.sheetHeight;
    };
    for (const portrait of ['4:5', '3:4', '2:3', '9:16'] as const) expect(mid(portrait)).toBeCloseTo(0.48, 3);
    for (const other of ['1:1', '5:4', '4:3'] as const) expect(mid(other)).toBeCloseTo(0.46, 3);
  });
});

describe('size of artwork', () => {
  const sizes: [number, number][] = [[4000, 3000], [3000, 4000], [3000, 3000], [6000, 1000], [1000, 6000]];
  const shapes = [null, ...SHEET_RATIOS.filter((id) => id !== 'auto').map((id) => sheetRatioValue(id))];

  it('leaves the layout unchanged at 100%', () => {
    for (const ratio of shapes) {
      const base = computeLayout(4000, 3000, FULL, measure, ratio);
      expect(computeLayout(4000, 3000, FULL, measure, ratio, 1)).toEqual(base);
      expect(base.scale.value).toBe(1);
    }
  });

  it('shrinks or grows the background around the unchanged artwork, keeping its shape', () => {
    for (const [w, h] of sizes) {
      for (const ratio of shapes) {
        const base = computeLayout(w, h, FULL, measure, ratio);
        // A tall artwork on an automatic background has little room to grow.
        for (const scale of [0.6, 0.8, 1.1, base.scale.max].filter((s) => s <= base.scale.max)) {
          const layout = computeLayout(w, h, FULL, measure, ratio, scale);
          expect(layout.scale.value).toBe(scale);
          // Artwork drawn 1:1 at whole pixels, centred left to right.
          expect([layout.artwork.width, layout.artwork.height]).toEqual([w, h]);
          expect(Number.isInteger(layout.artwork.x) && Number.isInteger(layout.artwork.y)).toBe(true);
          expect(Math.abs(layout.sheetWidth - 2 * layout.artwork.x - w)).toBeLessThanOrEqual(1);
          // Background divided by the scale.
          expect(Math.abs(layout.sheetWidth - base.sheetWidth / scale)).toBeLessThanOrEqual(1);
          if (ratio) {
            expect(Math.abs(layout.sheetWidth / layout.sheetHeight - ratio)).toBeLessThan(1 / Math.min(layout.sheetWidth, layout.sheetHeight));
          } else {
            expect(Math.abs(layout.sheetHeight - base.sheetHeight / scale)).toBeLessThanOrEqual(1);
          }
          // Always some white on every side, and the details stay under the artwork.
          const minMargin = Math.ceil(LAYOUT.minMargin * w);
          const blockBottom = layout.metadata.y + LAYOUT.fontSize * w * LAYOUT.lineHeight;
          expect(layout.artwork.x).toBeGreaterThanOrEqual(minMargin);
          expect(layout.artwork.y).toBeGreaterThanOrEqual(minMargin);
          expect(layout.sheetHeight - blockBottom).toBeGreaterThanOrEqual(minMargin - 1);
          expect(layout.metadata.y - (layout.artwork.y + h)).toBe(Math.round(LAYOUT.metadataGap * w));
          expect(layout.metadata.fields[0].x).toBe(layout.artwork.x);
        }
      }
    }
  });

  it('keeps the block at the same relative height', () => {
    const ratio = sheetRatioValue('4:5');
    const middle = (scale: number) => {
      const l = computeLayout(4000, 3000, FULL, measure, ratio, scale);
      return (l.artwork.y + l.metadata.y + LAYOUT.fontSize * 4000 * LAYOUT.lineHeight) / 2 / l.sheetHeight;
    };
    expect(middle(0.7)).toBeCloseTo(middle(1), 3);
    expect(middle(1.2)).toBeCloseTo(middle(1), 3);
  });

  it('limits the size to the allowed range', () => {
    const base = computeLayout(4000, 3000, FULL, measure);
    expect(base.scale.min).toBe(LAYOUT.minArtworkScale);
    expect(base.scale.max).toBeGreaterThan(1);
    expect(computeLayout(4000, 3000, FULL, measure, null, 0.1).scale.value).toBe(LAYOUT.minArtworkScale);
    expect(computeLayout(4000, 3000, FULL, measure, null, 5).scale.value).toBe(base.scale.max);
  });
});
