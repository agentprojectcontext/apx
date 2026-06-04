// Minimal toast system: a context provider + portal-free fixed container.
// Exposes a `toast()` helper that any component can use without prop-drilling.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { cn } from "../lib/cn";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastCtx {
  show: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error:   (message: string) => void;
  info:    (message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const api = useMemo<ToastCtx>(() => ({
    show,
    success: (m) => show("success", m),
    error:   (m) => show("error", m),
    info:    (m) => show("info", m),
  }), [show]);

  // Expose globally so even non-React code (api error handlers) can fire.
  useEffect(() => {
    (window as any).__apxToast = api;
    return () => { delete (window as any).__apxToast; };
  }, [api]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
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
