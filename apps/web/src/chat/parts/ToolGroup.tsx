import type { Part } from "@apx/protocol";
import { ActionGroup, type ActionItem, Icons, Spinner } from "@apx/ui";
import { useT } from "../../i18n/index.ts";
import { ComputerIcon } from "./ComputerIcon.tsx";

type ToolPart = Extract<Part, { type: "tool" }>;

const STATUS = { running: "running", ok: "done", error: "failed" } as const;

/**
 * Tool calls folded like the design's "Actions 1–N of N" group. While the run waits on the owner (a question, a
 * confirmation, a browser tab handed over) it says so instead of "working".
 */
export function ToolGroup({ parts, waiting = false }: { parts: ToolPart[]; waiting?: boolean }) {
  const t = useT();
  const n = parts.length;
  const failed = parts.filter((p) => p.status === "error").length;
  const running = parts.some((p) => p.status === "running");
  // Computer use reads as one thing: the agent controlling the computer, not a list of pictures.
  const computer = parts.length > 0 && parts.every((p) => p.tool.startsWith("screen_"));
  const items: ActionItem[] = parts.map((p) => ({
    name: p.tool,
    detail: p.title,
    status: STATUS[p.status],
  }));
  return (
    <ActionGroup
      className="turn__tools"
      title={
        computer
          ? t(running && !waiting ? "tools.computer.working" : running ? "tools.waiting" : "tools.computer.done", { n })
          : running
            ? t(waiting ? "tools.waiting" : "tools.working", { n })
            : t("tools.summary", { n })
      }
      icon={
        computer ? (
          <ComputerIcon busy={running && !waiting} done={!running} size={16} />
        ) : running ? (
          waiting ? (
            <Icons.Hand size={14} />
          ) : (
            <Spinner size={14} />
          )
        ) : undefined
      }
      failed={failed}
      failedLabel={failed === 1 ? t("tools.failed.one") : t("tools.failed.other")}
      items={items}
    />
  );
}
