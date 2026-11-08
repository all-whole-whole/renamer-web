import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';
import { trapFocus } from '../lib/focus';
import { IconButton } from './Button';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** 模态框：Esc 关闭、点遮罩关闭、Tab 循环、关闭后焦点归位。 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: DialogProps) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted || !open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const release = trapFocus(panel);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      release();
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted, open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cx('ui-dialog-backdrop', !open && 'is-closing')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cx('ui-dialog', `ui-dialog--${size}`, className)}
      >
        <header className="ui-dialog__head">
          <div className="ui-dialog__heading">
            <h2 className="ui-dialog__title" id={`${id}-title`}>
              {title}
            </h2>
            {description ? (
              <p className="ui-dialog__desc" id={`${id}-desc`}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="关闭" size="sm" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </IconButton>
        </header>
        {children ? <div className="ui-dialog__body">{children}</div> : null}
        {footer ? <footer className="ui-dialog__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
