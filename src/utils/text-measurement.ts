import { LAYOUT, type MeasureText } from '../services/layout-engine';

export function fontString(fontSize: number): string {
  return `${fontSize}px ${LAYOUT.fontFamily}`;
}

let measureContext: CanvasRenderingContext2D | null = null;

/**
 * Measures on a 1×1 canvas: text metrics do not depend on canvas size, so the
 * export-size font is measured without allocating an export-size canvas.
 */
export const measureText: MeasureText = (text, fontSize) => {
  if (!measureContext) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    measureContext = ctx;
  }
  measureContext.font = fontString(fontSize);
  return measureContext.measureText(text).width;
};
