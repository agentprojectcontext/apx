import { useEffect, useState } from "react";
import { AgentAvatar, type AgentFace } from "../agents/AgentAvatar";
import { useThreadJobs } from "../../hooks/useBackgroundJobs";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { ChatMsg } from "../../hooks/useChat";

/** The two addresses a job running in THIS chat can be filed under. Handed down
 *  from the screen that knows which chat is open. */
export interface JobScope {
  threadId?: string | null;
  conversationId?: string | null;
}

/** "45s", "1m 3s", "1h 04m". Seconds matter for the first minute and stop
 *  mattering after an hour, which is also when they start jittering the width
 *  of a line that is being read. */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** 573 → "573", 1_240 → "1.2k". The same scale the bubble footer uses, so the
 *  number does not change shape when the turn lands. */
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** A clock that ticks while the turn runs. One interval, one component — the
 *  whole reason this is not computed in the bubble. */
function useElapsed(startIso?: string): number | null {
  const start = startIso ? Date.parse(startIso) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(start)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [start]);
  if (!Number.isFinite(start)) return null;
  // A clock skew between this browser and the daemon must not print "-3s".
  return Math.max(0, now - start);
}

/** What the turn is doing RIGHT NOW, read off the work it has done so far.
 *
 *  Not a phase the daemon declares — the last part IS the phase, and deriving
 *  it here means the line cannot claim "running tools" for a turn whose tools
 *  all came back. A running tool is named: "which step is it stuck on" is most
 *  of what anybody asks of a turn that has gone quiet. */
function activityOf(msg: ChatMsg): string {
  const last = msg.parts.at(-1);
  if (!last) return t("chat_ui.typing_generic");
  if (last.kind === "tool") {
    return last.status === "running"
      ? t("chat_ui.turn_running_tool", { tool: last.tool })
      : t("chat_ui.working_generic");
  }
  if (last.kind === "reasoning") return t("chat_ui.thinking_running");
  return t("chat_ui.typing_generic");
}

/**
 * The line under a turn that is still being written.
 *
 * It replaces a pill that said "Romi está escribiendo…" and nothing else. That
 * sentence answers the one question you never had — somebody is obviously
 * writing, the bubble is right there — while the questions you DO have during a
 * two-minute turn had no answer anywhere: which model is answering, how long it
 * has been going, what it is spending, and whether the work it left running is
 * still out. Manu, 2026-09-20: "sobre todo ver el modelo que escribe, porque
 * puede pasar que se salteen dos y quede uno específico o el agente tenga un
 * modelo custom, y hasta que no termina de escribir no veo qué modelo se usó."
 *
 * So: the speaker's own face instead of their name in words, then the facts, in
 * the order you ask for them. Every field is absent when unknown rather than
 * drawn as a placeholder — a line that says "—" three times reads as broken,
 * and a model that has not been chosen yet is a second away.
 *
 * The tasks counted here are THIS chat's, not the window's: the header already
 * carries the global number, and ten jobs running in other projects say nothing
 * about the turn you are reading.
 */
export function TurnStatus({ msg, face, name, jobScope, compact }: {
  msg: ChatMsg;
  face?: AgentFace;
  /** Who is writing, for the spoken label. The face carries it visually. */
  name?: string;
  jobScope?: JobScope;
  compact?: boolean;
}) {
  const elapsed = useElapsed(msg.ts);
  const jobs = useThreadJobs(jobScope?.threadId, jobScope?.conversationId);
  const tokens = (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0);
  const activity = activityOf(msg);
  // What a screen reader hears: the sentence the pill used to be, which is the
  // one shape that works when the facts cannot be read as a row.
  const spoken = name ? t("chat_ui.working", { name }) : t("chat_ui.working_generic");

  const fields: string[] = [];
  if (msg.model) fields.push(msg.model);
  if (elapsed != null) fields.push(fmtElapsed(elapsed));
  if (tokens > 0) fields.push(t("chat_ui.turn_tokens", { n: fmtTok(tokens) }));

  return (
    <div
      role="status"
      aria-label={spoken}
      data-testid="turn-status"
      className={cn(
        "flex w-fit max-w-full items-center gap-2 self-start py-0.5 text-[11px] text-muted-fg",
        // On a phone the row would otherwise push the model off the edge; it
        // wraps to a second line there instead of truncating the one field
        // this whole line was built for.
        compact && "flex-wrap",
      )}
    >
      {/* The speaker, as a face rather than as their name spelled out — the
          bubble above is already theirs. It breathes so the line reads as
          something happening rather than as a caption. */}
      <AgentAvatar
        {...(face || {})}
        size={16}
        className="shrink-0 animate-pulse motion-reduce:animate-none"
      />
      <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
        {fields.map((f, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-muted-fg/50">·</span>}
            {/* The model is the field that can be long ("zen:deepseek-v4-flash-free")
                and the field that is least guessable, so it gets the truncation
                rather than the row. */}
            <span className={cn("truncate", i === 0 && msg.model && "font-mono")}>{f}</span>
          </span>
        ))}
        {/* This chat's own background work, in the green the jobs panel, the
            context strip and the chat-row mark already use for it. */}
        {jobs.length > 0 && (
          <span className="flex shrink-0 items-center gap-1.5">
            {fields.length > 0 && <span aria-hidden className="text-muted-fg/50">·</span>}
            <span className="text-emerald-700 dark:text-emerald-400">
              {jobs.length === 1
                ? t("chat_ui.jobs_running_one")
                : t("chat_ui.jobs_running", { n: jobs.length })}
            </span>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          {(fields.length > 0 || jobs.length > 0) && <span aria-hidden className="text-muted-fg/50">·</span>}
          <span className="truncate">{activity}</span>
        </span>
      </span>
    </div>
  );
}
