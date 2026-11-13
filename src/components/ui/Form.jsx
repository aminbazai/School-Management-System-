import { useId, useState } from 'react';
import clsx from 'clsx';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function Shell({ label, error, hint, required, children, htmlFor }) {
  const { t } = useTranslation();
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="text-[var(--color-danger)] ms-1">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="field-error">{t(error)}</span>
      ) : hint ? (
        <span className="text-[11.5px] text-[var(--color-dim)]">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ label, error, hint, required, className, icon: Icon, ...rest }) {
  const id = useId();
  const input = (
    <div className="relative">
      {Icon && (
        <Icon
          size={15}
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--color-dim)]"
        />
      )}
      <input
        id={id}
        className={clsx('input', error && 'input-error', className)}
        style={Icon ? { paddingInlineStart: 38 } : undefined}
        {...rest}
      />
    </div>
  );
  if (!label && !error && !hint) return input;
  return (
    <Shell label={label} error={error} hint={hint} required={required} htmlFor={id}>
      {input}
    </Shell>
  );
}

export function PasswordInput({ label, error, hint, required, ...rest }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();

  return (
    <Shell label={label} error={error} hint={hint} required={required} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={clsx('input pe-11', error && 'input-error')}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          title={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          className="absolute end-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--color-dim)] transition hover:bg-[var(--glass-2)] hover:text-[var(--color-ink)]"
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </Shell>
  );
}

export function Select({ label, error, hint, required, options = [], placeholder, className, children, ...rest }) {
  const id = useId();
  const select = (
    <select id={id} className={clsx('input', error && 'input-error', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
      {children}
    </select>
  );
  if (!label && !error && !hint) return select;
  return (
    <Shell label={label} error={error} hint={hint} required={required} htmlFor={id}>
      {select}
    </Shell>
  );
}

export function Textarea({ label, error, hint, required, rows = 3, className, ...rest }) {
  const id = useId();
  const area = <textarea id={id} rows={rows} className={clsx('input', error && 'input-error', className)} {...rest} />;
  if (!label && !error && !hint) return area;
  return (
    <Shell label={label} error={error} hint={hint} required={required} htmlFor={id}>
      {area}
    </Shell>
  );
}

export function FormGrid({ columns = 2, className, children }) {
  return (
    <div
      className={clsx('grid gap-4', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export default Input;