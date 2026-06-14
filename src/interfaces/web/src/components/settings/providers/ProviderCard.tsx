import { Trash2 } from "lucide-react";
import { cn } from "../../../lib/cn";
import { Tip } from "../../ui/tip";
import { secretSuffix } from "../../../lib/secrets";
import { ENGINE_BADGES, ENGINE_GRADIENTS, ENGINE_ICONS, ENGINE_OPTIONS, engineStyle } from "./typeStyles";
import type { Provider } from "./types";
import { t } from "../../../i18n";

export function ProviderCard({
  provider,
  onEdit,
  onDelete,
  onToggle,
}: {
  provider: Provider;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const gradient = engineStyle(ENGINE_GRADIENTS, provider.engine);
  const badge = engineStyle(ENGINE_BADGES, provider.engine);
  const Icon = engineStyle(ENGINE_ICONS, provider.engine);
  const engineLabel = ENGINE_OPTIONS.find((o) => o.value === provider.engine)?.label || provider.engine;
  const hasKey = typeof provider.api_key === "string" && provider.api_key.length > 0;
  const keySuffix = secretSuffix(provider.api_key);
  const active = provider.is_active !== false;

  return (
    <div
      className="group flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-muted-fg/50"
      onClick={onEdit}
    >
      {/* Header: icon avatar · name/slug · actions */}
      <div className="flex items-start gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br", gradient)}>
          <Icon className="size-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{provider.name || provider.slug}</h3>
          <p className="truncate font-mono text-[10px] text-muted-fg">{provider.slug}</p>
          <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", badge)}>
            <Icon className="size-3" /> {engineLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tip content={active ? t("providers_modal.toggle_active") : t("providers_modal.toggle_inactive")}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className={cn(
                "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                active
                  ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                  : "border-border text-muted-fg hover:text-foreground",
              )}
            >
              <span className={cn("size-1.5 rounded-full", active ? "bg-emerald-400" : "bg-muted-fg/40")} />
              {active ? t("providers_card.active") : t("providers_card.off")}
            </button>
          </Tip>
          <Tip content={t("providers_modal.delete")}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="rounded-md p-1 text-muted-fg hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </Tip>
        </div>
      </div>

      {/* Body */}
      <div className="mt-auto space-y-1 text-xs">
        <Row label={t("providers_card.model")} value={provider.default_model || "—"} mono />
        {provider.base_url && <Row label={t("providers_card.base_url")} value={provider.base_url} mono truncate />}
        <Row label={t("providers_card.api_key")} value={hasKey ? (keySuffix ? `…${keySuffix}` : t("providers_card.key_set")) : "—"} mono={!!keySuffix} />
        {provider.default_temperature !== undefined && (
          <Row label={t("providers_card.temp")} value={provider.default_temperature.toFixed(1)} />
        )}
        {provider.pricing?.input_per_million !== undefined && (
          <Row label={t("providers_card.price_io")} value={`${provider.pricing.input_per_million ?? 0} / ${provider.pricing.output_per_million ?? 0}`} />
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono, truncate }: { label: string; value: string; mono?: boolean; truncate?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-fg">{label}</span>
      <span className={cn("text-foreground", mono && "font-mono", truncate && "max-w-[180px] truncate")}>{value}</span>
    </div>
  );
}
