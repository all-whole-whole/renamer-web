import { cx } from '../lib/cx';
import './Avatar.css';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'neutral' | 'accent';
  className?: string;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed.slice(-1);
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export function Avatar({ name, src, size = 'md', tone = 'neutral', className }: AvatarProps) {
  return (
    <span
      className={cx('ui-avatar', `ui-avatar--${size}`, `ui-avatar--${tone}`, className)}
      title={name}
      aria-label={name}
      role="img"
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}
