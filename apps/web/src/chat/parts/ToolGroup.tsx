import type { Part } from "@apx/protocol";
import { ActionGroup, type ActionItem, Spinner } from "@apx/ui";

type ToolPart = Extract<Part, { type: "tool" }>;

const STATUS = { running: "running", ok: "done", error: "failed" } as const;

/** Tool calls folded like the design's "Acciones 1–N de N" group. */
export function ToolGroup({ parts }: { parts: ToolPart[] }) {
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
      title={running ? `Trabajando · acción ${n}` : `Acciones 1–${n} de ${n}`}
      icon={running ? <Spinner size={14} /> : undefined}
      failed={failed}
      failedLabel={failed === 1 ? "falló" : "fallaron"}
      items={items}
    />
  );
}
