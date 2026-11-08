import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import './Kbd.css';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('ui-kbd', className)}>{children}</kbd>;
}
