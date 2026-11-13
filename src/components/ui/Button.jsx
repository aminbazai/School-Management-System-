import { forwardRef } from 'react';
import clsx from 'clsx';

const VARIANTS = {
  default: 'btn',
  primary: 'btn btn-primary',
  ghost: 'btn btn-ghost',
  danger: 'btn btn-danger',
};

const SIZES = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

export const Button = forwardRef(function Button(
  { variant = 'default', size = 'md', icon: Icon, loading = false, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type || 'button'}
      className={clsx(VARIANTS[variant] || VARIANTS.default, SIZES[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : Icon ? <Icon size={15} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, variant = 'ghost', size = 'sm', ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(VARIANTS[variant] || VARIANTS.default, SIZES[size], 'btn-icon', className)}
      {...rest}
    >
      <Icon size={16} strokeWidth={2.2} />
    </button>
  );
}

export function Spinner({ size = 16, className }) {
  return (
    <svg
      className={clsx('spin shrink-0', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default Button;