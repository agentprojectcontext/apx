import { EmptyState, Icons } from "@apx/ui";
import { useEffect } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";
import "../styles/artifacts.css";

/** One artifact alone in a window or tab of its own (?artifact=<id>): no sidebar, no header, the page fills it. */
export function ArtifactWindow({ id }: { id: string }) {
  const t = useT();
  const surface = useData((s) => s.surfaces[id]);
  useEffect(() => {
    if (surface) document.title = surface.title;
  }, [surface]);
  if (!surface)
    return (
      <section className="artifactwin">
        <EmptyState size="lg" icon={<Icons.AppWindow />} title={t("app.notFound")}>
          {t("app.removed")}
        </EmptyState>
      </section>
    );
  return (
    <section className="artifactwin" aria-label={surface.title}>
      <SurfaceFrame surfaceId={id} fit="fill" />
    </section>
  );
}
