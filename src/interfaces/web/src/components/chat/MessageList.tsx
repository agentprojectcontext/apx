import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { Empty } from "../ui";
import { t } from "../../i18n";
import type { ChatMsg } from "../../hooks/useChat";

interface Props {
  msgs: ChatMsg[];
  onCopy: (text: string) => void;
}

export function MessageList({ msgs, onCopy }: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  if (msgs.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <Empty>{t("project.chat.empty")}</Empty>
      </div>
    );
  }

  const lastIdx = msgs.length - 1;
  return (
    <div className="space-y-4 px-3 py-4">
      {msgs.map((m, i) => (
        <MessageBubble
          key={i}
          msg={m}
          isLast={i === lastIdx}
          isAskAnswer={isAnswerToAsk(msgs, i)}
          onCopy={onCopy}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// A user message is an "ask answer" when the preceding assistant turn ended on
// an ask_questions tool call (its last tool part). The InlineAskPanel compiles
// the user's picks into a single text reply, which we then render as a centered
// full-width card instead of the standard right-aligned user bubble.
function isAnswerToAsk(msgs: ChatMsg[], i: number): boolean {
  const m = msgs[i];
  if (!m || m.role !== "user") return false;
  const prev = msgs[i - 1];
  if (!prev || prev.role !== "assistant") return false;
  for (let j = prev.parts.length - 1; j >= 0; j--) {
    const p = prev.parts[j];
    if (p.kind === "tool") return p.tool === "ask_questions";
  }
  return false;
}
