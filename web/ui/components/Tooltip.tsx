import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import './Tooltip.css';

export interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  className?: string;
}

/** CSS 驱动的轻提示：不抢焦点、不建 portal，附着在触发元素上。 */
export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  return (
    <span className={cx('ui-tooltip', className)} data-side={side}>
      {children}
      <span role="tooltip" className="ui-tooltip__bubble">
        {content}
      </span>
    </span>
  );
}
