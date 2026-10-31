import "../styles/pages.css";
import { secureRequestKey } from "@apx/protocol/client";
import { Skeleton } from "@apx/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { htmlPreviewDoc, isPreviewHeight } from "../chat/htmlPreview.ts";
import { loadSurfaceDoc } from "../data/actions.ts";
import { useData } from "../data/state.ts";

/** A runaway page never makes the frame endless: past this it scrolls inside. */
const MAX_CONTENT = 4000;

/**
 * A web page an agent made, as a browser shows it: its own styles on a light page, its inline code running in a
 * sandboxed frame that reaches neither APX nor the web. `content` takes the page's height up to `maxHeight` and scrolls
 * inside past it; `fill` takes its box and the page scrolls as in a browser window. `width` lays it out at that width.
 */
export function PageFrame({
  surfaceId,
  fit = "content",
  maxHeight = MAX_CONTENT,
  width,
}: {
  surfaceId: string;
  fit?: "content" | "fill";
  maxHeight?: number;
  width?: number;
}) {
  const summary = useData((s) => s.surfaces[surfaceId]);
  const doc = useData((s) => s.surfaceDocs[surfaceId]);
  const frame = useRef<HTMLIFrameElement>(null);
  const nonce = useMemo(() => secureRequestKey(), []);
  const [height, setHeight] = useState(160);
  const stale = !doc || (summary != null && summary.version > doc.version);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the summary version moves
  useEffect(() => {
    if (stale) void loadSurfaceDoc(surfaceId);
  }, [surfaceId, stale, summary?.version]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !isPreviewHeight(e.data, nonce)) return;
      setHeight(Math.max(40, Math.round(e.data.height)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce]);
  const srcDoc = useMemo(() => (doc ? htmlPreviewDoc(doc.html, nonce, { scripts: true }) : undefined), [doc, nonce]);
  const style = {
    ...(fit === "content" ? { height: Math.min(height, maxHeight) } : {}),
    ...(width ? { width } : {}),
  };
  return (
    <div className={`pageframe pageframe--${fit}${width ? " pageframe--sized" : ""}`}>
      {srcDoc ? (
        <iframe
          ref={frame}
          title={summary?.title ?? ""}
          className="pageframe__iframe"
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          // Light, as edit mode draws it, whatever APX's own mode: the page's dark styles do not half-apply.
          style={{ ...style, colorScheme: "light" }}
        />
      ) : (
        <Skeleton shape="block" height={fit === "fill" ? "100%" : 160} />
      )}
    </div>
  );
}
