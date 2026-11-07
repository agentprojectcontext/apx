import { Button, EmptyState, Icons, Skeleton, useApx } from "@apx/ui";
import { type RefObject, useEffect, useRef, useState } from "react";
import { usePageVisible } from "../common/useInView.ts";
import { useScreenshot } from "../common/useScreenshot.ts";
import { useSlice } from "../data/createStore.ts";
import { useT } from "../i18n/index.ts";
import { popOutBrowser, useBrowserPoppedOut } from "./browserWindow.ts";
import { nativeCover } from "./nativeCover.ts";

const POLL_MS = 1500;

/** The page area: the desktop app's real browser view when embedded, else a polled screenshot. */
export function BrowserViewport({ tab }: { tab: string }) {
  const desktop = typeof window !== "undefined" ? window.apxDesktop : undefined;
  const poppedOut = useBrowserPoppedOut();
  if (desktop && poppedOut) return <PoppedOut />;
  return desktop ? <DesktopSlot desktop={desktop} tab={tab} /> : <ScreenshotView tab={tab} />;
}

/** The page is in the browser window: say so, and offer to bring it back here. */
function PoppedOut() {
  const t = useT();
  return (
    <div className="browser__page">
      <EmptyState
        icon={<Icons.AppWindow />}
        title={t("browser.inWindow")}
        action={
          <Button size="sm" variant="secondary" onClick={() => popOutBrowser(false)}>
            {t("browser.backToPanel")}
          </Button>
        }
      >
        {t("browser.inWindowBody")}
      </EmptyState>
    </div>
  );
}

type Frame = { src: string; width: number };

function DesktopSlot({ desktop, tab }: { desktop: NonNullable<Window["apxDesktop"]>; tab: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useSlice(nativeCover, (s) => s.on);
  const overlaid = usePopupOver(ref);
  const covered = dragging || overlaid;
  // While the live page steps behind the panel, a still of it holds its place instead of an empty box.
  const [frame, setFrame] = useState<Frame | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another tab's still must not stand in for this one.
  useEffect(() => setFrame(null), [tab]);
  useEffect(() => () => desktop.setBrowserBounds(null), [desktop]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (covered) {
      let live = true;
      // A drag must reach the panel at once; a popup waits for the still, so the page never blinks.
      if (dragging) desktop.setBrowserBounds(null);
      const width = el.getBoundingClientRect().width;
      stillOf(desktop).then((src) => {
        if (!live) return;
        if (src) setFrame({ src, width });
        requestAnimationFrame(() => requestAnimationFrame(() => live && desktop.setBrowserBounds(null)));
      });
      return () => {
        live = false;
      };
    }
    let tick = 0;
    let last = "";
    const report = () => {
      cancelAnimationFrame(tick);
      tick = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && document.visibilityState === "visible";
        const next = visible
          ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
          : null;
        const key = JSON.stringify(next);
        if (key === last) return;
        last = key;
        desktop.setBrowserBounds(next);
      });
    };
    // The slot also moves without changing size (a column beside it grows): watch what sits around it too.
    const ro = new ResizeObserver(report);
    for (const node of around(el)) ro.observe(node);
    window.addEventListener("resize", report);
    document.addEventListener("visibilitychange", report);
    document.addEventListener("transitionend", report);
    report();
    return () => {
      cancelAnimationFrame(tick);
      ro.disconnect();
      window.removeEventListener("resize", report);
      document.removeEventListener("visibilitychange", report);
      document.removeEventListener("transitionend", report);
    };
  }, [desktop, covered, dragging]);
  return (
    <div ref={ref} className="browser__page browser__page--native">
      {frame && (
        <img className="browser__frame" src={frame.src} alt="" draggable={false} style={{ width: frame.width }} />
      )}
    </div>
  );
}

/** A decoded still of the page on screen, or null when the app cannot take one. */
async function stillOf(desktop: NonNullable<Window["apxDesktop"]>): Promise<string | null> {
  try {
    const src = await desktop.browserFrame?.();
    if (!src) return null;
    const img = new Image();
    img.src = src;
    await img.decode();
    return src;
  } catch {
    return null;
  }
}

/** The slot, its ancestors' children and its own: a size change in any of them can move the slot. */
function around(el: HTMLElement): Element[] {
  const nodes = new Set<Element>([el]);
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    for (const c of p.children) nodes.add(c);
  }
  return [...nodes];
}

/** What floats over the panel: popups and a modal's backdrop in the portal, notices at the foot of the shell. See HISTORY.md#tab-under-floats */
const PORTAL_FLOATS = "[role=menu], [role=dialog], [role=listbox], .apx-menu, .apx-dialog__backdrop";
const SHELL_FLOATS = ":scope > .toasts > .toast";

/**
 * Whether a menu, popover, dialog, its backdrop or a notice of the panel lies over the page area. The native page
 * paints above every HTML layer, so it steps behind while one is open instead of hiding it.
 */
function usePopupOver(slot: RefObject<HTMLDivElement | null>): boolean {
  const { portalRef } = useApx();
  const [over, setOver] = useState(false);
  useEffect(() => {
    const portal = portalRef.current;
    if (!portal) return;
    const shell = slot.current?.closest(".shell");
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = slot.current;
        if (!el) return setOver(false);
        // Notices come and go inside their own list, which mounts only while there is one.
        const notices = shell?.querySelector(":scope > .toasts");
        if (notices) mo.observe(notices, { childList: true });
        const a = el.getBoundingClientRect();
        const hit = [
          ...portal.querySelectorAll<HTMLElement>(PORTAL_FLOATS),
          ...(shell?.querySelectorAll<HTMLElement>(SHELL_FLOATS) ?? []),
        ].some((p) => {
          const b = p.getBoundingClientRect();
          return (
            b.width > 0 && b.height > 0 && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top
          );
        });
        setOver(hit);
      });
    };
    const mo = new MutationObserver(check);
    mo.observe(portal, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-open"] });
    if (shell) mo.observe(shell, { childList: true });
    check();
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
    };
  }, [portalRef, slot]);
  return over;
}

function ScreenshotView({ tab }: { tab: string }) {
  const t = useT();
  const visible = usePageVisible();
  const { src, error } = useScreenshot(tab, POLL_MS, visible);
  return (
    <div className="browser__page">
      {src ? (
        <img className="browser__shot" src={src} alt={t("browser.liveView")} draggable={false} />
      ) : error ? (
        <EmptyState icon={<Icons.TriangleAlert />} title={t("browser.noImage")}>
          {t("browser.noImageBody")}
        </EmptyState>
      ) : (
        <Skeleton shape="block" height="100%" />
      )}
    </div>
  );
}
