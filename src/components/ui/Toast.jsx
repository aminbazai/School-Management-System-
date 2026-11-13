import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

const TONES = {
  success: { icon: CheckCircle2, color: 'var(--color-ok)' },
  error: { icon: XCircle, color: 'var(--color-danger)' },
  warning: { icon: AlertTriangle, color: 'var(--color-warn)' },
  info: { icon: Info, color: 'var(--color-info)' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      counter.current += 1;
      const id = counter.current;
      const item = { id, tone: 'info', duration: 4000, ...toast };
      setToasts((prev) => [...prev.slice(-4), item]);
      if (item.duration > 0) {
        setTimeout(() => dismiss(id), item.duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'error', title, description, duration: 6000 }),
      warning: (title, description) => push({ tone: 'warning', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-5 end-5 z-[60] flex w-[360px] flex-col gap-2.5">
          {toasts.map((toast) => {
            const tone = TONES[toast.tone] || TONES.info;
            const Icon = tone.icon;
            return (
              <div
                key={toast.id}
                className="panel-solid animate-in pointer-events-auto flex items-start gap-3 p-3.5"
                style={{ borderColor: `color-mix(in srgb, ${tone.color} 45%, transparent)` }}
              >
                <Icon size={17} style={{ color: tone.color }} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[var(--color-ink)]">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-muted)]">{toast.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 text-[var(--color-dim)] transition hover:text-[var(--color-ink)]"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export default ToastProvider;