import { Button, EmptyState, Icons, Skeleton } from "@apx/ui";
import { useEffect, useRef } from "react";
import { usePageVisible } from "../common/useInView.ts";
import { useScreenshot } from "../common/useScreenshot.ts";
import { createStore, useSlice } from "../data/createStore.ts";
import { useT } from "../i18n/index.ts";
import { popOutBrowser, useBrowserPoppedOut } from "./browserWindow.ts";

const POLL_MS = 1500;

/** While a column edge is dragged the native page steps behind the panel: over it, the pointer never reaches us. */
const cover = createStore({ on: false });
export const coverNativeViews = (on: boolean) => cover.set({ on });

/** The page area: the desktop app's real browser view when embedded, else a polled screenshot. */
export function BrowserViewport({ tab }: { tab: string }) {
  const desktop = typeof window !== "undefined" ? window.apxDesktop : undefined;
  const poppedOut = useBrowserPoppedOut();
  if (desktop && poppedOut) return <PoppedOut />;
  return desktop ? <DesktopSlot desktop={desktop} /> : <ScreenshotView tab={tab} />;
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

function DesktopSlot({ desktop }: { desktop: NonNullable<Window["apxDesktop"]> }) {
  const ref = useRef<HTMLDivElement>(null);
  const covered = useSlice(cover, (s) => s.on);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const visible = !covered && r.width > 0 && r.height > 0 && document.visibilityState === "visible";
        desktop.setBrowserBounds(
          visible
            ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
            : null,
        );
      });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    document.addEventListener("visibilitychange", report);
    report();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", report);
      document.removeEventListener("visibilitychange", report);
      desktop.setBrowserBounds(null);
    };
  }, [desktop, covered]);
  return <div ref={ref} className="browser__page browser__page--native" />;
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
