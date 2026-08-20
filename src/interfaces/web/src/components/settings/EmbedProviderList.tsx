import type { FocusEvent } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Switch } from "../ui";
import { StatusDot } from "../Section";
import { cn } from "../../lib/cn";
import type { EmbedEngineInfo } from "../../lib/api/embeddings";
import { t } from "../../i18n";

// Embeddings engine list — an ordered fallback chain (router), the mirror of the
// Voice (TTS) provider list. Arrows reorder the chain, the switch enables/disables
// an engine, and each row picks that provider's EMBEDDING model right here — the
// API key of a built-in comes from Engines & models, so there is nothing to
// re-declare. Users can also ADD any number of custom OpenAI-compatible endpoints
// (a local Zen / LiteLLM / llama.cpp server); those carry their own base_url +
// key + model and can be removed. `tf` (the offline fallback) is pinned last and
// always on. Data from the daemon (/embeddings/providers).

export interface CustomBlock {
  label?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
}

const META: Record<string, { name: string; modelPlaceholder?: string; note: string; local?: boolean }> = {
  ollama: { name: "Ollama", modelPlaceholder: "nomic-embed-text", note: "local · key-free", local: true },
  gemini: { name: "Gemini", modelPlaceholder: "text-embedding-004", note: "key from Engines & models" },
  openai: { name: "OpenAI", modelPlaceholder: "text-embedding-3-small", note: "key from Engines & models" },
  tf: { name: "Offline (tf)", note: "bag-of-words · low quality", local: true },
};

const isMarker = (v: string) => v.startsWith("***");

