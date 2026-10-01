import { ChatView } from "../chat/ChatView.tsx";
import { InboxList } from "../inbox/InboxList.tsx";
import { SidePanel } from "../panel/SidePanel.tsx";
import type { Layout } from "./layout.ts";
import { useNav } from "./nav.ts";

/** Chat list · chat · side panel. The Inbox and a project's Chats tab share it. */
export function ChatWorkspace({ layout }: { layout: Layout }) {
  const panel = useNav((s) => s.panel);
  return (
    <div className="workspace">
      {layout.listW > 0 && <InboxList />}
      <ChatView wideHeader={layout.wideHeader} />
      {panel != null && <SidePanel />}
    </div>
  );
}
