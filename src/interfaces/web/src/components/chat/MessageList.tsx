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
        <MessageBubble key={i} msg={m} isLast={i === lastIdx} onCopy={onCopy} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
