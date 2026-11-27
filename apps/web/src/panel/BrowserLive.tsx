// A tab of the server's own browser, live: its frames as they paint, and while the owner holds it (or an agent handed
// it over), their pointer, wheel and keys go to it.
import { LIVE_MAX_WIDTH, type TabControl } from "@apx/protocol";
import { EmptyState, Icons, Skeleton } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { usePageVisible } from "../common/useInView.ts";
import { browserInput, liveFrame } from "../data/actions.ts";
import { createStore } from "../data/createStore.ts";
import { useT } from "../i18n/index.ts";
import { buttonOf, inputQueue, modifiersOf, pageAt, sendsAsKey } from "./liveInput.ts";

/** The tab whose live picture is on screen: its toolbar then offers taking it over, as for the app's own tabs. */
export const liveTab = createStore<{ tab: string | undefined }>({ tab: undefined });

type Frame = { src: string; width: number; height: number };
const RETRY_MS = 1000;
/** Touch moves farther than this scroll the page instead of tapping it. */
const TAP_SLOP = 8;

export function LiveView({ tab, control }: { tab: string; control: TabControl }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const visible = usePageVisible();
  const [frame, setFrame] = useState<Frame>();
  const [failing, setFailing] = useState(false);
  const maxWidth = useFrameWidth(box);
  const holding = control.kind === "user" || control.kind === "handoff";

  // One call at a time: each brings the next frame, so the picture moves as fast as the link carries it.
  useEffect(() => {
    if (!visible || !maxWidth) return;
    let live = true;
    let seq = 0;
    let misses = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = async () => {
      try {
        const f = await liveFrame(tab, seq, maxWidth);
        if (!live) return;
        misses = 0;
        setFailing(false);
        seq = f.seq;
        if (f.src) {
          const src = f.src;
          setFrame({ src, width: f.width, height: f.height });
          liveTab.set({ tab });
        }
        void next();
      } catch {
        if (!live) return;
        if (++misses >= 3) setFailing(true);
        timer = setTimeout(() => void next(), RETRY_MS);
      }
    };
    void next();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [tab, visible, maxWidth]);
  useEffect(
    () => () => {
      if (liveTab.get().tab === tab) liveTab.set({ tab: undefined });
    },
    [tab],
  );

  useOwnerHand(holding, tab, box, img, keys);

  return (
    <div ref={box} className={holding ? "browser__page browser__live is-held" : "browser__page browser__live"}>
      {failing && !frame ? (
        <EmptyState icon={<Icons.TriangleAlert />} title={t("browser.noImage")}>
          {t("browser.noImageBody")}
        </EmptyState>
      ) : frame ? (
        <img ref={img} className="browser__shot" src={frame.src} alt={t("browser.liveView")} draggable={false} />
      ) : (
        <Skeleton shape="block" height="100%" />
      )}
      {holding && (
        // ui: an invisible catcher for the owner's keys and typed text (IME, the phone's keyboard), not a field
        <textarea
          ref={keys}
          className="browser__keys"
          aria-label={t("browser.typeOnPage")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      )}
    </div>
  );
}

/** How wide a frame the panel can show (device pixels), in steps so a small resize does not restart the stream. */
function useFrameWidth(box: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const px = el.clientWidth * (window.devicePixelRatio || 1);
      setWidth(Math.max(320, Math.min(LIVE_MAX_WIDTH, Math.ceil(px / 160) * 160)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [box]);
  return width;
}

/** While the owner holds the tab: their pointer, wheel, keys and typed text go to the page, in order. */
function useOwnerHand(
  holding: boolean,
  tab: string,
  box: React.RefObject<HTMLDivElement | null>,
  img: React.RefObject<HTMLImageElement | null>,
  keys: React.RefObject<HTMLTextAreaElement | null>,
) {
  useEffect(() => {
    const surface = box.current;
    const field = keys.current;
    if (!holding || !surface || !field) return;
    const queue = inputQueue((events) => browserInput(tab, events));
    const at = (e: { clientX: number; clientY: number }) => {
      const picture = img.current;
      if (!picture) return undefined;
      const r = picture.getBoundingClientRect();
      return pageAt(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        { width: picture.naturalWidth, height: picture.naturalHeight },
        { x: e.clientX, y: e.clientY },
      );
    };
    const focusKeys = () => field.focus({ preventScroll: true });
    let touch: { id: number; x: number; y: number; scrolled: boolean } | undefined;

    const down = (e: PointerEvent) => {
      if (e.target === field) return;
      const p = at(e);
      if (!p) return;
      e.preventDefault();
      if (e.pointerType === "touch") {
        touch = { id: e.pointerId, x: e.clientX, y: e.clientY, scrolled: false };
        return;
      }
      surface.setPointerCapture(e.pointerId);
      const button = buttonOf(e.button);
      queue.push({
        type: "mouse",
        action: "down",
        ...p,
        button,
        clicks: Math.min(3, e.detail || 1),
        modifiers: modifiersOf(e),
      });
      focusKeys();
    };
    const move = (e: PointerEvent) => {
      if (touch && e.pointerId === touch.id) {
        const dx = touch.x - e.clientX;
        const dy = touch.y - e.clientY;
        if (!touch.scrolled && Math.hypot(dx, dy) < TAP_SLOP) return;
        touch = { ...touch, x: e.clientX, y: e.clientY, scrolled: true };
        const p = at(e);
        const scale = (img.current?.naturalWidth ?? 1) / (img.current?.getBoundingClientRect().width || 1);
        if (p) queue.push({ type: "wheel", ...p, dx: dx * scale, dy: dy * scale, modifiers: 0 });
        return;
      }
      if (e.pointerType === "touch") return;
      const p = at(e);
      if (p) queue.push({ type: "mouse", action: "move", ...p, button: "none", clicks: 0, modifiers: modifiersOf(e) });
    };
    const up = (e: PointerEvent) => {
      const p = at(e);
      if (touch && e.pointerId === touch.id) {
        const tapped = !touch.scrolled;
        touch = undefined;
        if (!tapped || !p) return;
        for (const action of ["down", "up"] as const)
          queue.push({ type: "mouse", action, ...p, button: "left", clicks: 1, modifiers: 0 });
        // A tap may land on a field: the phone's keyboard comes up for it.
        focusKeys();
        return;
      }
      if (e.pointerType === "touch" || !p) return;
      queue.push({
        type: "mouse",
        action: "up",
        ...p,
        button: buttonOf(e.button),
        clicks: Math.min(3, e.detail || 1),
        modifiers: modifiersOf(e),
      });
    };
    const wheel = (e: WheelEvent) => {
      const p = at(e);
      if (!p) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 600 : 1;
      queue.push({ type: "wheel", ...p, dx: e.deltaX * unit, dy: e.deltaY * unit, modifiers: modifiersOf(e) });
    };
    const menu = (e: MouseEvent) => e.preventDefault();

    const held = new Set<string>();
    const keyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || !sendsAsKey(e)) return;
      e.preventDefault();
      held.add(e.key);
      queue.push({ type: "key", action: "down", key: e.key, code: e.code, modifiers: modifiersOf(e) });
    };
    const keyUp = (e: KeyboardEvent) => {
      if (!held.delete(e.key)) return;
      queue.push({ type: "key", action: "up", key: e.key, code: e.code, modifiers: modifiersOf(e) });
    };
    const press = (key: string) => {
      for (const action of ["down", "up"] as const) queue.push({ type: "key", action, key, code: key, modifiers: 0 });
    };
    // What a keyboard types (accents, a phone's keyboard, an IME's result) arrives here as text.
    const beforeInput = (e: InputEvent) => {
      if (e.isComposing || e.inputType === "insertCompositionText") return;
      e.preventDefault();
      if ((e.inputType === "insertText" || e.inputType === "insertReplacementText") && e.data)
        queue.push({ type: "text", text: e.data });
      else if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") press("Enter");
      else if (e.inputType === "deleteContentBackward") press("Backspace");
      else if (e.inputType === "deleteContentForward") press("Delete");
    };
    const composed = (e: CompositionEvent) => {
      if (e.data) queue.push({ type: "text", text: e.data });
      field.value = "";
    };
    const paste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain");
      e.preventDefault();
      if (text) queue.push({ type: "text", text: text.slice(0, 2000) });
    };

    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", up);
    const cancel = () => {
      touch = undefined;
    };
    surface.addEventListener("pointercancel", cancel);
    surface.addEventListener("wheel", wheel, { passive: false });
    surface.addEventListener("contextmenu", menu);
    field.addEventListener("keydown", keyDown);
    field.addEventListener("keyup", keyUp);
    field.addEventListener("beforeinput", beforeInput);
    field.addEventListener("compositionend", composed);
    field.addEventListener("paste", paste);
    return () => {
      queue.clear();
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", cancel);
      surface.removeEventListener("wheel", wheel);
      surface.removeEventListener("contextmenu", menu);
      field.removeEventListener("keydown", keyDown);
      field.removeEventListener("keyup", keyUp);
      field.removeEventListener("beforeinput", beforeInput);
      field.removeEventListener("compositionend", composed);
      field.removeEventListener("paste", paste);
    };
  }, [holding, tab, box, img, keys]);
}
