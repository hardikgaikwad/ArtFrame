import { button, h } from '../utils/dom';

/**
 * The Back / Next bar at the bottom of every step, always in the same place: Back on the
 * left, the step's main action on the right. On phones it stays on screen while scrolling.
 */
export function stepFooter(onBack: (() => void) | null, primary: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'step-footer' },
    onBack ? button('Back', onBack, { class: 'btn step-back' }) : h('span'),
    primary,
  );
}
