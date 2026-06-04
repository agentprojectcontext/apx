// Shared UI primitives. These are thin adapters over the shadcn/base-ui
// components in ./ui/* — they keep a small, stable API (variant/tone/size,
// Dialog open/onClose, Field label/hint) so call sites don't churn, while the
// actual rendering comes from base-ui (proper focus, portaling, a11y).
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { Button as SButton } from "./ui/button";
import { Input as SInput } from "./ui/input";
import { Textarea as STextarea } from "./ui/textarea";
import { Badge as SBadge } from "./ui/badge";
import { Switch as SSwitch } from "./ui/switch";
import { Spinner as SSpinner } from "./ui/spinner";
import { Dialog as DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

// ── Button ──────────────────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

const V_MAP = { primary: "default", secondary: "outline", ghost: "ghost", destructive: "destructive" } as const;
const S_MAP = { sm: "sm", md: "default" } as const;

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <SButton
      type={type}
      variant={V_MAP[variant]}
      size={S_MAP[size]}
      disabled={disabled || loading}
      className={className}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : null}
      {children}
    </SButton>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <SInput {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <STextarea {...props} />;
}

// Native select kept for legacy call sites; new code uses UiSelect (base-ui).
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        props.className,
      )}
    />
  );
}

// ── Field wrapper ───────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  badge,
  children,
}: {
  label: string;
  hint?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {badge && (
          <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{badge}</span>
        )}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

// ── Switch ────────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("inline-flex items-center gap-2", disabled && "opacity-50")}>
      <SSwitch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────

type Tone = "muted" | "success" | "warning" | "danger" | "info";

export function Badge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  // muted/danger use built-in variants; the colored tones use outline + color.
  const variant = tone === "danger" ? "destructive" : tone === "muted" ? "secondary" : "outline";
  const toneClass: Record<Tone, string> = {
    muted: "",
    danger: "",
    success: "text-emerald-400 border-emerald-500/30",
    warning: "text-amber-400 border-amber-500/30",
    info: "text-sky-400 border-sky-500/30",
  };
  return (
    <SBadge variant={variant} className={cn("rounded-md", toneClass[tone], className)}>
      {children}
    </SBadge>
  );
}

// ── Dialog (base-ui) ──────────────────────────────────────────────────────────
// Uses the base-ui dialog → proper focus trap + portaling (nested Select/Combobox
// popups render correctly). Fixed header/footer, scrollable content.

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizes = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };
  return (
    <DialogRoot open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className={cn("flex max-h-[88vh] w-full flex-col gap-0 p-0", sizes[size])}
      >
        {(title || description) && (
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

// ── Spinner ─────────────────────────────────────────────────────────────────

export function Spinner({ size = 14 }: { size?: number }) {
  return <SSpinner style={{ width: size, height: size }} />;
}

// ── Empty / Loading helpers ─────────────────────────────────────────────────

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner /> {label}
    </div>
  );
}
