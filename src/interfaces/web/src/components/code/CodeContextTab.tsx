import { useMemo } from "react";
import { t } from "../../i18n";
import { Empty } from "../ui";
import { computeMetrics, computeBreakdown } from "../../lib/code-context";
import type { CodeTurn } from "../../lib/api/code";

interface Props {
  turns: CodeTurn[];
}

const SEG_COLOR: Record<string, string> = {
  user: "bg-emerald-500",
  assistant: "bg-sky-500",
  tool: "bg-amber-500",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-background/50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm">{value}</div>
    </div>
  );
}

// Context tab: real token totals from the last assistant turn + a char/4
// estimate of where the conversation's weight sits.
export function CodeContextTab({ turns }: Props) {
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
    <div className="space-y-3 p-3" data-testid="code-context-tab">
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t("code_module.ctx_model")} value={m.model || "auto"} />
        <Stat label={t("code_module.ctx_messages")} value={`${m.userMsgs}/${m.assistantMsgs}`} />
        <Stat label={t("code_module.ctx_input")} value={m.input.toLocaleString()} />
        <Stat label={t("code_module.ctx_output")} value={m.output.toLocaleString()} />
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
          {t("code_module.ctx_breakdown")}
        </div>
        {breakdown.length > 0 ? (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {breakdown.map((s) => (
                <div
                  key={s.key}
                  className={SEG_COLOR[s.key]}
                  style={{ width: `${s.percent}%` }}
                  title={`${s.key}: ${s.tokens} (${s.percent}%)`}
                />
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
