import type { ChatgptStatus, ProviderInfo } from "@apx/protocol";
import { Badge, Button, EngineIcon, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { chatgptStatus } from "../data/chatgpt.ts";
import { useModels } from "../data/models.ts";
import { setProviderEnabled } from "../data/providers.ts";
import { useT } from "../i18n/index.ts";
import { EngineUsageSwitch } from "./EngineUsageSwitch.tsx";
import { PlanLogin } from "./PlanLogin.tsx";

/**
 * The ChatGPT plan as a model API of APX's own loop, shown as Codex: first among the APIs, fixed (signed in or out,
 * switched on or off, never removed). Claude's plan has no counterpart: it runs only in Claude Code (D-043).
 */
export function PlanCard({ p, compact = false }: { p: ProviderInfo; compact?: boolean }) {
  const t = useT();
  const models = useModels((s) => s.catalog.find((e) => e.id === p.id));
  const [status, setStatus] = useState<ChatgptStatus>();
  const [login, setLogin] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when the sign-in changes (key_set) or closes
  useEffect(() => {
    if (!login) void chatgptStatus().then(setStatus);
  }, [login, p.key_set]);
  const connected = p.key_set;
  const count = models?.available ? models.models.filter((m) => m.chat).length : 0;
  return (
    <div className={p.enabled ? "pcard pcard--plan" : "pcard pcard--plan is-off"}>
      <div className="pcard__top">
        <EngineIcon engine="codex" tile size={compact ? 28 : 36} />
        <div className="pcard__titles">
          <div className="pcard__name">{p.label}</div>
          <div className="pcard__plan">{t("plans.codex.kind")}</div>
        </div>
        <Badge tone={connected && p.enabled ? "brand" : connected ? "neutral" : "warning"} dot>
          {!connected ? t("plans.notConnected") : p.enabled ? t("providers.active") : t("providers.off")}
        </Badge>
      </div>
      <dl className="pcard__rows">
        <dt>{t("plans.account")}</dt>
        <dd>{connected ? (status?.account ?? t("plans.connected")) : "—"}</dd>
        {!compact && (
          <>
            <dt>{t("plans.models")}</dt>
            <dd>{count ? t("plans.modelsCount", { count }) : "—"}</dd>
          </>
        )}
      </dl>
      <div className="pcard__actions">
        <Switch
          size="sm"
          checked={p.enabled}
          onCheckedChange={(on) => void setProviderEnabled(p, on)}
          label={t("providers.on")}
        />
        <EngineUsageSwitch key={String(connected)} engine="codex" />
        <span className="pcard__spacer" />
        <Button size="sm" variant={connected ? "secondary" : "primary"} onClick={() => setLogin(true)}>
          {t(connected ? "plans.manage" : "plans.connect")}
        </Button>
      </div>
      {login && <PlanLogin onClose={() => setLogin(false)} />}
    </div>
  );
}
