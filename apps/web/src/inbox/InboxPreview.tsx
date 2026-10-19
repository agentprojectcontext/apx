import { ApxProvider } from "@apx/ui";
import { useState } from "react";
import { ChatHeader } from "../chat/ChatHeader.tsx";
import { data } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";
import { InboxList } from "./InboxList.tsx";
import { previewAgents, previewProjects, previewThreads } from "./previewData.ts";
import "./preview.css";

// This entry is served only by the opt-in development server, without a core proxy or live subscriptions.
data.set({
  ready: true,
  connection: "online",
  projects: previewProjects,
  agents: Object.fromEntries(previewAgents.map((a) => [a.id, a])),
  threads: Object.fromEntries(previewThreads.map((th) => [th.id, th])),
});

export default function InboxPreview() {
  const t = useT();
  const selected = useNav((s) => s.threadId);
  const panelAgent = useNav((s) => s.panelAgent);
  const thread = previewThreads.find((th) => th.id === selected);
  const [narrow, setNarrow] = useState(false);
  return (
    <ApxProvider mode="dark" fill>
      <main className="inboxpreview">
        <header className="inboxpreview__header">
          <h1>{t("inbox.preview.title")}</h1>
          <p>{t("inbox.preview.hint")}</p>
          <button type="button" onClick={() => setNarrow(!narrow)}>
            {t(narrow ? "inbox.preview.wide" : "inbox.preview.narrow")}
          </button>
        </header>
        <div className={`inboxpreview__panel${narrow ? " is-narrow" : ""}`}>
          <InboxList />
        </div>
        {thread && (
          <ChatHeader
            thread={thread}
            agent={previewAgents.find((a) => a.id === thread.agent_ids[0])}
            wide={false}
            compact
          />
        )}
        {panelAgent && (
          <p className="inboxpreview__agent">
            {t("agent.openPanel", { name: previewAgents.find((a) => a.id === panelAgent)?.name ?? panelAgent })}
          </p>
        )}
        <output className="inboxpreview__selection">
          {t("inbox.preview.selected", {
            name: selected ? (previewThreads.find((th) => th.id === selected)?.title ?? selected) : "—",
          })}
        </output>
      </main>
    </ApxProvider>
  );
}
