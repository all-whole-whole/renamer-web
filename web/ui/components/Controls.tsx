import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import './Controls.css';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: string;
}

/** 基于原生 checkbox：键盘、表单、label 点击全部免费。 */
export function Switch({ checked, onChange, label, description, disabled, className, ...rest }: SwitchProps) {
  return (
    <label className={cx('ui-switch', disabled && 'is-disabled', className)}>
      <input
        {...rest}
        type="checkbox"
        role="switch"
        className="ui-switch__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
      {label ? (
        <span className="ui-switch__text">
          <span className="ui-switch__label">{label}</span>
          {description ? <span className="ui-switch__desc">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
}

export function Checkbox({ checked, onChange, label, disabled, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx('ui-check', disabled && 'is-disabled', className)}>
      <input
        {...rest}
        type="checkbox"
        className="ui-check__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-check__box" aria-hidden="true">
        <svg viewBox="0 0 12 12">
          <path d="M2.4 6.3 4.9 8.7 9.6 3.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {label ? <span className="ui-check__label">{label}</span> : null}
    </label>
  );
}
