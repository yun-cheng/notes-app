import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastAction {
  label: string;
  run: () => void;
}
interface ToastState {
  message: string;
  actions: ToastAction[];
}
/** `actions` puts several buttons after the message, `action` one. */
type ShowToast = (message: string, options?: { action?: ToastAction; actions?: ToastAction[]; sticky?: boolean }) => void;

const ToastContext = createContext<ShowToast>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ShowToast>((message, options) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, actions: [...(options?.action ? [options.action] : []), ...(options?.actions ?? [])] });
    // Longer when there are choices to read.
    if (!options?.sticky) timer.current = setTimeout(() => setToast(null), (options?.actions?.length ?? 0) > 1 ? 10_000 : 7000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-slot" aria-live="polite">
        {toast && (
          <div className="toast">
            <span>{toast.message}</span>
            {toast.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  // Closed first, so an action that says something new shows its own toast.
                  setToast(null);
                  action.run();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
