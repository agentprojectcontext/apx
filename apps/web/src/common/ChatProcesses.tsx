import { Spinner } from "@apx/ui";
import { activeCommandsOf } from "../data/jobs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

/** Separate process activity from the agent's turn state. */
export function ChatProcesses({ thread, onOpen }: { thread: string; onOpen?: () => void }) {
  const t = useT();
  const count = useData((s) => activeCommandsOf(s.jobs.running, thread).length);
  if (!count) return null;
  const label = t("chat.activeProcesses", { n: count });
  const content = (
    <>
      <Spinner size={12} />
      <span>{count}</span>
    </>
  );
  return onOpen ? (
    <button type="button" className="chatprocesses" aria-label={label} title={label} onClick={onOpen}>
      {content}
    </button>
  ) : (
    <span className="chatprocesses" role="img" aria-label={label} title={label}>
      {content}
    </span>
  );
}
