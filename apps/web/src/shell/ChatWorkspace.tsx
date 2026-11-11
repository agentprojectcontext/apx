import { Skeleton } from "@apx/ui";
import { type ReactNode, Suspense } from "react";
import { ChatView } from "../chat/ChatView.tsx";
import { InboxList } from "../inbox/InboxList.tsx";
import { soleFilter, useInboxFilter } from "../inbox/inboxFilter.ts";
import { ContactPick, RoutineChat } from "../lazy.ts";
import { SidePanel } from "../panel/SidePanel.tsx";
import { ListColumn } from "./ListColumn.tsx";
import type { Layout } from "./layout.ts";
import { useNav } from "./nav.ts";

/** Chat list · chat · side panel. The Inbox, a project's Chats tab and an engine's sessions share it. */
export function ChatWorkspace({ layout, list = <InboxList /> }: { layout: Layout; list?: ReactNode }) {
  const panel = useNav((s) => s.panel);
  const listInFront = useNav((s) => s.listInFront);
  const threadId = useNav((s) => s.threadId);
  // A routine's runs open as one chat in the Inbox, in place of a thread.
  const routineId = useNav((s) => (s.view === "inbox" && !s.threadId ? s.routineId : undefined));
  // A contact with no chat yet, picked in the list of the account the Inbox is narrowed to.
  const contactId = useNav((s) => (s.view === "inbox" && !s.threadId && !s.routineId ? s.contactId : undefined));
  const accountId = useInboxFilter((f) => {
    const sole = soleFilter(f);
    return sole?.kind === "accounts" ? sole.id : undefined;
  });
  const contact = contactId && accountId ? { personId: contactId, channelId: accountId } : undefined;
  const chat = (wideHeader: boolean, compact: boolean) =>
    contact ? (
      <Suspense fallback={<ChatLoading />}>
        <ContactPick personId={contact.personId} channelId={contact.channelId} />
      </Suspense>
    ) : routineId ? (
      <Suspense fallback={<ChatLoading />}>
        <RoutineChat routineId={routineId} wideHeader={wideHeader} compact={compact} />
      </Suspense>
    ) : (
      <ChatView wideHeader={wideHeader} compact={compact} />
    );
  if (layout.compact)
    return (
      <div className="workspace">
        {listInFront || !(threadId || routineId || contact) ? list : panel != null ? <SidePanel /> : chat(false, true)}
      </div>
    );
  return (
    <div className={layout.panelFloat ? "workspace is-panelfloat" : "workspace"}>
      {layout.listW > 0 && <ListColumn width={layout.listW}>{list}</ListColumn>}
      {chat(layout.wideHeader, false)}
      {panel != null && <SidePanel />}
    </div>
  );
}

function ChatLoading() {
  return (
    <section className="chat" aria-busy="true">
      <div className="chat__header">
        <Skeleton shape="circle" width={32} />
        <Skeleton width={180} />
      </div>
    </section>
  );
}
