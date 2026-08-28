import { useMemo } from "react";
import { t } from "../../i18n";
import { Empty } from "../ui";
import { Tip } from "../ui/tip";
import { UiSelect, type UiSelectOption } from "../UiSelect";
import { computeMetrics, computeBreakdown } from "../../lib/code-context";
import type { CodeTurn } from "../../lib/api/code";

interface SessionInfo {
  title: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
  agentSlug: string | null;
  projectName?: string | null;
}

interface Props {
  turns: CodeTurn[];
  session?: SessionInfo | null;
  /** Agent roster of the session's project; omit to render the agent read-only. */
  agentOptions?: UiSelectOption[];
  onAgentChange?: (slug: string) => void;
  busy?: boolean;
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

// Context tab: WHO and WHERE this session runs, then real token totals from the
// last assistant turn plus a char/4 estimate of where the weight sits.
//
// The identity block renders before the first turn on purpose — "which project
// and which agent is this?" is the question you have at the empty chat, and the
// panel used to answer it only after you had already sent something.
export function CodeContextTab({ turns, session, agentOptions, onAgentChange, busy }: Props) {
  const m = useMemo(() => computeMetrics(turns), [turns]);
  const breakdown = useMemo(() => computeBreakdown(turns), [turns]);
  const editableAgent = agentOptions && onAgentChange;

  return (
    <div className="space-y-1 p-3" data-testid="code-context-tab">
      {session?.projectName && (
        <Row label={t("modules_ui.code_ctx_project")} value={session.projectName} />
      )}
      {session?.mode && <Row label={t("modules_ui.code_ctx_mode")} value={session.mode} />}

      {editableAgent ? (
        <div className="flex items-center justify-between gap-2 py-1" data-testid="code-session-agent">
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("modules_ui.code_ctx_agent")}
          </span>
          <div className="min-w-0 flex-1">
            <UiSelect
              value={session?.agentSlug || "super-agent"}
              onChange={onAgentChange}
              options={agentOptions}
              disabled={busy}
              showIcon
              className="h-7 text-xs"
            />
          </div>
        </div>
      ) : (
        session?.agentSlug && <Row label={t("modules_ui.code_ctx_agent")} value={session.agentSlug} />
      )}

      {turns.length === 0 ? (
        <div className="pt-2">
          <Empty>{t("code_module.ctx_none")}</Empty>
        </div>
      ) : (
        <>
          <Row label={t("code_module.ctx_model")} value={m.model || t("modules_ui.code_ctx_auto")} />
          <Row
            label={t("code_module.ctx_messages")}
            value={t("modules_ui.code_ctx_msgs_value", { user: m.userMsgs, assistant: m.assistantMsgs })}
          />
          <Row label={t("code_module.ctx_input")} value={m.input.toLocaleString()} />
          <Row label={t("code_module.ctx_output")} value={m.output.toLocaleString()} />
          <Row label={t("modules_ui.code_ctx_tokens_total")} value={(m.input + m.output).toLocaleString()} />
          {session?.createdAt && <Row label={t("modules_ui.code_ctx_created")} value={fmtDate(session.createdAt)} />}
          {session?.updatedAt && <Row label={t("modules_ui.code_ctx_activity")} value={fmtDate(session.updatedAt)} />}

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
        </>
      )}
    </div>
  );
}
