import type { Message, Part, Thread } from "@apx/protocol";
import { EmptyState, Icons } from "@apx/ui";
import { ChangesPart } from "../chat/parts/ChangesPart.tsx";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

const EMPTY: Message[] = [];

/** Recorded edits stay visible even when the chat has no project folder to inspect. */
export function ReportedChangesPanel({ thread, embedded = false }: { thread: Thread; embedded?: boolean }) {
  const t = useT();
  const messages = useData((s) => s.messages[thread.id] ?? EMPTY);
  const changes = messages.flatMap((message) =>
    message.parts.flatMap((part, i) =>
      part.type === "changes" ? [{ key: `${message.id}:${i}`, part: part as Extract<Part, { type: "changes" }> }] : [],
    ),
  );
  if (embedded && !changes.length) return null;
  return (
    <div className={embedded ? "processes" : "sidepanel__body processes"}>
      {changes.length ? (
        changes.map(({ key, part }) => <ChangesPart key={key} part={part} />)
      ) : (
        <EmptyState icon={<Icons.FileDiff />} title={t("changes.reportedEmpty")} />
      )}
    </div>
  );
}
