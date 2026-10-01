import type { Message, Run } from "@apx/protocol";
import { Badge, EmptyState, Icons } from "@apx/ui";
import { useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { useData } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";

const EMPTY: Message[] = [];
const STATE_TONE = { completed: "brand", failed: "danger", canceled: "neutral" } as const;
const STATE_LABEL: Record<Run["state"], string> = {
  submitted: "En cola",
  working: "Trabajando",
  "input-required": "Te espera",
  completed: "Lista",
  failed: "Falló",
  canceled: "Cancelada",
};

function secs(run: Run): number | undefined {
  if (!run.ended_at) return undefined;
  return (Date.parse(run.ended_at) - Date.parse(run.started_at)) / 1000;
}

/** "Consumo": time and tokens of this chat's runs (tokens when the provider reports them). */
export function UsagePanel() {
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
        <EmptyState icon={<Icons.Zap />} title="Sin consumo todavía">
          Cuando el agente responda, ves acá sus corridas y tiempos.
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
  const fmt = (n: number) => n.toLocaleString("es-AR");
  const failed = runs.filter((r) => r.state === "failed").length;
  const model = [...messages].reverse().find((m) => m.model)?.model ?? "—";
  const rows: [string, string][] = [
    ["Modelo", model],
    ["Corridas", `${runs.length}${failed ? ` · ${failed} fallaron` : ""}`],
    ["Tiempo de agente", `${total.toFixed(1)} s`],
    [
      "Tokens",
      tokens.input + tokens.output
        ? `${fmt(tokens.input)} entrada · ${fmt(tokens.output)} salida`
        : "sin datos del proveedor",
    ],
  ];
  return (
    <div className="usage">
      <dl className="usage__kv">
        {rows.map(([k, v]) => (
          <div key={k} className="usage__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="usage__label">Últimas corridas</div>
      <ul className="usage__runs">
        {runs.slice(0, 12).map((r) => {
          const s = secs(r);
          return (
            <li key={r.id} className="usage__run">
              <Badge tone={r.state in STATE_TONE ? STATE_TONE[r.state as keyof typeof STATE_TONE] : "info"}>
                {STATE_LABEL[r.state]}
              </Badge>
              <span className="usage__when">{shortWhen(r.started_at)}</span>
              <span className="usage__dur">{s != null ? `${s.toFixed(1)} s` : "…"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
