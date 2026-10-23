import type { Routine, RoutineRun } from "@apx/protocol";
import { Badge, Button, Icons } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { Drawer } from "../common/Drawer.tsx";
import { formatSeconds, shortWhen } from "../common/format.ts";
import { loadThread } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { ActivationBars, barKey, barOf, hasAgent, useRuns } from "./ActivationBars.tsx";
import { scheduleText } from "./Schedule.tsx";

const CALL_KEY: Record<Routine["call_model"], MessageKey> = {
  always: "routines.call.always",
  output: "routines.call.output",
  succeeds: "routines.call.succeeds",
  fails: "routines.call.fails",
  never: "routines.call.never",
};
const ACTION_KEY: Record<Routine["action"], MessageKey> = {
  agent: "routines.action.agent",
  message: "routines.action.message",
  shell: "routines.action.shell",
  watch: "routines.action.watch",
  relay: "routines.action.relay",
  mail: "routines.action.mail",
};

/**
 * A routine beside its list: how it is set up (trigger · before · action · after), its prompt and its activations.
 * Opening one shows that run's conversation in the same drawer; back (or Escape) returns to the routine.
 */
export function RoutineDrawer(props: { routine: Routine; agentName: string; onEdit: () => void; onClose: () => void }) {
  const t = useT();
  const { routine: r } = props;
  const runs = useRuns(r);
  const [shown, setShown] = useState<RoutineRun>();
  return (
    <Drawer
      label={r.name}
      className="rtdrawer"
      title={<span className="rtdrawer__title">{r.name}</span>}
      onClose={props.onClose}
      back={shown && { label: t("routines.back"), onClick: () => setShown(undefined) }}
      actions={
        !shown && (
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={13} />} onClick={props.onEdit}>
            {t("routines.edit")}
          </Button>
        )
      }
    >
      {shown ? (
        <>
          <RunLine run={shown} action={r.action} />
          <RunTranscript threadId={shown.thread_id} />
        </>
      ) : (
        <RoutineDetail routine={r} agentName={props.agentName} runs={runs} onOpen={setShown} />
      )}
    </Drawer>
  );
}

