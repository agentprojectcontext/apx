import type { ChatgptStatus, ProviderInfo } from "@apx/protocol";
import { Badge, Button, EngineIcon, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { chatgptStatus } from "../data/chatgpt.ts";
import { useModels } from "../data/models.ts";
import { setProviderEnabled, useProviders } from "../data/providers.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { PlanLogin } from "./PlanLogin.tsx";
import { openProviderEditor } from "./ProvidersGrid.tsx";

/**
 * The owner's subscriptions as engines of APX's own loop, above the model APIs: Codex (the ChatGPT plan, signed in
 * from APX) and Claude, whose plan runs only in Claude Code (DECISIONS.md#d-043).
 */
export function PlanCards() {
  const plan = useProviders((s) => s.list.find((p) => p.sign_in === "chatgpt"));
  return (
    <div className="plans">
      {plan && <CodexPlan p={plan} />}
      <ClaudePlan />
    </div>
  );
}

function CodexPlan({ p }: { p: ProviderInfo }) {
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
    <div className={p.enabled ? "plan" : "plan is-off"}>
      <div className="plan__top">
        <EngineIcon engine="codex" tile size={40} />
        <div className="plan__titles">
          <div className="plan__name">{p.label}</div>
          <div className="plan__kind">{t("plans.codex.kind")}</div>
        </div>
        <Badge tone={connected && p.enabled ? "brand" : connected ? "neutral" : "warning"} dot>
          {!connected ? t("plans.notConnected") : p.enabled ? t("providers.active") : t("providers.off")}
        </Badge>
      </div>
      <dl className="pcard__rows">
        <dt>{t("plans.account")}</dt>
        <dd>{connected ? (status?.account ?? t("plans.connected")) : "—"}</dd>
        <dt>{t("plans.models")}</dt>
        <dd>{count ? t("plans.modelsCount", { count }) : "—"}</dd>
      </dl>
      <div className="pcard__actions">
        <Switch
          size="sm"
          checked={p.enabled}
          onCheckedChange={(on) => void setProviderEnabled(p, on)}
          label={t("providers.on")}
        />
        <span className="pcard__spacer" />
        <Button size="sm" variant={connected ? "secondary" : "primary"} onClick={() => setLogin(true)}>
          {t(connected ? "plans.manage" : "plans.connect")}
        </Button>
      </div>
      {login && <PlanLogin onClose={() => setLogin(false)} />}
    </div>
  );
}

function ClaudePlan() {
  const t = useT();
  return (
    <div className="plan">
      <div className="plan__top">
        <EngineIcon engine="claude" tile size={40} />
        <div className="plan__titles">
          <div className="plan__name">Claude</div>
          <div className="plan__kind">{t("plans.claude.kind")}</div>
        </div>
        <Badge tone="neutral">{t("plans.claude.only")}</Badge>
      </div>
      <p className="plan__body">{t("plans.claude.body")}</p>
      <div className="pcard__actions">
        <Button size="sm" variant="secondary" onClick={() => openProviderEditor("anthropic")}>
          {t("plans.claude.useKey")}
        </Button>
        <span className="pcard__spacer" />
        <Button size="sm" variant="ghost" onClick={() => go.config("external")}>
          {t("plans.claude.external")}
        </Button>
      </div>
    </div>
  );
}
