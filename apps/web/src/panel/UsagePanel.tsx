import type { AuxPurpose, Message, Result, Run } from "@apx/protocol";
import { Badge, EmptyState, Icons } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { contextOf } from "../chat/composer/context.ts";
import { formatNumber, formatSeconds, shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
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
  // The auxiliary model's calls about this chat (its title, summaries, a room's filter): asked again after each run.
  const [aux, setAux] = useState<Result<"usage.summary">["aux"]>([]);
  const ended = runs.filter((r) => r.ended_at).length;
  useEffect(() => {
    setAux([]);
    if (!threadId || !ended) return;
    let live = true;
    client
      .call("usage.summary", { thread: threadId })
      .then((r) => live && setAux(r.aux))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [threadId, ended]);
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
  const last = [...messages].reverse().find((m) => m.model)?.model;
  const model = last ? baseRef(last) : "—";
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
