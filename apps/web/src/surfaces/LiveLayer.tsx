import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { declaresLive } from "../../../../packages/surfaces/src/kit.ts";
import { useData } from "../data/state.ts";
import { LAYOUT } from "../shell/layout.ts";
import { dropLive, type LiveEntry, setLiveHeight, sweepLive, useLiveEntries } from "./livePool.ts";
import { FrameView } from "./SurfaceFrame.tsx";
import "../styles/artifacts.css";

/** How often pages whose keep time ran out are closed. */
const SWEEP_MS = 30_000;
/** How often placeholders are measured again even when no event said one moved. */
const SETTLE_MS = 500;

type Placed = { visible: boolean };

/** The part of `el` on screen: its rect cut by every ancestor that clips its overflow, and by the window. */
function visibleRect(el: HTMLElement): { rect: DOMRect; clip: [number, number, number, number] } | undefined {
  if (!el.isConnected) return undefined;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  let top = Math.max(rect.top, 0);
  let left = Math.max(rect.left, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  let right = Math.min(rect.right, window.innerWidth);
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const r = p.getBoundingClientRect();
    top = Math.max(top, r.top);
    left = Math.max(left, r.left);
    bottom = Math.min(bottom, r.bottom);
    right = Math.min(right, r.right);
  }
  if (bottom <= top || right <= left) return undefined;
  return { rect, clip: [top - rect.top, rect.right - right, rect.bottom - bottom, left - rect.left] };
}

/**
 * The shell's layer of live pages: each stays mounted here, laid over its placeholder (measured on scroll, resize and
 * the placeholder's own size, at most once a frame) and hidden, still running, while none shows it.
 */
export function LiveLayer() {
  const entries = useLiveEntries();
  const docs = useData((s) => s.surfaceDocs);
  const summaries = useData((s) => s.surfaces);
  const boxes = useRef(new Map<string, HTMLDivElement>());
  const [placed, setPlaced] = useState<Record<string, Placed>>({});
  const [pageShown, setPageShown] = useState(() => document.visibilityState !== "hidden");
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Closes here: a deleted page, and one that no longer earns its place (not live, and not opened by the owner).
  useEffect(() => {
    for (const e of entries) {
      const doc = docs[e.surface];
      const s = summaries[e.surface];
      if (!s || (!e.open && doc && declaresLive(doc.html) === undefined)) dropLive(e.surface);
    }
  }, [entries, docs, summaries]);

  useEffect(() => {
    const onVis = () => setPageShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    const sweep = setInterval(() => sweepLive(), SWEEP_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(sweep);
    };
  }, []);

  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const next: Record<string, Placed> = {};
      for (const e of entriesRef.current) {
        const box = boxes.current.get(e.surface);
        if (!box) continue;
        const seen = e.host ? visibleRect(e.host.el) : undefined;
        if (seen) {
          const { rect, clip } = seen;
          box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          box.style.clipPath = `inset(${clip.map((n) => `${Math.max(0, n)}px`).join(" ")})`;
        }
        box.toggleAttribute("data-shown", Boolean(seen));
        next[e.surface] = { visible: Boolean(seen) };
      }
      setPlaced((prev) => (same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const sizes = new ResizeObserver(schedule);
    for (const e of entries) if (e.host) sizes.observe(e.host.el);
    sizes.observe(document.documentElement);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    // Layout can move a placeholder without any of the above (a message added above it).
    const settle = setInterval(schedule, SETTLE_MS);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      sizes.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      clearInterval(settle);
    };
  }, [entries]);

  if (!entries.length) return null;
  return (
    <div className="livelayer">
      {entries.map((e) => (
        <LiveBox
          key={e.surface}
          entry={e}
          visible={pageShown && (placed[e.surface]?.visible ?? false)}
          boxRef={(el) => {
            if (el) boxes.current.set(e.surface, el);
            else boxes.current.delete(e.surface);
          }}
        />
      ))}
    </div>
  );
}

function LiveBox({
  entry,
  visible,
  boxRef,
}: {
  entry: LiveEntry;
  visible: boolean;
  boxRef: (el: HTMLDivElement | null) => void;
}) {
  // The last host's fit keeps the frame laid out the same while it is hidden.
  const [fit, setFit] = useState(entry.host?.fit ?? "content");
  const [maxHeight, setMaxHeight] = useState(entry.host?.maxHeight ?? LAYOUT.surfaceMaxH);
  useEffect(() => {
    if (!entry.host) return;
    setFit(entry.host.fit);
    setMaxHeight(entry.host.maxHeight);
  }, [entry.host]);
  return (
    <div ref={boxRef} className="livelayer__box">
      <FrameView
        surfaceId={entry.surface}
        fit={fit}
        maxHeight={maxHeight}
        visible={visible}
        onHeight={(h) => setLiveHeight(entry.surface, h)}
      />
    </div>
  );
}

function same(a: Record<string, Placed>, b: Record<string, Placed>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k]?.visible === b[k]?.visible);
}
