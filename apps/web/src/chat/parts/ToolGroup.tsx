import type { Part } from "@apx/protocol";
import { ActionGroup, type ActionItem, Spinner } from "@apx/ui";
import { useT } from "../../i18n/index.ts";

type ToolPart = Extract<Part, { type: "tool" }>;

const STATUS = { running: "running", ok: "done", error: "failed" } as const;

/** Tool calls folded like the design's "Actions 1–N of N" group. */
export function ToolGroup({ parts }: { parts: ToolPart[] }) {
  const t = useT();
  const n = parts.length;
  const failed = parts.filter((p) => p.status === "error").length;
  const running = parts.some((p) => p.status === "running");
  const items: ActionItem[] = parts.map((p) => ({
    name: p.tool,
    detail: p.title,
    status: STATUS[p.status],
  }));
  return (
    <ActionGroup
      className="turn__tools"
      title={running ? t("tools.working", { n }) : t("tools.summary", { n })}
      icon={running ? <Spinner size={14} /> : undefined}
      failed={failed}
      failedLabel={failed === 1 ? t("tools.failed.one") : t("tools.failed.other")}
      items={items}
    />
  );
}
