import type { AuxPurpose, Message, Run } from "@apx/protocol";
import { Badge, EmptyState, Icons } from "@apx/ui";
import { useMemo } from "react";
import { contextOf, usageStamp } from "../chat/composer/context.ts";
import { useThreadUsage } from "../chat/composer/usage.ts";
import { formatNumber, formatSeconds, shortWhen } from "../common/format.ts";
import { baseRef } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";

const EMPTY: Message[] = [];
const STATE_TONE = { completed: "brand", failed: "danger", canceled: "neutral" } as const;
const STATE_LABEL: Record<Run["state"], MessageKey> = {
  queued: "usage.state.submitted",
  submitted: "usage.state.submitted",
  working: "usage.state.working",
  "input-required": "usage.state.waiting",
  completed: "usage.state.completed",
  failed: "usage.state.failed",
  canceled: "usage.state.canceled",
};

const AUX_LABEL: Record<AuxPurpose, MessageKey> = {
  title: "usage.aux.title",
  memory_capture: "mem.auto_capture",
  memory_dream: "mem.auto_dream",
  summary: "usage.aux.summary",
  room: "usage.aux.room",
  commit: "usage.aux.commit",
  suggestion: "usage.aux.suggestion",
  news: "usage.aux.news",
  sticker: "usage.aux.sticker",
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
  // The core's figures over every run of the chat (the panel loads only the newest), asked again as runs end.
  const usage = useThreadUsage(threadId, usageStamp(runs));
  const totals = usage?.totals;
  const aux = usage?.aux ?? [];
  if (!threadId || !(runs.length || totals?.runs)) {
    return (
      <div className="sidepanel__body">
        <EmptyState icon={<Icons.Zap />} title={t("usage.empty")}>
          {t("usage.emptyBody")}
        </EmptyState>
      </div>
    );
  }
  const last = [...messages].reverse().find((m) => m.model)?.model;
  const model = last ? baseRef(last) : "—";
  // Claude Code, Codex and ACP agents run on the owner's subscription; our own loop pays a provider per token.
  const engine = model.split("/")[0] ?? "";
  const included = engine === "claude" || engine === "codex" || engine.startsWith("acp:");
  const rows: [string, string][] = [
    [t("usage.model"), model],
    [t("usage.billing"), model === "—" ? "—" : t(included ? "usage.billing.included" : "usage.billing.metered")],
    [
      t("usage.runs"),
      totals ? `${formatNumber(totals.runs)}${totals.failed ? t("usage.runsFailed", { n: totals.failed }) : ""}` : "…",
    ],
    [t("usage.agentTime"), totals ? formatSeconds(totals.seconds) : "…"],
    [
      t("usage.tokens"),
      !totals
        ? "…"
        : totals.input + totals.output
          ? t("usage.tokensValue", { input: formatNumber(totals.input), output: formatNumber(totals.output) })
          : t("usage.noTokens"),
    ],
  ];
  if (totals?.cached)
    rows.push([
      t("usage.cached"),
      t("usage.cachedValue", { cached: formatNumber(totals.cached), input: formatNumber(totals.input) }),
    ]);
  const auxIn = aux.reduce((n, a) => n + a.input, 0);
  const auxOut = aux.reduce((n, a) => n + a.output, 0);
  if (auxIn + auxOut)
    rows.push([
      t("usage.aux"),
      t("usage.auxValue", {
        tokens: t("usage.tokensValue", { input: formatNumber(auxIn), output: formatNumber(auxOut) }),
        purposes: [...new Set(aux.map((a) => t(AUX_LABEL[a.purpose])))].join(", "),
      }),
    ]);
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
