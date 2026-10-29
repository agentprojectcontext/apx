import { IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { Drawer } from "../common/Drawer.tsx";
import { loadThread } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

/**
 * The chat with the super-agent about the open Flow, floating over the canvas where the step card goes: the owner asks
 * for a change and watches the steps appear behind it.
 */
export function FlowChat({
  threadId,
  notice,
  onClose,
  onRestart,
  prepare,
}: {
  threadId: string;
  /** Why the last message didn't go. */
  notice: string | undefined;
  onClose: () => void;
  onRestart: () => void;
  prepare: (words: string) => Promise<string | null>;
}) {
  const t = useT();
  const thread = useData((s) => s.threads[threadId]);
  const load = useData((s) => s.threadLoad[threadId]);
  const empty = useData((s) => !s.messages[threadId]?.length);
  const agent = useData((s) => (thread ? s.agents[thread.agent_ids[0] ?? ""] : undefined));
  useEffect(() => {
    if (load == null) void loadThread(threadId);
  }, [threadId, load]);
  if (!thread) return null;
  const name = agent?.name ?? "";
  return (
    <Drawer
      inset
      className="fe-card widgetchat fe-chat"
      label={t("flow.chat.label", { name })}
      title={t("flow.chat.title", { name })}
      onClose={onClose}
      actions={
        <IconButton size="sm" label={t("flow.chat.new")} icon={<Icons.RotateCcw size={14} />} onClick={onRestart} />
      }
    >
      <div className="widgetchat__chat">
        {load === "ready" && empty ? (
          <p className="fe-chat__hint">{t("flow.chat.hint", { name })}</p>
        ) : load === "ready" ? (
          <Transcript thread={thread} />
        ) : (
          load !== "error" && <Skeleton height={120} />
        )}
      </div>
      {notice && (
        <p className="fe-chat__notice" role="alert">
          {notice}
        </p>
      )}
      <ChatComposer thread={thread} agent={agent} prepare={prepare} />
    </Drawer>
  );
}
