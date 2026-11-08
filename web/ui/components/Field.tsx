import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import './Field.css';

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** 标签 / 说明 / 错误三件套：所有表单控件的统一外壳。 */
export function Field({ label, hint, error, htmlFor, required, className, children }: FieldProps) {
  return (
    <div className={cx('ui-field', className)}>
      {label || hint ? (
        <div className="ui-field__head">
          {label ? (
            <label className="ui-field__label" htmlFor={htmlFor}>
              {label}
              {required ? <span className="ui-field__required">*</span> : null}
            </label>
          ) : (
            <span />
          )}
          {hint ? <span className="ui-field__hint">{hint}</span> : null}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="ui-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leading?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ leading, trailing, invalid = false, className, ref, ...rest }: InputProps) {
  return (
    <span className={cx('ui-input-wrap', invalid && 'is-invalid', className)}>
      {leading ? <span className="ui-input-wrap__affix">{leading}</span> : null}
      <input {...rest} ref={ref} className="ui-input" aria-invalid={invalid || undefined} />
      {trailing ? <span className="ui-input-wrap__affix">{trailing}</span> : null}
    </span>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid = false, className, rows = 3, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      className={cx('ui-textarea', invalid && 'is-invalid', className)}
      aria-invalid={invalid || undefined}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  invalid?: boolean;
}

export function Select({ options, invalid = false, className, ...rest }: SelectProps) {
  return (
    <span className={cx('ui-select-wrap', invalid && 'is-invalid', className)}>
      <select {...rest} className="ui-select" aria-invalid={invalid || undefined}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg className="ui-select__chevron" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
