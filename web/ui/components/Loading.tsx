import type { CSSProperties } from 'react';
import { cx } from '../lib/cx';
import './Loading.css';

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx('ui-spinner', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  lines?: number;
  className?: string;
}

export function Skeleton({ width = '100%', height = 12, radius, lines = 1, className }: SkeletonProps) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  if (lines > 1) {
    return (
      <div className={cx('ui-skeleton-group', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className="ui-skeleton"
            style={{ ...style, width: index === lines - 1 ? '62%' : width }}
          />
        ))}
      </div>
    );
  }
  return <span className={cx('ui-skeleton', className)} style={style} aria-hidden="true" />;
}

export interface ProgressProps {
  value?: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  indeterminate?: boolean;
  showValue?: boolean;
  label?: string;
}

export function Progress({
  value = 0,
  tone = 'accent',
  indeterminate = false,
  showValue = false,
  label,
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="ui-progress">
      <div
        className={cx('ui-progress__track', indeterminate && 'is-indeterminate')}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      >
        <span
          className={cx('ui-progress__fill', `ui-progress__fill--${tone}`)}
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
      {showValue && !indeterminate ? (
        <span className="ui-progress__value">{Math.round(clamped)}%</span>
      ) : null}
    </div>
  );
}
