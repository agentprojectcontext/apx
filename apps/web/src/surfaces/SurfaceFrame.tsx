import type { SurfaceState } from "@apx/protocol";
import { SURFACE_STATE_MAX, secureRequestKey } from "@apx/protocol/client";
import { EmptyState, Icons, Skeleton, useApx } from "@apx/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { declaresLive } from "../../../../packages/surfaces/src/kit.ts";
import type { SurfaceLayout } from "../../../../packages/surfaces/src/widget-kit.ts";
import { loadSurfaceDoc, setSurfaceState, surfacePrompt } from "../data/actions.ts";
import { artifactCall } from "../data/artifacts.ts";
import { widgetMedia } from "../data/media.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { LAYOUT } from "../shell/layout.ts";
import { attachLive, detachLive, useLiveHeight } from "./livePool.ts";
import { bridgeCall, buildSrcdoc, themeCss } from "./srcdoc.ts";

/** Minimum gap between two sendPrompt() calls from one widget. */
const PROMPT_GAP_MS = 1500;
/** Distinct media files one widget may ask for while it is open. */
const MEDIA_MAX = 40;
/** A widget's state changes are merged and saved at most this often, whatever it sends. */
const STATE_GAP_MS = 500;
/** An app shown inline (in a chat) gets a window of its own height: it fills its viewport rather than grow. */
export const APP_INLINE_H = 640;
/** Bridge calls (store, db, fetch) one page may have waiting at once. */
const CALLS_MAX = 16;

export type SurfaceFrameProps = {
  surfaceId: string;
  /** content = auto-height (inline, panel); fill = take the parent's height (fullscreen app). */
  fit?: "content" | "fill";
  maxHeight?: number;
  /** An app the owner opened: it keeps running, as they left it, until they close it. */
  open?: boolean;
};

/**
 * A surface where it is shown. An opened app, or a page that declares apx-live, is laid over this spot from the shell's
 * live layer, so it keeps running while hidden; any other is mounted here and destroyed with it.
 */
export function SurfaceFrame(props: SurfaceFrameProps) {
  const doc = useData((s) => s.surfaceDocs[props.surfaceId]);
  const keepMs = useMemo(() => (doc ? declaresLive(doc.html) : undefined), [doc]);
  if (props.open) return <LivePlaceholder {...props} keepMs={Number.POSITIVE_INFINITY} />;
  if (keepMs !== undefined) return <LivePlaceholder {...props} keepMs={keepMs} />;
  return <FrameView {...props} />;
}

export type FrameViewProps = SurfaceFrameProps & {
  /** Whether the owner can see it now; a live page hidden by the shell is told so (APX.live pauses). */
  visible?: boolean;
  /** The iframe's height as laid out, for a placeholder that reserves its space. */
  onHeight?: (height: number) => void;
};

/**
 * Renders a surface's HTML in a sandboxed iframe (scripts and in-page forms, opaque origin), themed with the current
 * --apx-* tokens. The widget talks back through postMessage: its height, window.apx.sendPrompt() and its bridge calls.
 */
