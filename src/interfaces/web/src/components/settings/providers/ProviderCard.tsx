import { useEffect, useState } from "react";
import { Trash2, Zap, LogIn } from "lucide-react";
import { cn } from "../../../lib/cn";
import { toneDot, toneText } from "../../../lib/tone";
import { Tip } from "../../ui/tip";
import { Button } from "../../ui";
import { secretSuffix } from "../../../lib/secrets";
import { Engines } from "../../../lib/api";
import { ENGINE_BADGES, ENGINE_GRADIENTS, ENGINE_ICONS, ENGINE_OPTIONS, engineStyle } from "./typeStyles";
import type { Provider } from "./types";
import { t } from "../../../i18n";
import codexLogo from "../../../assets/cli/codex.webp";
import claudeLogo from "../../../assets/cli/claude.webp";

/** Brand marks for providers that should not wear a generic lucide glyph. */
const BRAND_LOGOS: Record<string, string> = {
  "codex-plus": codexLogo,
  "chatgpt-codex": codexLogo,
  especial: codexLogo,
  codex: codexLogo,
  "claude-subscription": claudeLogo,
  claude: claudeLogo,
};

function isPlanProvider(provider: Provider) {
  return (
    provider.engine === "codex-plus"
    || provider.engine === "claude-subscription"
    || provider.slug === "chatgpt-codex"
    || provider.slug === "claude-subscription"
    || provider.slug === "especial"
  );
}

function planAuthTarget(provider: Provider): "chatgpt-codex" | "claude-subscription" {
  if (provider.slug === "claude-subscription" || provider.engine === "claude-subscription") {
    return "claude-subscription";
  }
  return "chatgpt-codex";
}

export function ProviderCard({
  provider,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  onLogin,
}: {
  provider: Provider;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onTest: () => void;
  onLogin?: () => void;
}) {
  const plan = isPlanProvider(provider);
  const gradient = engineStyle(ENGINE_GRADIENTS, provider.engine);
  const badge = engineStyle(ENGINE_BADGES, provider.engine);
  const Icon = engineStyle(ENGINE_ICONS, provider.engine);
  const brandLogo = BRAND_LOGOS[provider.slug] || BRAND_LOGOS[provider.engine];
  const engineLabel =
    provider.engine === "codex-plus" || provider.slug === "chatgpt-codex"
      ? "ChatGPT/Codex"
      : provider.engine === "claude-subscription" || provider.slug === "claude-subscription"
        ? "Claude (Max)"
        : (ENGINE_OPTIONS.find((o) => o.value === provider.engine)?.label || provider.engine);
  const hasKey = typeof provider.api_key === "string" && provider.api_key.length > 0;
  const keySuffix = secretSuffix(provider.api_key);
  const active = provider.is_active !== false;

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    Engines.authStatus(planAuthTarget(provider))
      .then((s) => { if (!cancelled) setLoggedIn(!!s.logged_in); })
      .catch(() => { if (!cancelled) setLoggedIn(false); });
    return () => { cancelled = true; };
  }, [plan, provider.slug, provider.engine]);

  if (plan) {
    return (
      <div className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          {brandLogo ? (
            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-border">
              <img src={brandLogo} alt="" className="size-8 object-contain" />
            </div>
          ) : (
            <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br", gradient)}>
              <Icon className="size-5 text-white" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{provider.name || provider.slug}</h3>
            <p className="truncate font-mono text-[10px] text-muted-fg">{provider.slug}</p>
            <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", badge)}>
              {brandLogo ? (
                <img src={brandLogo} alt="" className="size-3 object-contain" />
              ) : (
                <Icon className="size-3" />
              )}{" "}
              {engineLabel}
            </span>
          </div>
          <Tip content={active ? t("providers_modal.toggle_active") : t("providers_modal.toggle_inactive")}>
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                active
                  ? cn(toneText.emerald, "border-emerald-600/40 hover:bg-emerald-500/10 dark:border-emerald-500/40")
                  : "border-border text-muted-fg hover:text-foreground",
              )}
            >
              <span className={cn("size-1.5 rounded-full", active ? toneDot.emerald : "bg-muted-fg/40")} />
              {active ? t("providers_card.active") : t("providers_card.off")}
            </button>
          </Tip>
        </div>

        <div className="mt-auto space-y-2">
          <p className="text-[11px] text-muted-fg">
            {loggedIn === true
              ? t("providers_card.plan_logged_in")
              : loggedIn === false
                ? t("providers_card.plan_logged_out")
                : t("providers_card.plan_auth")}
          </p>
          <Button size="sm" variant="primary" className="w-full" onClick={() => onLogin?.()}>
            <LogIn className="size-3.5" />
            {loggedIn ? t("providers_card.plan_login_manage") : t("providers_card.plan_login")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-muted-fg/50"
      onClick={onEdit}
    >
      <div className="flex items-start gap-3">
        {brandLogo ? (
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-border">
            <img src={brandLogo} alt="" className="size-8 object-contain" />
          </div>
        ) : (
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br", gradient)}>
            <Icon className="size-5 text-white" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{provider.name || provider.slug}</h3>
          <p className="truncate font-mono text-[10px] text-muted-fg">{provider.slug}</p>
          <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", badge)}>
            {brandLogo ? (
              <img src={brandLogo} alt="" className="size-3 object-contain" />
            ) : (
              <Icon className="size-3" />
            )}{" "}
            {engineLabel}
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
                  ? cn(toneText.emerald, "border-emerald-600/40 hover:bg-emerald-500/10 dark:border-emerald-500/40")
                  : "border-border text-muted-fg hover:text-foreground",
              )}
            >
              <span className={cn("size-1.5 rounded-full", active ? toneDot.emerald : "bg-muted-fg/40")} />
              {active ? t("providers_card.active") : t("providers_card.off")}
            </button>
          </Tip>
          <Tip content={t("provider_test.button")}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTest(); }}
              className="rounded-md p-1 text-muted-fg hover:bg-accent hover:text-foreground"
            >
              <Zap className="size-3.5" />
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

      <div className="mt-auto space-y-1 text-xs">
        <Row label={t("providers_card.model")} value={provider.default_model || "—"} mono />
        {provider.base_url && <Row label={t("providers_card.base_url")} value={provider.base_url} mono truncate />}
        <Row
          label={t("providers_card.api_key")}
          value={hasKey ? (keySuffix ? `…${keySuffix}` : t("providers_card.key_set")) : "—"}
          mono={!!keySuffix}
        />
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
