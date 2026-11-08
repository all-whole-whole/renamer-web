import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import './Card.css';

export interface CardProps {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
  className?: string;
}

export function Card({
  children,
  title,
  description,
  actions,
  footer,
  padding = 'md',
  interactive = false,
  className,
}: CardProps) {
  return (
    <section
      className={cx('ui-card', `ui-card--pad-${padding}`, interactive && 'is-interactive', className)}
    >
      {title || description || actions ? (
        <header className="ui-card__head">
          <div className="ui-card__heading">
            {title ? <h3 className="ui-card__title">{title}</h3> : null}
            {description ? <p className="ui-card__desc">{description}</p> : null}
          </div>
          {actions ? <div className="ui-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
      {footer ? <footer className="ui-card__footer">{footer}</footer> : null}
    </section>
  );
}
