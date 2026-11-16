import type { SetupPrepare } from "@apx/protocol";
import { AgentAvatar, Icons, Skeleton, Spinner } from "@apx/ui";
import { useEffect, useState } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { loadThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { blobOf, secretary } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import { StepHead } from "./StepsIntro.tsx";

type Item = SetupPrepare["items"][number];
/** How often the list asks again while something is still downloading. */
const POLL_MS = 1500;
const HOME = "home";

const LABEL: Record<Item["id"], MessageKey> = {
  memory: "setup.prepare.memory",
  voice: "setup.prepare.voice",
  images: "setup.prepare.images",
};
const REASON: Record<NonNullable<Item["reason"]>, MessageKey> = {
  "no-ollama": "setup.prepare.noOllama",
  machine: "setup.prepare.noVoice",
  "no-chatgpt": "setup.prepare.noChatgpt",
};

/**
 * The last step of a simple setup: what APX leaves ready on its own, as it gets there, beside a chat with the agent,
 * who greets the owner and asks who they are while the downloads run. A narrow window puts the chat first.
 */
export function MeetStep({ name }: { name: string }) {
  const t = useT();
  return (
    <div className="meet">
      <div className="meet__side">
        <StepHead
          kicker="setup.step.meet"
          title={t("setup.meet.title")}
          end={t("setup.meet.titleGreen", { name })}
          green
        >
          {t("setup.meet.body", { name })}
        </StepHead>
        <PrepareList />
      </div>
      <AgentChat />
    </div>
  );
}

/** Each part with where it stands; asks again while anything is still working. */
function PrepareList() {
  const t = useT();
  const [s, setS] = useState<SetupPrepare>();
  const busy = !s || s.items.some((i) => i.state === "working" || i.state === "waiting");
  useEffect(() => {
    let live = true;
    const read = () =>
      client
        .call(s?.started ? "setup.prepare_status" : "setup.prepare", {})
        .then((r) => live && setS(r))
        .catch(() => {});
    void read();
    if (!busy) return;
    const id = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [busy, s?.started]);
  return (
    <ul className="meet__list" aria-live="polite">
      {(s?.items ?? []).map((i) => (
        <li key={i.id} className={`meet__item is-${i.state}`}>
          <span className="meet__mark">
            {i.state === "done" ? (
              <Icons.CircleCheck size={16} />
            ) : i.state === "working" || i.state === "waiting" ? (
              <Spinner size={14} />
            ) : i.state === "failed" ? (
              <Icons.TriangleAlert size={16} />
            ) : (
              <Icons.X size={16} />
            )}
          </span>
          <span className="meet__itemmain">
            <b>{t(LABEL[i.id])}</b>
            <span>
              {i.state === "done"
                ? i.detail
                  ? t("setup.prepare.doneWith", { detail: i.detail })
                  : t("setup.prepare.done")
                : i.state === "failed"
                  ? t("setup.prepare.failed", { error: i.error ?? "" })
                  : i.state === "skipped" && i.reason
                    ? t(REASON[i.reason])
                    : i.progress != null
                      ? t("setup.prepare.progress", { n: Math.round(i.progress * 100) })
                      : t("setup.prepare.working")}
            </span>
            {i.state === "working" && i.progress != null && (
              <span className="meet__bar">
                <span style={{ width: `${Math.round(i.progress * 100)}%` }} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The agent's chat, floating beside the list: its greeting first, then whatever the owner says. */
function AgentChat() {
  const lang = useLanguage();
  const agents = useData((s) => s.agents);
  const agent = secretary(agents);
  const thread = useData((s) => s.threads[HOME]);
  const load = useData((s) => s.threadLoad[HOME]);
  const [greeted, setGreeted] = useState(false);
  useEffect(() => {
    void client
      .call("setup.greet", { language: lang })
      .catch(() => undefined)
      .then(() => loadThread(HOME))
      .finally(() => setGreeted(true));
  }, [lang]);
  return (
    <section className="meet__chat" aria-label={agent?.name}>
      <header className="meet__chathead">
        <AgentAvatar name={agent?.name ?? "APX"} blob={blobOf(agent)} size={32} status="online" />
        <b>{agent?.name}</b>
      </header>
      <div className="meet__chatbody">
        {thread && greeted && load === "ready" ? (
          <Transcript thread={thread} />
        ) : (
          <Skeleton className="meet__skeleton" />
        )}
      </div>
      {thread && <ChatComposer thread={thread} agent={agent} offlineHint={false} />}
    </section>
  );
}
