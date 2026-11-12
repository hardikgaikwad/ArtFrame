type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

/**
 * Minimal element builder. Text is always inserted as text nodes, never as HTML,
 * so artwork metadata can never be interpreted as markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...(children.filter((c) => c !== null && c !== undefined && c !== false) as (Node | string)[]));
  return el;
}

export function button(label: string, onClick: (event: MouseEvent) => void, attrs: Attrs = {}): HTMLButtonElement {
  const el = h('button', { type: 'button', ...attrs }, label);
  el.addEventListener('click', onClick);
  return el;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/** "Today, 7:21 PM", "Yesterday, 9:05 AM", or "12 Nov 2026" for older dates. */
export function friendlyDate(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (timestamp >= startOfToday.getTime()) return `Today, ${time}`;
  if (timestamp >= startOfToday.getTime() - 86_400_000) return `Yesterday, ${time}`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
