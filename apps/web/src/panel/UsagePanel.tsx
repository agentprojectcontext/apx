import type { Message, Run } from "@apx/protocol";
import { Badge, EmptyState, Icons } from "@apx/ui";
import { useMemo } from "react";
import { contextOf } from "../chat/composer/context.ts";
import { formatNumber, formatSeconds, shortWhen } from "../common/format.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";

const EMPTY: Message[] = [];
const STATE_TONE = { completed: "brand", failed: "danger", canceled: "neutral" } as const;
const STATE_LABEL: Record<Run["state"], MessageKey> = {
  submitted: "usage.state.submitted",
  working: "usage.state.working",
  "input-required": "usage.state.waiting",
  completed: "usage.state.completed",
  failed: "usage.state.failed",
  canceled: "usage.state.canceled",
};

function secs(run: Run): number | undefined {
  if (!run.ended_at) return undefined;
  return (Date.parse(run.ended_at) - Date.parse(run.started_at)) / 1000;
}

/** "Usage": time and tokens of this chat's runs (tokens when the provider reports them). */
export function UsagePanel() {
  const t = useT();
  const threadId = useNav((s) => s.threadId);
  const runsById = useData((s) => s.runs);
  const messages = useData((s) => (threadId ? (s.messages[threadId] ?? EMPTY) : EMPTY));
  const runs = useMemo(
    () =>
      Object.values(runsById)
        .filter((r) => r.thread_id === threadId)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [runsById, threadId],
  );
  if (!threadId || !runs.length) {
    return (
      <div className="sidepanel__body">
        <EmptyState icon={<Icons.Zap />} title={t("usage.empty")}>
          {t("usage.emptyBody")}
        </EmptyState>
      </div>
    );
  }
  const total = runs.reduce((acc, r) => acc + (secs(r) ?? 0), 0);
  const tokens = runs.reduce(
    (acc, r) => ({ input: acc.input + (r.usage?.input ?? 0), output: acc.output + (r.usage?.output ?? 0) }),
    {
      input: 0,
      output: 0,
    },
  );
  const failed = runs.filter((r) => r.state === "failed").length;
  const model = [...messages].reverse().find((m) => m.model)?.model ?? "—";
  // Claude Code, Codex and ACP agents run on the owner's subscription; our own loop pays a provider per token.
  const engine = model.split("/")[0] ?? "";
  const included = engine === "claude" || engine === "codex" || engine.startsWith("acp:");
  const rows: [string, string][] = [
    [t("usage.model"), model],
    [t("usage.billing"), model === "—" ? "—" : t(included ? "usage.billing.included" : "usage.billing.metered")],
    [t("usage.runs"), `${formatNumber(runs.length)}${failed ? t("usage.runsFailed", { n: failed }) : ""}`],
    [t("usage.agentTime"), formatSeconds(total)],
    [
      t("usage.tokens"),
      tokens.input + tokens.output
        ? t("usage.tokensValue", { input: formatNumber(tokens.input), output: formatNumber(tokens.output) })
        : t("usage.noTokens"),
    ],
  ];
  const context = contextOf(runs);
  return (
    <div className="usage">
      {context?.window && (
        <div className="usage__context">
          <div className="usage__contexttext">
            {t("usage.context", { used: formatNumber(context.used), window: formatNumber(context.window) })}
          </div>
          <div className="usage__bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (context.used / context.window) * 100)}%` }} />
          </div>
        </div>
      )}
      <dl className="usage__kv">
        {rows.map(([k, v]) => (
          <div key={k} className="usage__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="usage__label">{t("usage.recent")}</div>
      <ul className="usage__runs">
        {runs.slice(0, 12).map((r) => {
          const s = secs(r);
          return (
            <li key={r.id} className="usage__run">
              <Badge tone={r.state in STATE_TONE ? STATE_TONE[r.state as keyof typeof STATE_TONE] : "info"}>
                {t(STATE_LABEL[r.state])}
              </Badge>
              <span className="usage__when">{shortWhen(r.started_at)}</span>
              <span className="usage__dur">{s != null ? formatSeconds(s) : "…"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
