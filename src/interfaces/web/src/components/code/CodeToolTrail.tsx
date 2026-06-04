import { Wrench } from "lucide-react";

interface Props {
  tools: string[];
}

// Compact trail of tools the super-agent invoked during the in-flight turn.
// A coding turn typically reads/edits files and runs commands via tools, so we
// surface that activity (unlike the RobyBubble, which hides it) — it gives the
// owner a sense of what the coding assistant is doing while it streams.
export function CodeToolTrail({ tools }: Props) {
  if (!tools.length) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 pb-1 text-[11px] text-muted-fg"
      data-testid="code-tool-trail"
    >
      <Wrench size={11} className="shrink-0" />
      {tools.map((tool, i) => (
        <span
          key={`${tool}-${i}`}
          className="inline-flex items-center rounded-md border border-border bg-card/60 px-1.5 py-0.5 font-mono"
        >
          {tool}
        </span>
      ))}
    </div>
  );
}
