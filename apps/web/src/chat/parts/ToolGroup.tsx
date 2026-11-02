import type { Part } from "@apx/protocol";
import { ActionGroup, type ActionItem, Icons, Spinner } from "@apx/ui";
import type { ReactNode } from "react";
import { duration } from "../../common/format.ts";
import { useT } from "../../i18n/index.ts";
import { ComputerIcon } from "./ComputerIcon.tsx";
import { stepLabel, type ToolKind, toolKind } from "./toolKind.ts";

type ToolPart = Extract<Part, { type: "tool" }>;

const STATUS = { running: "running", ok: "done", error: "failed" } as const;

const ICON: Record<ToolKind, ReactNode> = {
  web: <Icons.Globe />,
  read: <Icons.FileText />,
  write: <Icons.SquarePen />,
  memory: <Icons.Brain />,
  command: <Icons.Terminal />,
  computer: <Icons.Monitor />,
  message: <Icons.MessageCircle />,
  mail: <Icons.Mail />,
  calendar: <Icons.Calendar />,
  agents: <Icons.Users />,
  task: <Icons.ListChecks />,
  widget: <Icons.LayoutGrid />,
  image: <Icons.Image />,
  file: <Icons.Paperclip />,
  phone: <Icons.Smartphone />,
  ask: <Icons.Hand />,
  flow: <Icons.GitBranch />,
  settings: <Icons.Settings />,
  skill: <Icons.Sparkles />,
  tool: <Icons.Wrench />,
};

/**
 * Tool calls folded into one group: "4 steps · 12 s" once done, the time its steps took (older answers kept none). While
 * the run waits on the owner (a question, a confirmation, a browser tab handed over) it says so instead of "working".
 * Each step is the icon of its kind of action and what it did, in words; only a failed one is marked.
 */
export function ToolGroup({ parts, waiting = false }: { parts: ToolPart[]; waiting?: boolean }) {
  const t = useT();
  const n = parts.length;
  const failed = parts.filter((p) => p.status === "error").length;
  const running = parts.some((p) => p.status === "running");
  // Computer use reads as one thing: the agent controlling the computer, not a list of pictures.
  const computer = parts.length > 0 && parts.every((p) => p.tool.startsWith("screen_"));
  const steps = n === 1 ? t("tools.steps.one") : t("tools.steps.other", { n });
  const took = parts.some((p) => p.ms !== undefined) ? parts.reduce((sum, p) => sum + (p.ms ?? 0), 0) : undefined;
  const items: ActionItem[] = parts.map((p) => ({
    name: stepLabel(p.tool, p.title),
    icon: ICON[toolKind(p.tool)],
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
            : took === undefined
              ? steps
              : t("tools.stepsTook", { steps, time: duration(took) })
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
        ) : null
      }
      failed={failed}
      failedLabel={failed === 1 ? t("tools.failed.one") : t("tools.failed.other")}
      items={items}
    />
  );
}
