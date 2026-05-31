import { useMemo } from "react";
import { cn } from "../../lib/cn";

// Minimal unified-diff renderer for the Code module's Changes tab. No external
// dependency — we parse the `git diff` patch the daemon returns and colour
// added/removed/hunk lines. File-header noise (diff --git / index / +++ / ---)
// is dropped since the file path is shown by the parent.
interface Props {
  patch: string;
}

type Line = { kind: "add" | "del" | "hunk" | "ctx"; text: string };

function parse(patch: string): Line[] {
  const out: Line[] = [];
  for (const raw of (patch || "").split("\n")) {
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("similarity index") ||
      raw.startsWith("rename ")
    ) {
      continue;
    }
    if (raw.startsWith("@@")) out.push({ kind: "hunk", text: raw });
    else if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1) });
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1) });
    else out.push({ kind: "ctx", text: raw.replace(/^ /, "") });
  }
  // Trim a trailing empty context line that git's split tends to leave.
  while (out.length && out[out.length - 1].kind === "ctx" && out[out.length - 1].text === "") {
    out.pop();
  }
  return out;
}

export function DiffView({ patch }: Props) {
  const lines = useMemo(() => parse(patch), [patch]);
  if (!lines.length) return null;
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-background/60 font-mono text-[11px] leading-relaxed">
      <code className="block">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "px-2 whitespace-pre",
              l.kind === "add" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              l.kind === "del" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
              l.kind === "hunk" && "bg-muted/60 text-muted-foreground",
              l.kind === "ctx" && "text-foreground/70",
            )}
          >
            <span className="select-none opacity-50">
              {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
            </span>
            {l.text}
          </div>
        ))}
      </code>
    </pre>
  );
}
