// Minimal toast system: a context provider + portal-free fixed container.
// Exposes a `toast()` helper that any component can use without prop-drilling.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { cn } from "../lib/cn";

type ToastKind = "success" | "error" | "info";

/**
 * An optional verb on the toast. It exists so a reversible action can drop its
 * confirm dialog: ticking a task off is one click and the undo lives here for
 * the four seconds you might want it, instead of a modal standing between you
 * and every single completion.
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastCtx {
  show: (kind: ToastKind, message: string, action?: ToastAction) => void;
  success: (message: string, action?: ToastAction) => void;
  error:   (message: string, action?: ToastAction) => void;
  info:    (message: string, action?: ToastAction) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((kind: ToastKind, message: string, action?: ToastAction) => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, kind, message, action }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const api = useMemo<ToastCtx>(() => ({
    show,
    success: (m, a) => show("success", m, a),
    error:   (m, a) => show("error", m, a),
    info:    (m, a) => show("info", m, a),
  }), [show]);

  // Expose globally so even non-React code (api error handlers) can fire.
  useEffect(() => {
    (window as any).__apxToast = api;
    return () => { delete (window as any).__apxToast; };
  }, [api]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Bottom-right on the panel, where it has always been. TOP on a phone:
          down there is the tab bar, and in a chat the send button, so a toast
          confirming what you just tapped landed exactly on the control you
          tapped it with — "• Hecha" sitting over the tabs. A toast must never
          cover the thing that raised it. */}
      <div
        className={cn(
          "pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2",
          "max-sm:bottom-auto max-sm:left-4 max-sm:w-auto max-sm:top-[max(0.75rem,env(safe-area-inset-top))]",
        )}
        data-testid="toast-stack"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto overflow-hidden rounded-lg border bg-card px-3 py-2 text-sm shadow-lg",
              t.kind === "success" && "border-emerald-500/40",
              t.kind === "error"   && "border-destructive/60",
              t.kind === "info"    && "border-border"
            )}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1 size-2 shrink-0 rounded-full",
                  t.kind === "success" && "bg-emerald-500",
                  t.kind === "error"   && "bg-destructive",
                  t.kind === "info"    && "bg-sky-500"
                )}
              />
              <span className="flex-1 break-words">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  data-testid="toast-action"
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  onClick={() => { dismiss(t.id); t.action?.onClick(); }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
