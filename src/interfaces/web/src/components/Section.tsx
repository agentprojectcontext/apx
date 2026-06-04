import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface SectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Section({ title, description, action, className, children }: SectionProps) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-fg">{description}</p>}
        </div>
        {action}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-fg">
      {children}
    </kbd>
  );
}

export function StatusDot({ ok }: { ok: boolean | null }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        ok === null ? "bg-muted-fg" : ok ? "bg-emerald-500" : "bg-red-500"
      )}
    />
  );
}
