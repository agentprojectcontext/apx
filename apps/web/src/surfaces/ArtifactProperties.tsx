import type { SurfaceSummary } from "@apx/protocol";
import { Badge, Dialog } from "@apx/ui";
import { useEffect } from "react";
import { declaresLive } from "../../../../packages/surfaces/src/kit.ts";
import { loadSurfaceDoc } from "../data/actions.ts";
import { projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { linkOf } from "./ShareMenu.tsx";
import "../styles/artifacts.css";

/** The kit version a page asks for, as people read versions: kit@1.js → "v1". */
const kitOf = (html: string) => {
  const v = /\/_apx\/kit@(\d+(?:\.\d+){0,2})\.js/.exec(html)?.[1];
  return v ? `v${v}` : undefined;
};
const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString() : undefined);

/** What an artifact is and where it came from: kind, version, maker, project, and, installed from a file, its origin. */
export function ArtifactPropertiesDialog({ surface, onClose }: { surface: SurfaceSummary; onClose: () => void }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const maker = useData((s) => s.agents[surface.created_by]?.name);
  const doc = useData((s) => s.surfaceDocs[surface.id]);
  useEffect(() => {
    if (!doc) void loadSurfaceDoc(surface.id);
  }, [doc, surface.id]);

  const o = surface.origin;
  const rows: [string, string | undefined][] = [
    [t("artifact.prop.name"), surface.name],
    [t("artifact.prop.version"), `v${surface.version}`],
    [t("artifact.prop.project"), projectName(projects, surface.project_id)],
    [
      t("artifact.prop.madeBy"),
      surface.created_by === "owner" ? t("artifact.prop.you") : (maker ?? surface.created_by),
    ],
    [t("artifact.prop.updated"), when(surface.updated_at)],
    [t("artifact.prop.kit"), doc ? (kitOf(doc.html) ?? t("artifact.prop.noKit")) : undefined],
    [
      t("artifact.prop.live"),
      doc ? t(declaresLive(doc.html) !== undefined ? "artifact.prop.yes" : "artifact.prop.no") : undefined,
    ],
    [t("artifact.prop.connects"), surface.connect?.join(", ") || t("artifact.prop.nothing")],
    [t("artifact.prop.shared"), linkOf(surface) ?? t("artifact.prop.private")],
  ];
  const origin: [string, string | undefined][] = o
    ? [
        [t("artifact.prop.author"), o.author],
        [t("artifact.prop.agent"), o.agent],
        [t("artifact.prop.fromProject"), o.project],
        [t("artifact.prop.fromVersion"), o.version ? `v${o.version}` : undefined],
        [t("artifact.prop.exported"), when(o.exported_at)],
        [t("artifact.prop.installed"), when(o.installed_at)],
      ]
    : [];
  const list = (items: [string, string | undefined][]) => (
    <dl className="artprops">
      {items
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={
        <span className="artprops__title">
          {surface.title}
          <Badge tone={surface.app ? "brand" : "neutral"}>
            {t(surface.app ? "artifact.kindApp" : "artifact.kindWidget")}
          </Badge>
        </span>
      }
      description={t("artifact.prop.hint")}
      closeLabel={t("common.close")}
    >
      {list(rows)}
      {o && (
        <>
          <h3 className="artprops__head">{t("artifact.prop.origin")}</h3>
          {list(origin)}
        </>
      )}
    </Dialog>
  );
}
