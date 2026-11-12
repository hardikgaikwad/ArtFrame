import { button, h } from './dom';

/**
 * Small modal dialogs built on <dialog>, so confirmations look consistent and work
 * with touch, keyboard and screen readers on both target browsers.
 */
function openDialog<T>(build: (close: (value: T) => void) => Node[], cancelValue: T): Promise<T> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' });
    let settled = false;
    const close = (value: T) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.append(...build(close));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(cancelValue);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function confirmDialog(
  message: string,
  options: { confirmLabel: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return openDialog<boolean>(
    (close) => [
      h('p', { class: 'dialog-message' }, message),
      h(
        'div',
        { class: 'dialog-actions' },
        button(options.cancelLabel ?? 'Cancel', () => close(false), { class: 'btn' }),
        button(options.confirmLabel, () => close(true), {
          class: options.danger ? 'btn btn-danger' : 'btn btn-primary',
          autofocus: true,
        }),
      ),
    ],
    false,
  );
}

export function promptDialog(message: string, initialValue: string, confirmLabel: string): Promise<string | null> {
  return openDialog<string | null>((close) => {
    const input = h('input', { type: 'text', class: 'input', id: 'dialog-input', maxlength: 200, autocomplete: 'off' });
    input.value = initialValue;
    const form = h(
      'form',
      { method: 'dialog' },
      h('label', { class: 'dialog-message', for: 'dialog-input' }, message),
      input,
      h(
        'div',
        { class: 'dialog-actions' },
        button('Cancel', () => close(null), { class: 'btn' }),
        h('button', { type: 'submit', class: 'btn btn-primary' }, confirmLabel),
      ),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      close(input.value.trim());
    });
    queueMicrotask(() => input.select());
    return [form];
  }, null);
}
