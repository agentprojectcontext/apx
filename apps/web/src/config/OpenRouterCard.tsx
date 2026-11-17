import type { ProviderInfo } from "@apx/protocol";
import { Badge, Button, EngineIcon, Spinner, Switch } from "@apx/ui";
import { useOpenRouterConnect } from "../data/openrouter.ts";
import { setProviderEnabled } from "../data/providers.ts";
import { useT } from "../i18n/index.ts";

/**
 * OpenRouter as a fixed card, second after the ChatGPT plan: it connects by signing in (one click, its free models
 * first) or by a key set up by hand. Never removed; switched off instead. `p` is absent until it is set up.
 */
export function OpenRouterCard({
  p,
  compact = false,
  onConfigure,
}: {
  p: ProviderInfo | undefined;
  compact?: boolean;
  onConfigure: () => void;
}) {
  const t = useT();
  // Signed in (it has its key); active is that and switched on.
  const signedIn = Boolean(p?.key_set);
  const connected = signedIn && Boolean(p?.enabled);
  const { waiting, connect } = useOpenRouterConnect(signedIn);
  const off = p && !p.enabled;
  return (
    <div className={off ? "pcard pcard--plan pcard--openrouter is-off" : "pcard pcard--plan pcard--openrouter"}>
      <div className="pcard__top">
        <EngineIcon engine="openrouter" tile size={compact ? 28 : 36} />
        <div className="pcard__titles">
          <div className="pcard__name">OpenRouter</div>
          <div className="pcard__plan">{t("providers.openrouterKind")}</div>
        </div>
        <Badge tone={connected ? "brand" : waiting ? "info" : off ? "neutral" : "warning"} dot={!waiting}>
          {waiting && <Spinner size={10} />}
          {t(
            connected
              ? "providers.active"
              : waiting
                ? "providers.connecting"
                : off
                  ? "providers.off"
                  : "plans.notConnected",
          )}
        </Badge>
      </div>
      <dl className="pcard__rows">
        <dt>{t("providers.key")}</dt>
        <dd>{p?.key_set ? `****${p.key_hint ?? ""}` : "—"}</dd>
      </dl>
      <div className="pcard__actions">
        {/* On or off only means something once it is connected. */}
        {p && signedIn && (
          <Switch
            size="sm"
            checked={p.enabled}
            onCheckedChange={(on) => void setProviderEnabled(p, on)}
            label={t("providers.on")}
          />
        )}
        <span className="pcard__spacer" />
        <Button size="sm" variant="secondary" onClick={onConfigure}>
          {t("providers.configure")}
        </Button>
        {!signedIn && (
          <Button size="sm" loading={waiting} onClick={connect}>
            {t("plans.connect")}
          </Button>
        )}
      </div>
    </div>
  );
}
