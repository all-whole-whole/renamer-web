import { useId, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import './Tabs.css';

export interface TabItem {
  value: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  children?: ReactNode;
  className?: string;
}

export function Tabs({ tabs, value, onChange, children, className }: TabsProps) {
  const id = useId();
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.value === value));

  const step = (delta: number) => {
    const next = (activeIndex + delta + tabs.length) % tabs.length;
    onChange(tabs[next]!.value);
  };

  return (
    <div className={cx('ui-tabs', className)}>
      <div className="ui-tabs__list" role="tablist">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.value}`}
              aria-selected={active}
              aria-controls={`${id}-panel`}
              tabIndex={active ? 0 : -1}
              className={cx('ui-tabs__tab', active && 'is-active')}
              onClick={() => onChange(tab.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  step(1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  step(-1);
                }
              }}
            >
              {tab.icon}
              {tab.label}
              {typeof tab.count === 'number' ? <span className="ui-tabs__count">{tab.count}</span> : null}
            </button>
          );
        })}
      </div>
      {children ? (
        <div className="ui-tabs__panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
