import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastAction {
  label: string;
  run: () => void;
}
interface ToastState {
  message: string;
  action?: ToastAction;
}
type ShowToast = (message: string, options?: { action?: ToastAction; sticky?: boolean }) => void;

const ToastContext = createContext<ShowToast>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ShowToast>((message, options) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, action: options?.action });
    if (!options?.sticky) timer.current = setTimeout(() => setToast(null), 7000);
  }, []);

  // Cmd/Ctrl+Z, outside text boxes (which have their own undo), takes the toast's Undo.
  const latest = useRef(toast);
  latest.current = toast;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = latest.current?.action;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z' || action?.label !== 'Undo' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      action.run();
      setToast(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-slot" aria-live="polite">
        {toast && (
          <div className="toast">
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
