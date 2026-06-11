import { useMemo } from "react";
import { t } from "../../i18n";
import { Empty } from "../ui";
import { Tip } from "../ui/tip";
import { computeMetrics, computeBreakdown } from "../../lib/code-context";
import type { CodeTurn } from "../../lib/api/code";

interface SessionInfo {
  title: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
  agentSlug: string | null;
}

interface Props {
  turns: CodeTurn[];
  session?: SessionInfo | null;
}

const SEG_COLOR: Record<string, string> = {
  user: "bg-emerald-500",
  assistant: "bg-sky-500",
  tool: "bg-amber-500",
};

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())} ${d.toLocaleString("es", { month: "short" })} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Context tab: real token totals from the last assistant turn + a char/4
// estimate of where the conversation's weight sits.
export function CodeContextTab({ turns, session }: Props) {
  const m = useMemo(() => computeMetrics(turns), [turns]);
  const breakdown = useMemo(() => computeBreakdown(turns), [turns]);

  if (turns.length === 0) {
    return (
      <div className="p-3">
        <Empty>{t("code_module.ctx_none")}</Empty>
      </div>
    );
  }

  return (
    <div className="space-y-1 p-3" data-testid="code-context-tab">
      <Row label={t("code_module.ctx_model")} value={m.model || "auto"} />
      {session?.mode && <Row label="Modo" value={session.mode} />}
      {session?.agentSlug && <Row label="Agente" value={session.agentSlug} />}
      <Row
        label={t("code_module.ctx_messages")}
        value={`${m.userMsgs} usuario · ${m.assistantMsgs} asistente`}
      />
      <Row label={t("code_module.ctx_input")} value={m.input.toLocaleString()} />
      <Row label={t("code_module.ctx_output")} value={m.output.toLocaleString()} />
      <Row label="Tokens Total" value={(m.input + m.output).toLocaleString()} />
      {session?.createdAt && <Row label="Creado" value={fmtDate(session.createdAt)} />}
      {session?.updatedAt && <Row label="Actividad" value={fmtDate(session.updatedAt)} />}

      <hr className="border-border my-2" />

      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
          {t("code_module.ctx_breakdown")}
        </div>
        {breakdown.length > 0 ? (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {breakdown.map((s) => (
                <Tip key={s.key} content={`${s.key}: ${s.tokens} (${s.percent}%)`}>
                  <div
                    className={SEG_COLOR[s.key]}
                    style={{ width: `${s.percent}%` }}
                  />
                </Tip>
              ))}
            </div>
            <ul className="mt-2 space-y-1">
              {breakdown.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-[11px]">
                  <span className={`size-2 rounded-full ${SEG_COLOR[s.key]}`} />
                  <span className="flex-1 text-foreground/80">{t(`code_module.seg_${s.key}` as never)}</span>
                  <span className="font-mono text-muted-foreground">
                    {s.tokens} · {s.percent}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("code_module.ctx_none")}</p>
        )}
      </div>
    </div>
  );
}
