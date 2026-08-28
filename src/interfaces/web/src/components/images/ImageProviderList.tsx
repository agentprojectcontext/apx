import { ChevronDown, ChevronUp, Plus, Settings2, Trash2 } from "lucide-react";
import { Badge, Button, Switch } from "../ui";
import { StatusDot } from "../Section";
import { cn } from "../../lib/cn";
import { IMAGE_PROVIDER_META, type ImageEngineInfo } from "../../lib/api/images";
import { t } from "../../i18n";

// Image engine list — an ordered fallback chain, exactly like the voice one:
// the arrows reorder it, the switch takes an engine out of the chain, and the
// first reachable engine in the order draws. The internal "mock" rung is
// hidden (it is a guarantee that a call always returns a file, not a choice).
// Users can add any number of endpoints, each declaring which dialect it
// speaks — that is what makes one screen cover a local Mac server, a box on
// the LAN and a cloud key.

interface Props {
  engines: ImageEngineInfo[];
  order: string[];
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onReorder: (nextOrder: string[]) => void;
  onConfigure: (id: string) => void;
  onRemove: (id: string) => void;
  onAddNew: () => void;
  busy?: boolean;
}

export function ImageProviderList({
  engines, order, onToggleEnabled, onReorder, onConfigure, onRemove, onAddNew, busy,
}: Props) {
  const visible = engines.filter((e) => e.id !== "mock");
  const byId = new Map(visible.map((e) => [e.id, e]));
  const ids = [
    ...order.filter((id) => byId.has(id)),
    ...visible.map((e) => e.id).filter((id) => !order.includes(id)),
  ];

  const move = (id: string, dir: -1 | 1) => {
    const idx = ids.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    const reordered = [...ids];
    [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
    onReorder(reordered);
  };

  return (
    <div className="space-y-2">
      {ids.map((id, idx) => {
        const e = byId.get(id)!;
        const meta = IMAGE_PROVIDER_META[id];
        const name = e.custom ? e.label || id : meta?.name || id;
        const note = e.custom
          ? e.note || t("images_ui.custom_note")
          : meta?.note || "";
        return (
          <div
            key={id}
            data-testid={`image-provider-${id}`}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 border-border",
              !e.enabled && "opacity-60",
            )}
          >
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(id, -1)}
                disabled={busy || idx === 0}
                aria-label={t("images_ui.move_up")}
                data-testid={`image-provider-${id}-up`}
                className="text-muted-fg hover:text-fg disabled:opacity-30"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(id, 1)}
                disabled={busy || idx === ids.length - 1}
                aria-label={t("images_ui.move_down")}
                data-testid={`image-provider-${id}-down`}
                className="text-muted-fg hover:text-fg disabled:opacity-30"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>

            <StatusDot ok={e.available ? true : e.configured ? false : null} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{name}</span>
                {e.custom && <Badge tone="info">{e.kind || "a1111"}</Badge>}
                {meta?.local && <Badge tone="info">{t("images_ui.badge_local")}</Badge>}
                {e.available ? (
                  <Badge tone="success">{t("images_ui.badge_available")}</Badge>
                ) : e.configured ? (
                  <Badge tone="warning">{t("images_ui.badge_unavailable")}</Badge>
                ) : (
                  <Badge tone="muted">{t("images_ui.badge_not_configured")}</Badge>
                )}
              </div>
              <div className="truncate text-xs text-muted-fg">{note}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Switch checked={e.enabled} onChange={(v) => onToggleEnabled(id, v)} disabled={busy} />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onConfigure(id)}
                data-testid={`image-provider-${id}-config`}
              >
                <Settings2 className="size-3.5" /> {t("images_ui.configure")}
              </Button>
              {e.custom && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(id)}
                  disabled={busy}
                  aria-label={t("images_ui.remove")}
                  data-testid={`image-provider-${id}-remove`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAddNew}
        disabled={busy}
        data-testid="image-provider-add"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-fg transition-colors hover:border-emerald-500/50 hover:text-fg disabled:opacity-50"
      >
        <Plus className="size-4" /> {t("images_ui.add_provider")}
      </button>
    </div>
  );
}
