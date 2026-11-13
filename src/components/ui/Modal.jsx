import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { IconButton, Spinner } from './Button';

export function Modal({ open, onClose, title, subtitle, size = 'md', footer, children, closeOnBackdrop = true }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'panel-solid animate-in relative w-full overflow-hidden',
          widths[size] || widths.md,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>

        <div className="max-h-[70vh] overflow-auto px-5 py-5">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--glass)] px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Spinner size={14} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-[var(--color-ink2)]">{message}</p>
    </Modal>
  );
}

export default Modal;