const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 把 Tab 键限制在容器内，并在关闭时把焦点还给触发元素。
 * 只处理「模态」这一种场景，不做通用 focus 管理。
 */
export function trapFocus(container: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;

  const focusables = () =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeyDown);
  // 对话框优先让容器自身获得焦点：读屏会念标题，且不会在打开瞬间画出按钮焦点环。
  const target = container.hasAttribute('tabindex') ? container : (focusables()[0] ?? container);
  target.focus({ preventScroll: true });

  return () => {
    container.removeEventListener('keydown', onKeyDown);
    previous?.focus?.({ preventScroll: true });
  };
}