function RoutineDetail(props: {
  routine: Routine;
  agentName: string;
  runs: RoutineRun[] | undefined;
  onOpen: (run: RoutineRun) => void;
}) {
  const t = useT();
  const { routine: r, runs } = props;
  // Only an agent's routine can spare a model call; a message or a shell job never makes one.
  const judged = hasAgent(r.action) ? (runs ?? []).filter((x) => x.model_called !== undefined) : [];
  const skipped = judged.filter((x) => x.model_called === false).length;
  return (
    <>
      <div className="rtdetail__cards">
        <Card icon={<Icons.Clock size={13} />} label={t("routines.card.trigger")} title={scheduleText(r.schedule, t)}>
          {r.schedule.kind === "cron" && <code>{r.schedule.cron}</code>}
        </Card>
        {r.pre_command && r.action !== "shell" && (
          <Card
            icon={<Icons.Terminal size={13} />}
            label={t("routines.card.before")}
            title={t("routines.card.command")}
          >
            <code>{r.pre_command}</code>
          </Card>
        )}
        <Card
          icon={
            r.action === "agent" ? (
              <Icons.Bot size={13} />
            ) : r.action === "watch" ? (
              <Icons.Eye size={13} />
            ) : r.action === "relay" ? (
              <Icons.Inbox size={13} />
            ) : r.action === "mail" ? (
              <Icons.Mail size={13} />
            ) : r.action === "message" ? (
              <Icons.Send size={13} />
            ) : (
              <Icons.Terminal size={13} />
            )
          }
          label={t("routines.card.action", { action: t(ACTION_KEY[r.action]) })}
          title={
            r.action === "agent"
              ? t("routines.card.agentAnswers", { agent: props.agentName })
              : r.action === "watch"
                ? t("routines.card.watches", { agent: props.agentName })
                : r.action === "relay"
                  ? t("routines.card.relays", { agent: props.agentName })
                  : r.action === "mail"
                    ? t("routines.card.mails", { agent: props.agentName })
                    : r.action === "message"
                      ? t("routines.card.messageSent")
                      : t("routines.card.commandRuns")
          }
          strong
        >
          {r.action === "shell" ? <code>{r.pre_command}</code> : <span className="rtdetail__clip">{r.prompt}</span>}
          {r.pre_command &&
            r.action !== "shell" &&
            r.action !== "watch" &&
            r.action !== "relay" &&
            r.action !== "mail" && <Badge>{t("routines.card.cond", { cond: t(CALL_KEY[r.call_model]) })}</Badge>}
        </Card>
        {r.post_command && (
          <Card icon={<Icons.Terminal size={13} />} label={t("routines.card.after")} title={t("routines.card.command")}>
            <code>{r.post_command}</code>
          </Card>
        )}
      </div>
      {r.action !== "shell" && (
        <div className="rtdetail__prompt">
          <span className="rtdetail__label">
            {r.action === "message" ? t("routines.step.message") : t("routines.prompt")}
          </span>
          <p>{r.prompt}</p>
        </div>
      )}
      <section className="rtdetail__runs" aria-label={t("routines.activations")}>
        <div className="rtdetail__runshead">
          <span className="rtdetail__label">{t("routines.activations")}</span>
          {judged.length > 0 && (
            <span className="rtdetail__skipped">{t("routines.skippedOf", { n: skipped, m: judged.length })}</span>
          )}
        </div>
        <ActivationBars routine={r} runs={runs} large />
        {runs?.length === 0 && <p className="rtdetail__empty">{t("routines.noRuns")}</p>}
        {runs?.map((x) => (
          <button key={x.run_id} type="button" className="rtrun" onClick={() => props.onOpen(x)}>
            <RunLine run={x} action={r.action} />
            <Icons.ChevronRight size={14} className="rtrun__go" />
          </button>
        ))}
      </section>
    </>
  );
}

/** One activation as a line: its outcome's bar, when, what came of it and how long it took. */
function RunLine({ run: x, action }: { run: RoutineRun; action: Routine["action"] }) {
  const t = useT();
  const bar = barOf(x, action);
  return (
    <span className="rtrun__line">
      <span className={`rtbar ${bar}`} />
      <span className="rtrun__when">{shortWhen(x.started_at)}</span>
      <Badge tone={bar === "is-failed" ? "danger" : bar === "is-skipped" ? "neutral" : "brand"}>
        {t(bar === "is-told" ? "routines.legend.ran" : barKey(x, action))}
      </Badge>
      {x.delivered && <Badge tone="info">{t("routines.told")}</Badge>}
      <span className="board__spacer" />
      {x.ended_at && (
        <span className="rtrun__dur">{formatSeconds((Date.parse(x.ended_at) - Date.parse(x.started_at)) / 1000)}</span>
      )}
    </span>
  );
}

function Card(props: { icon: ReactNode; label: string; title: string; strong?: boolean; children?: ReactNode }) {
  return (
    <div className={`rtcard${props.strong ? " is-strong" : ""}`}>
      <span className="rtcard__label">
        {props.icon}
        {props.label}
      </span>
      <span className="rtcard__title">{props.title}</span>
      {props.children && <span className="rtcard__body">{props.children}</span>}
    </div>
  );
}

function RunTranscript({ threadId }: { threadId: string }) {
  const thread = useData((s) => s.threads[threadId]);
  const load = useData((s) => s.threadLoad[threadId]);
  useEffect(() => {
    if (load == null) void loadThread(threadId);
  }, [load, threadId]);
  return <div className="rtdrawer__chat">{thread && load === "ready" && <Transcript thread={thread} />}</div>;
}
