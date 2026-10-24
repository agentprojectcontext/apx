import "../styles/computer.css";
import { Icons } from "@apx/ui";
import { useEffect } from "react";
import { data } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";

/** How long a chat shows the computer ready before the chip goes. */
const READY_SHOWN_MS = 4000;

export type ComputerStage = "creating" | "loading" | "ready";

/** While the computer this chat's agent started comes up: set up the first time, booting, then ready for a moment. */
function ComputerProgressBody({ stage }: { stage: ComputerStage }) {
  const t = useT();
  return (
    <div className={`chat__computer is-${stage}`} role="status">
      {stage === "ready" ? <Icons.Check size={13} /> : <span className="chat__computerdot" aria-hidden="true" />}
      {t(`computer.progress.${stage}`)}
    </div>
  );
}

/** Its strings come with the computer's pack, loaded only when a chat waits on it. */
export function ComputerProgress(props: { stage: ComputerStage; thread: string }) {
  const { stage, thread } = props;
  // Ready shows a moment, then the chat is clear again.
  useEffect(() => {
    if (stage !== "ready") return;
    const timer = setTimeout(() => {
      data.set((s) => {
        if (s.computerProgress[thread] !== "ready") return s;
        const { [thread]: _done, ...rest } = s.computerProgress;
        return { computerProgress: rest };
      });
    }, READY_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [stage, thread]);
  return usePack("computer") ? <ComputerProgressBody stage={stage} /> : null;
}