export function FrameView({
  surfaceId,
  fit = "content",
  maxHeight = LAYOUT.surfaceMaxH,
  visible = true,
  onHeight,
}: FrameViewProps) {
  const t = useT();
  const summary = useData((s) => s.surfaces[surfaceId]);
  const doc = useData((s) => s.surfaceDocs[surfaceId]);
  const layout: SurfaceLayout = (summary?.app ?? doc?.app) ? "app" : "widget";
  const { mode } = useApx();
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [theme, setTheme] = useState<string>();
  const [height, setHeight] = useState(120);
  const nonce = useMemo(() => secureRequestKey(), []);
  const lastPrompt = useRef(0);
  const asked = useRef(new Set<string>());
  const version = doc?.version;
  const remembered = useData((s) => s.surfaceStates[surfaceId]);
  const rememberedRef = useRef(remembered);
  rememberedRef.current = remembered;
  const pendingState = useRef<{ patch: SurfaceState; timer: ReturnType<typeof setTimeout> } | null>(null);
  const inFlight = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

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
      const m = e.data as {
        apx?: unknown;
        kind?: unknown;
        height?: unknown;
        text?: unknown;
        gesture?: unknown;
        id?: unknown;
        ref?: unknown;
        method?: unknown;
        params?: unknown;
      };
      if (!m || m.apx !== nonce) return;
      if (m.kind === "call" && typeof m.id === "number") {
        const target = e.source as Window;
        const answer = (r: { ok: true; value: unknown } | { ok: false; error: string }) =>
          target.postMessage({ apx: nonce, kind: "result", id: m.id, ...r }, "*");
        const req = bridgeCall(m.method, m.params, surfaceId);
        if (!req) return answer({ ok: false, error: "not allowed" });
        if (inFlight.current >= CALLS_MAX) return answer({ ok: false, error: "too many calls at once" });
        inFlight.current++;
        // The client's deadline for the method bounds the wait; the page always gets an answer.
        void artifactCall(req.method, req.params)
          .then(
            (value) => answer({ ok: true, value }),
            (err: unknown) => answer({ ok: false, error: err instanceof Error ? err.message : "call failed" }),
          )
          .finally(() => {
            inFlight.current--;
          });
        return;
      }
      if (m.kind === "media" && typeof m.id === "number" && typeof m.ref === "string" && version !== undefined) {
        const target = e.source as Window;
        const reply = (r: { data: ArrayBuffer; mime: string } | { error: string }) =>
          target.postMessage({ apx: nonce, kind: "media", id: m.id, ...r }, "*", "data" in r ? [r.data] : []);
        asked.current.add(m.ref);
        if (asked.current.size > MEDIA_MAX) return reply({ error: "too many media files" });
        // Each frame gets its own copy: the bytes are moved into it, never shared.
        void widgetMedia(surfaceId, version, m.ref)
          .then(async (b) => reply({ data: await b.arrayBuffer(), mime: b.type }))
          .catch((err: unknown) => reply({ error: err instanceof Error ? err.message : "media unavailable" }));
        return;
      }
      if (m.kind === "state" && isPatch((m as { patch?: unknown }).patch)) {
        const patch = (m as { patch: SurfaceState }).patch;
        if (JSON.stringify(patch).length > SURFACE_STATE_MAX) return;
        const queued = pendingState.current;
        if (queued) Object.assign(queued.patch, patch);
        else
          pendingState.current = {
            patch: { ...patch },
            timer: setTimeout(() => {
              const done = pendingState.current;
              pendingState.current = null;
              if (done) void setSurfaceState(surfaceId, done.patch);
            }, STATE_GAP_MS),
          };
        return;
      }
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
  }, [nonce, maxHeight, surfaceId, version]);

  // A change still waiting when the widget closes is saved, not lost.
  useEffect(
    () => () => {
      const queued = pendingState.current;
      pendingState.current = null;
      if (!queued) return;
      clearTimeout(queued.timer);
      void setSurfaceState(surfaceId, queued.patch);
    },
    [surfaceId],
  );

  // What it remembers, changed elsewhere (its agent, another open copy), reaches the running page without a reload.
  useEffect(() => {
    if (remembered) frame.current?.contentWindow?.postMessage({ apx: nonce, kind: "state", state: remembered }, "*");
  }, [remembered, nonce]);

  // The state is read when the frame is built, never a reason to rebuild it.
  const srcdoc = useMemo(
    () =>
      doc && theme
        ? buildSrcdoc(doc.html, { theme, mode, nonce, connect: doc.connect, layout, state: rememberedRef.current })
        : undefined,
    [doc, theme, mode, nonce, layout],
  );
  const frameHeight = layout === "app" ? Math.min(maxHeight, APP_INLINE_H) : height;

  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  useEffect(() => onHeightRef.current?.(frameHeight), [frameHeight]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ apx: nonce, kind: "visibility", visible }, "*");
  }, [visible, nonce]);

  return (
    <div
      ref={wrap}
      className={`surfaceframe${fit === "fill" ? " surfaceframe--fill" : ""}${layout === "app" ? " surfaceframe--app" : ""}`}
    >
      {srcdoc ? (
        <iframe
          ref={frame}
          title={summary?.title ?? t("panel.widget")}
          // The desktop app finds artifact frames by this name to count their memory in Advanced.
          name={`apx-artifact:${summary?.title ?? surfaceId}`}
          // Forms fire their submit event for the page's own script; the CSP's form-action lets none leave.
          sandbox="allow-scripts allow-forms"
          srcDoc={srcdoc}
          className="surfaceframe__iframe"
          onLoad={() =>
            frame.current?.contentWindow?.postMessage(
              { apx: nonce, kind: "visibility", visible: visibleRef.current },
              "*",
            )
          }
          style={fit === "fill" ? undefined : { height: frameHeight }}
        />
      ) : summary || doc ? (
        <Skeleton shape="block" height={fit === "fill" ? "100%" : 120} />
      ) : (
        <EmptyState icon={<Icons.LayoutGrid />} title={t("widget.unavailable")} />
      )}
    </div>
  );
}

const isPatch = (v: unknown): v is SurfaceState => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Where a live page shows: an empty box of the page's size that the live layer covers with the running frame. When the
 * pool has no room (or another place holds the page) it shows the page itself, as a static one.
 */
function LivePlaceholder({
  surfaceId,
  fit = "content",
  maxHeight = LAYOUT.surfaceMaxH,
  keepMs,
  open = false,
}: SurfaceFrameProps & { keepMs: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [pooled, setPooled] = useState(true);
  const height = useLiveHeight(surfaceId);
  const app = useData((s) => s.surfaces[surfaceId]?.app ?? s.surfaceDocs[surfaceId]?.app ?? false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const id = attachLive(surfaceId, keepMs, { el, fit, maxHeight }, Date.now(), open);
    setPooled(id !== undefined);
    return () => {
      if (id !== undefined) detachLive(surfaceId, id);
    };
  }, [surfaceId, keepMs, fit, maxHeight, open]);

  if (!pooled) return <FrameView surfaceId={surfaceId} fit={fit} maxHeight={maxHeight} />;
  return (
    <div
      ref={box}
      className={`surfaceframe${fit === "fill" ? " surfaceframe--fill" : ""}${app ? " surfaceframe--app" : ""}`}
      data-live-host={surfaceId}
    >
      {fit === "fill" ? null : <div style={{ height }} />}
    </div>
  );
}
