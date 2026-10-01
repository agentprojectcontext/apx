import { EmptyState, Icons, Skeleton } from "@apx/ui";
import { useEffect, useRef } from "react";
import { usePageVisible } from "../common/useInView.ts";
import { useScreenshot } from "../common/useScreenshot.ts";

const POLL_MS = 1500;

/** The page area: the desktop app's real browser view when embedded, else a polled screenshot. */
export function BrowserViewport({ tab }: { tab: string }) {
  const desktop = typeof window !== "undefined" ? window.apxDesktop : undefined;
  return desktop ? <DesktopSlot desktop={desktop} /> : <ScreenshotView tab={tab} />;
}

function DesktopSlot({ desktop }: { desktop: NonNullable<Window["apxDesktop"]> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && document.visibilityState === "visible";
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
  }, [desktop]);
  return <div ref={ref} className="browser__page browser__page--native" />;
}

function ScreenshotView({ tab }: { tab: string }) {
  const visible = usePageVisible();
  const { src, error } = useScreenshot(tab, POLL_MS, visible);
  return (
    <div className="browser__page">
      {src ? (
        <img className="browser__shot" src={src} alt="Vista en vivo de la pestaña" draggable={false} />
      ) : error ? (
        <EmptyState icon={<Icons.TriangleAlert />} title="Sin imagen">
          No pudimos capturar la pestaña. ¿Está abierta la app de escritorio?
        </EmptyState>
      ) : (
        <Skeleton shape="block" height="100%" />
      )}
    </div>
  );
}
