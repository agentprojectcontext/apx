import type { Result } from "@apx/protocol";
import { Button, Icons, Popover, Textarea } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { blank } from "./drawing.ts";
import { type FlowGraph, triggerOf } from "./steps.tsx";

export type TryStep = Result<"flows.try_graph">["steps"][number];

/** Sample data through the drawing, branches and all, as a run would check it; nothing is saved or sent. */
export function TryRun({
  graph,
  tidy: tidied,
  onResult,
}: {
  graph: FlowGraph;
  tidy: () => FlowGraph;
  onResult: (r: Map<string, TryStep> | null) => void;
}) {
  const t = useT();
  const timed = triggerOf(graph)?.kind === "schedule";
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState<string>();
  const [answer, setAnswer] = useState("");
  const text = sample ?? (timed ? "{}" : '{\n  "type": "lead"\n}');
  const go = async () => {
    if (!triggerOf(graph)) return setAnswer(t("flow.ed.needTrigger"));
    if (graph.nodes.some(blank)) return setAnswer(t("flow.ed.tryNeedsShape"));
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return setAnswer(t("flow.ed.tryBadJson"));
    }
    try {
      const drawn = tidied();
      const { steps } = await client.call("flows.try_graph", { graph: drawn, data });
      onResult(new Map(steps.map((s) => [s.node, s])));
      const name = (id: string) => drawn.nodes.find((n) => n.id === id)?.label ?? id;
      const missing = steps.find((s) => s.state === "missing");
      const work = steps.filter((s) => s.state === "would_run").map((s) => name(s.node));
      setAnswer(
        missing
          ? t("flow.ed.tryMissing", { step: name(missing.node) })
          : work.length
            ? t("flow.ed.tryWould", { steps: work.join(", ") })
            : t("flow.ed.tryStop"),
      );
    } catch {
      setAnswer(t("flow.ed.tryFailed"));
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setAnswer("");
      }}
      align="end"
      width={340}
      label={t("flow.ed.tryTitle")}
      trigger={
        <Button variant="secondary" leadingIcon={<Icons.Play size={14} />} disabled={!graph.nodes.length}>
          {t("flow.ed.try")}
        </Button>
      }
    >
      <div className="fe-try">
        <strong>{t("flow.ed.tryTitle")}</strong>
        <p>{t(timed ? "flow.ed.tryHintTimed" : "flow.ed.tryHint")}</p>
        <Textarea
          aria-label={t("flow.ed.trySample")}
          rows={6}
          className="fe-mono"
          value={text}
          onChange={(e) => setSample(e.target.value)}
        />
        <Button size="sm" onClick={() => void go()}>
          {t("flow.ed.tryGo")}
        </Button>
        {answer && (
          <p className="fe-try__answer" role="status">
            {answer}
          </p>
        )}
      </div>
    </Popover>
  );
}
