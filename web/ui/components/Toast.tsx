import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import './Toast.css';

export type ToastTone = 'neutral' | 'success' | 'danger' | 'warning';

export interface ToastOptions {
  description?: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastItem {
  id: number;
  message: ReactNode;
  description?: string;
  tone: ToastTone;
}

type PushToast = (message: ReactNode, options?: ToastOptions) => void;

const ToastContext = createContext<PushToast | null>(null);

const ICONS: Record<ToastTone, ReactNode> = {
  neutral: (
    <path d="M8 7.2v3.1M8 4.9v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  ),
  success: (
    <path d="M3.6 8.4 6.4 11 12 4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  danger: (
    <path d="M4.6 11.4 11.4 4.6M11.4 11.4 4.6 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  ),
  warning: (
    <path d="M8 4.6v4M8 10.8v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  ),
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (message, options = {}) => {
      const id = Date.now() + Math.random();
      setItems((current) => [
        ...current.slice(-2),
        { id, message, description: options.description, tone: options.tone ?? 'neutral' },
      ]);
      const timer = window.setTimeout(() => dismiss(id), options.duration ?? 3200);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="ui-toast-region" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={cx('ui-toast', `ui-toast--${item.tone}`)}>
            <span className="ui-toast__icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14">
                {ICONS[item.tone]}
              </svg>
            </span>
            <span className="ui-toast__text">
              <span className="ui-toast__message">{item.message}</span>
              {item.description ? <span className="ui-toast__desc">{item.description}</span> : null}
            </span>
            <button type="button" className="ui-toast__close" aria-label="关闭通知" onClick={() => dismiss(item.id)}>
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): PushToast {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast 必须在 <ToastProvider> 内使用');
  return push;
}
