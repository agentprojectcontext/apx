import { EmptyState, Icons, Skeleton, useApx } from "@apx/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadSurfaceDoc, surfacePrompt } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { LAYOUT } from "../shell/layout.ts";
import { buildSrcdoc, themeCss } from "./srcdoc.ts";

/** Minimum gap between two sendPrompt() calls from one widget. */
const PROMPT_GAP_MS = 1500;

export type SurfaceFrameProps = {
  surfaceId: string;
  /** content = auto-height (inline, panel); fill = take the parent's height (fullscreen app). */
  fit?: "content" | "fill";
  maxHeight?: number;
};

/**
 * Renders a surface's HTML in a sandboxed iframe (scripts only, opaque origin), themed with the current
 * --apx-* tokens. The widget talks back through postMessage: its height and window.apx.sendPrompt().
 */
export function SurfaceFrame({ surfaceId, fit = "content", maxHeight = LAYOUT.surfaceMaxH }: SurfaceFrameProps) {
  const summary = useData((s) => s.surfaces[surfaceId]);
  const doc = useData((s) => s.surfaceDocs[surfaceId]);
  const { mode } = useApx();
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [theme, setTheme] = useState<string>();
  const [height, setHeight] = useState(120);
  const nonce = useMemo(() => crypto.randomUUID(), []);
  const lastPrompt = useRef(0);

  const stale = !doc || (summary != null && summary.version > doc.version);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the summary version moves
  useEffect(() => {
    if (stale) void loadSurfaceDoc(surfaceId);
  }, [surfaceId, stale, summary?.version]);

  // Resolve tokens after the provider applied the new mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode is the trigger
  useLayoutEffect(() => {
    if (wrap.current) setTheme(themeCss(wrap.current));
  }, [mode]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== "null") return;
      const m = e.data as { apx?: unknown; kind?: unknown; height?: unknown; text?: unknown; gesture?: unknown };
      if (!m || m.apx !== nonce) return;
      if (m.kind === "height" && typeof m.height === "number" && Number.isFinite(m.height)) {
        setHeight(Math.max(40, Math.min(maxHeight, Math.round(m.height))));
      } else if (m.kind === "prompt" && typeof m.text === "string" && m.text.trim()) {
        // Only prompts that follow a real click/key inside the widget; scripts cannot send on their own.
        if (m.gesture !== true) return;
        const now = Date.now();
        if (now - lastPrompt.current < PROMPT_GAP_MS) return;
        lastPrompt.current = now;
        void surfacePrompt(surfaceId, m.text.trim());
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce, maxHeight, surfaceId]);

  const srcdoc = useMemo(
    () => (doc && theme ? buildSrcdoc(doc.html, { theme, mode, nonce }) : undefined),
    [doc, theme, mode, nonce],
  );

  return (
    <div ref={wrap} className={fit === "fill" ? "surfaceframe surfaceframe--fill" : "surfaceframe"}>
      {srcdoc ? (
        <iframe
          ref={frame}
          title={summary?.title ?? "Widget"}
          sandbox="allow-scripts"
          srcDoc={srcdoc}
          className="surfaceframe__iframe"
          style={fit === "fill" ? undefined : { height }}
        />
      ) : summary || doc ? (
        <Skeleton shape="block" height={fit === "fill" ? "100%" : 120} />
      ) : (
        <EmptyState icon={<Icons.LayoutGrid />} title="Widget no disponible" />
      )}
    </div>
  );
}
