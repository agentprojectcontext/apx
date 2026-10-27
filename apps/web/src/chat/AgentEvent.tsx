import "./AgentEvent.css";
import type { Agent, Message } from "@apx/protocol";
import { Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { responseOf } from "./agentEvent.ts";
import { responseStatus, responseTitle } from "./responseStatus.ts";

/** Reports are events in the holder's chat, never extra conversation participants. */
export function AgentEvent({ message, agent, children }: { message: Message; agent?: Agent; children: ReactNode }) {
  const t = useT();
  const response = responseOf(message);
  const projectId = response?.project_id;
  const project = useData((s) => s.projects.find((p) => p.id === projectId)?.name);
  const name = agent?.name ?? t("chat.theAgent");
  return (
    <details className="transcript__agent-event" open>
      <summary>
        <Icons.ChevronRight size={14} />
        <Icons.Bot size={14} />
        <span>{t(response ? responseTitle(response) : "chat.agentMessage", { name })}</span>
        {project && <span>{project}</span>}
        {response && <span className="transcript__event-state">{t(responseStatus(response).label)}</span>}
      </summary>
      {response && (
        <button type="button" className="transcript__event-source" onClick={() => go.subthread(response.thread_id)}>
          {response.title} · {t("subthread.open", { name })}
        </button>
      )}
      <div className="transcript__event-body">{children}</div>
    </details>
  );
}