interface Props {
  engines: EmbedEngineInfo[];
  order: string[]; // effective chain order from the daemon (tf last)
  models: Record<string, string>; // current embedding model per built-in provider id
  customConfigs: Record<string, CustomBlock>; // per custom:<slug> id → its config block
  busy?: boolean;
  onReorder: (nextOrder: string[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onSetModel: (id: string, model: string) => void;
  onSetCustomField: (id: string, field: keyof CustomBlock, value: string) => void;
  onRemoveCustom: (id: string) => void;
  onAddCustom: () => void;
}

export function EmbedProviderList({
  engines,
  order,
  models,
  customConfigs,
  busy,
  onReorder,
  onToggleEnabled,
  onSetModel,
  onSetCustomField,
  onRemoveCustom,
  onAddCustom,
}: Props) {
  const byId = new Map(engines.map((e) => [e.id, e]));
  // Reorderable engines only — tf is pinned last and shown separately.
  const ids = [
    ...order.filter((id) => byId.has(id) && id !== "tf"),
    ...engines.map((e) => e.id).filter((id) => id !== "tf" && !order.includes(id)),
  ];
  const tf = byId.get("tf");

  const move = (id: string, dir: -1 | 1) => {
    const idx = ids.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    const reordered = [...ids];
    [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
    onReorder(reordered);
  };

  const arrows = (id: string, idx: number | null, pinned: boolean) => (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => idx !== null && move(id, -1)}
        disabled={busy || pinned || idx === 0}
        aria-label={t("memory_panel.move_up")}
        data-testid={`embed-provider-${id}-up`}
        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => idx !== null && move(id, 1)}
        disabled={busy || pinned || idx === ids.length - 1}
        aria-label={t("memory_panel.move_down")}
        data-testid={`embed-provider-${id}-down`}
        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <ChevronDown className="size-3.5" />
      </button>
    </div>
  );

  const availabilityBadge = (e: EmbedEngineInfo) =>
    e.available ? (
      <Badge tone="success">{t("memory_panel.available")}</Badge>
    ) : e.configured ? (
      <Badge tone="warning">{t("memory_panel.unavailable")}</Badge>
    ) : (
      <Badge tone="muted">{t("memory_panel.not_configured")}</Badge>
    );

  const builtinRow = (id: string, idx: number) => {
    const e = byId.get(id)!;
    const meta = META[id] || { name: id, note: "" };
    return (
      <div
        key={id}
        data-testid={`embed-provider-${id}`}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border px-3 py-2.5",
          !e.enabled && "opacity-60",
        )}
      >
        {arrows(id, idx, false)}
        <StatusDot ok={e.available ? true : e.configured ? false : null} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{meta.name}</span>
            {meta.local && <Badge tone="info">{t("memory_panel.badge_local")}</Badge>}
            {availabilityBadge(e)}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">{t("memory_panel.model_label")}</span>
            <Input
              defaultValue={models[id] || ""}
              placeholder={meta.modelPlaceholder}
              disabled={busy}
              onBlur={(ev) => {
                const v = ev.target.value.trim();
                if (v !== (models[id] || "")) onSetModel(id, v);
              }}
              className="h-7 max-w-[16rem] font-mono text-xs"
            />
          </div>
        </div>
        <Switch checked={e.enabled} onChange={(v) => onToggleEnabled(id, v)} disabled={busy} />
      </div>
    );
  };

  const customRow = (id: string, idx: number) => {
    const e = byId.get(id)!;
    const c = customConfigs[id] || {};
    const set = (field: keyof CustomBlock) => (ev: FocusEvent<HTMLInputElement>) => {
      const v = ev.target.value;
      const cur = c[field] || "";
      if (field === "api_key") {
        if (v && !isMarker(v) && v !== cur) onSetCustomField(id, field, v);
        return;
      }
      const trimmed = v.trim();
      if (trimmed !== (cur || "")) onSetCustomField(id, field, trimmed);
    };
    return (
      <div
        key={id}
        data-testid={`embed-provider-${id}`}
        className={cn(
          "space-y-2 rounded-lg border border-border px-3 py-2.5",
          !e.enabled && "opacity-60",
        )}
      >
        <div className="flex items-center gap-3">
          {arrows(id, idx, false)}
          <StatusDot ok={e.available ? true : e.configured ? false : null} />
          <div className="min-w-0 flex-1">
            <Input
              defaultValue={c.label || ""}
              placeholder={t("memory_panel.custom_label_ph")}
              disabled={busy}
              onBlur={set("label")}
              className="h-7 max-w-[16rem] text-sm font-medium"
            />
          </div>
          <Badge tone="info">{t("memory_panel.badge_custom")}</Badge>
          {availabilityBadge(e)}
          <Switch checked={e.enabled} onChange={(v) => onToggleEnabled(id, v)} disabled={busy} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemoveCustom(id)}
            disabled={busy}
            aria-label={t("memory_panel.remove")}
            data-testid={`embed-provider-${id}-remove`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <div className="grid gap-2 pl-9 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            {t("memory_panel.base_url_label")}
            <Input
              defaultValue={c.base_url || ""}
              placeholder="https://host:port/v1"
              disabled={busy}
              onBlur={set("base_url")}
              className="h-7 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            {t("memory_panel.model_label")}
            <Input
              defaultValue={c.model || ""}
              placeholder="text-embedding-3-small"
              disabled={busy}
              onBlur={set("model")}
              className="h-7 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            {t("memory_panel.custom_key_label")}
            <Input
              type="password"
              defaultValue={c.api_key || ""}
              placeholder={t("memory_panel.custom_optional_ph")}
              disabled={busy}
              onBlur={set("api_key")}
              className="h-7 font-mono text-xs"
            />
          </label>
        </div>
      </div>
    );
  };

  const tfRow = () => {
    const e = tf!;
    const meta = META.tf;
    return (
      <div
        key="tf"
        data-testid="embed-provider-tf"
        className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
      >
        {arrows("tf", null, true)}
        <StatusDot ok={e.available ? true : null} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{meta.name}</span>
            <Badge tone="info">{t("memory_panel.badge_local")}</Badge>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta.note}</div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{t("memory_panel.always_on")}</span>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {ids.map((id, idx) => (byId.get(id)?.custom ? customRow(id, idx) : builtinRow(id, idx)))}
      {tf && tfRow()}
      <button
        type="button"
        onClick={onAddCustom}
        disabled={busy}
        data-testid="embed-provider-add"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-emerald-500/50 hover:text-foreground disabled:opacity-50"
      >
        <Plus className="size-4" /> {t("memory_panel.add_custom")}
      </button>
    </div>
  );
}
