import "../styles/computer.css";
import { Icons } from "@apx/ui";
import { usePack, useT } from "../i18n/index.ts";

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
export function ComputerProgress(props: { stage: ComputerStage }) {
  return usePack("computer") ? <ComputerProgressBody {...props} /> : null;
}
