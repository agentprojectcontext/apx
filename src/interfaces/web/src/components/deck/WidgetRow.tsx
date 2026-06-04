import { useState } from "react";
import { Badge, Switch } from "../ui";
import { cn } from "../../lib/cn";
import type { DeckWidget } from "../../lib/api/deck";

// Status badge tone mapping.
function statusTone(s: DeckWidget["status"]): "success" | "muted" | "warning" | "info" {
  if (s === "available") return "success";
  if (s === "configured") return "info";
  if (s === "disabled") return "muted";
  return "muted"; // not_configured
}

function statusLabel(s: DeckWidget["status"]): string {
  if (s === "available") return "activo";
  if (s === "configured") return "configurado";
  if (s === "disabled") return "deshabilitado";
  return "sin configurar";
}

// Kind badge tone.
function kindTone(k: string): "info" | "warning" | "muted" {
  if (k === "voice") return "warning";
  if (k === "plugin") return "info";
  return "muted";
}

interface WidgetRowProps {
  widget: DeckWidget;
  /** Called with the new desired enabled value. Only provided for external widgets. */
  onToggle?: (enabled: boolean) => Promise<void>;
}

export function WidgetRow({ widget, onToggle }: WidgetRowProps) {
  const isExternal = widget.source === "external";
  const [busy, setBusy] = useState(false);

  // Derive current switch state:
  //   user_enabled null → off (not yet opted in)
  //   user_enabled true → on
  //   user_enabled false → off
  const switchChecked = widget.user_enabled === true;

  const handleToggle = async (v: boolean) => {
    if (!onToggle || busy) return;
    setBusy(true);
    try {
      await onToggle(v);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      data-testid={`deck-widget-${widget.id}`}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
        isExternal
          ? "border-border bg-muted/20 hover:border-muted-fg/30"
          : "border-border/50 bg-muted/10"
      )}
    >
      {/* Source dot */}
      <span
        title={widget.source === "apx" ? "Widget nativo APX" : "Widget externo"}
        className={cn(
          "size-2 shrink-0 rounded-full",
          widget.source === "apx" ? "bg-emerald-500" : "bg-sky-400"
        )}
      />

      {/* Title + desktop */}
      <div className="min-w-0 flex-1">
        <span className="font-medium">{widget.title}</span>
        <span className="ml-2 text-xs text-muted-fg">{widget.desktop}</span>
      </div>

      {/* Kind badge */}
      <Badge tone={kindTone(widget.kind)}>{widget.kind}</Badge>

      {/* Status badge */}
      <Badge tone={statusTone(widget.status)}>{statusLabel(widget.status)}</Badge>

      {/* Toggle — only external widgets */}
      {isExternal ? (
        <span data-testid={`deck-widget-toggle-${widget.id}`}>
          <Switch
            checked={switchChecked}
            onChange={handleToggle}
            disabled={busy || !onToggle}
          />
        </span>
      ) : (
        /* Spacer to keep alignment consistent */
        <span className="w-9 shrink-0" aria-hidden />
      )}
    </li>
  );
}
