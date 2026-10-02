import type { ReactNode } from "react";
import { ChatView } from "../chat/ChatView.tsx";
import { InboxList } from "../inbox/InboxList.tsx";
import { SidePanel } from "../panel/SidePanel.tsx";
import type { Layout } from "./layout.ts";
import { useNav } from "./nav.ts";

/** Chat list · chat · side panel. The Inbox, a project's Chats tab and an engine's sessions share it. */
export function ChatWorkspace({ layout, list = <InboxList /> }: { layout: Layout; list?: ReactNode }) {
  const panel = useNav((s) => s.panel);
  const listInFront = useNav((s) => s.listInFront);
  const threadId = useNav((s) => s.threadId);
  if (layout.compact)
    return (
      <div className="workspace">
        {listInFront || !threadId ? list : panel != null ? <SidePanel /> : <ChatView wideHeader={false} compact />}
      </div>
    );
  return (
    <div className="workspace">
      {layout.listW > 0 && list}
      <ChatView wideHeader={layout.wideHeader} />
      {panel != null && <SidePanel />}
    </div>
  );
}
