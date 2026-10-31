import { Skeleton, useApx } from "@apx/ui";
import mermaid from "mermaid";
import { type ReactNode, useEffect, useState } from "react";

// A system font both where Mermaid measures its labels (this page) and where the picture is drawn (an <img>, which
// cannot use the page's web fonts), so the words fit their boxes.
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
let seq = 0;

/** The diagram's own size, from its viewBox, so the picture keeps it (and shrinks to fit a narrow chat). */
function sizeOf(svg: string): { width: number; height: number } | undefined {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  const width = Number(box?.[1]);
  const height = Number(box?.[2]);
  return width > 0 && height > 0 ? { width: Math.ceil(width), height: Math.ceil(height) } : undefined;
}

/**
 * A ```mermaid block drawn as a picture. Mermaid runs in strict mode (no scripts or HTML in labels), and the result
 * shows as an <img>, where nothing in it can run. While the agent is still writing, or when the code is not a
 * diagram, its code shows instead (`fallback`) under a line saying so.
 */
export function MermaidDiagram({
  code,
  label,
  failed,
  fallback,
}: {
  code: string;
  label: string;
  failed: string;
  fallback: ReactNode;
}) {
  const { mode } = useApx();
  const [drawn, setDrawn] = useState<{ svg: string } | "failed">();
  useEffect(() => {
    let stop = false;
    // A block still being written changes on every word; it is drawn once it settles.
    const timer = setTimeout(async () => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: mode === "dark" ? "dark" : "neutral",
        fontFamily: FONT,
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      });
      try {
        const { svg } = await mermaid.render(`apx-mermaid-${++seq}`, code);
        if (!stop) setDrawn({ svg });
      } catch {
        if (!stop) setDrawn("failed");
      }
    }, 250);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [code, mode]);
  if (drawn === "failed")
    return (
      <div className="codeblock__failed">
        <p className="codeblock__note">{failed}</p>
        {fallback}
      </div>
    );
  if (!drawn) return <Skeleton shape="block" height={160} />;
  const size = sizeOf(drawn.svg);
  return (
    <div className="codeblock__diagram">
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`}
        alt={label}
        width={size?.width}
        height={size?.height}
      />
    </div>
  );
}
