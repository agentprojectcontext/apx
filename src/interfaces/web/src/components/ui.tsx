// Shared UI primitives. These are thin adapters over the shadcn/base-ui
// components in ./ui/* — they keep a small, stable API (variant/tone/size,
// Dialog open/onClose, Field label/hint) so call sites don't churn, while the
// actual rendering comes from base-ui (proper focus, portaling, a11y).
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { t } from "../i18n";
import { Logo } from "./layout/Logo";
import { Button as SButton } from "./ui/button";
import { Input as SInput } from "./ui/input";
import { Textarea as STextarea } from "./ui/textarea";
import { Badge as SBadge } from "./ui/badge";
import { Switch as SSwitch } from "./ui/switch";
import { Spinner as SSpinner } from "./ui/spinner";
import { Dialog as DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

// Re-export the tooltip convenience wrapper so call sites can grab it from the
// same barrel as Button/Field/etc.: `import { Button, Tip } from "../ui"`.
export { Tip } from "./ui/tip";
export { FilterChips } from "./ui/filter-chips";

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
  // Do not wrap controls in <label>: complex fields (contentEditable +
  // buttons/popovers) can redirect clicks to the wrong nested control.
  return (
    <div className="block space-y-1">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {badge && (
          <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{badge}</span>
        )}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
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
  // Light ink matches lib/tone's chip scale (800, not 700): these badges land
  // on muted rows as often as on a card, and 700 only clears 4.5:1 against
  // white. See lib/tone.ts for the shared pairs.
  const toneClass: Record<Tone, string> = {
    muted: "",
    danger: "",
    success: "text-emerald-800 dark:text-emerald-400 border-emerald-500/30",
    warning: "text-amber-800 dark:text-amber-400 border-amber-500/30",
    info: "text-sky-800 dark:text-sky-400 border-sky-500/30",
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

/**
 * The house empty state: one centred illustration, the line that says what is
 * missing, and optionally the button that fixes it. Every empty pane in the
 * app goes through here, so they all read the same way.
 *
 * `icon` is the screen's own lucide glyph; without one the APX mark stands in.
 * `fill` is for the empty half of a master-detail (or any pane with a height):
 * it takes the whole pane and centres in it, instead of leaving a short dashed
 * card pinned to the top edge with dead space under it. Inline (no `fill`) it
 * is a card sized for the gap where the list would have been.
 */
export function Empty({
  children,
  icon: Icon,
  action,
  fill,
  className,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  /** The one button that resolves the state — create the first item, retry. */
  action?: ReactNode;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-center",
        fill
          ? "h-full min-h-[200px] p-8"
          : "rounded-lg border border-dashed border-border bg-muted/20 px-6 py-8",
        className
      )}
    >
      <div
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-muted/70 ring-1 ring-border/60",
          fill ? "size-24" : "size-14"
        )}
      >
        {Icon
          ? <Icon size={fill ? 42 : 24} strokeWidth={1.5} className="text-muted-fg" />
          : <Logo size={fill ? 44 : 26} />}
      </div>
      <div className="max-w-[46ch] text-balance text-sm leading-relaxed text-muted-foreground">{children}</div>
      {action}
    </div>
  );
}

// The label is i18n by default: most call sites just want "loading", and a
// hardcoded default here rendered Spanish inside the English UI.
export function Loading({ label }: { label?: string }) {
  const text = label ?? t("common.loading");
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner /> {text}
    </div>
  );
}
