import "../styles/panel-parts.css";
import { IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { Drawer } from "../common/Drawer.tsx";
import { loadThread } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

/**
 * The chat that goes through the notes with an agent, beside the Memory list: the list stays in view while the agent
 * proposes and changes notes, and reads again as they change.
 */
export function MemoryReviewChat({
  threadId,
  back,
  onClose,
  onOpen,
  onRestart,
}: {
  threadId: string;
  /** Opened from a note: back to that note's panel. */
  back?: (() => void) | undefined;
  onClose: () => void;
  /** Opened whole: it is the owner's chat now, kept even with nothing sent yet. */
  onOpen: () => void;
  onRestart: () => void;
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
      docked
      className="widgetchat memreview"
      label={t("memory.review.drawer", { name })}
      title={t("memory.review.drawer", { name })}
      onClose={onClose}
      {...(back ? { back: { label: t("memory.review.back"), onClick: back } } : {})}
      actions={
        <>
          <IconButton
            size="sm"
            label={t("memory.review.new")}
            icon={<Icons.RotateCcw size={14} />}
            onClick={onRestart}
          />
          <IconButton
            size="sm"
            label={t("memory.review.open")}
            icon={<Icons.ExternalLink size={14} />}
            onClick={onOpen}
          />
        </>
      }
    >
      <div className="widgetchat__chat">
        {load === "ready" && empty ? (
          <p className="memreview__hint">{t("memory.review.hint", { name })}</p>
        ) : load === "ready" ? (
          <Transcript thread={thread} />
        ) : (
          load !== "error" && <Skeleton height={120} />
        )}
      </div>
      <ChatComposer thread={thread} agent={agent} onNew={go.thread} />
    </Drawer>
  );
}
