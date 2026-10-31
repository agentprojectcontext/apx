import type { SurfaceSummary } from "@apx/protocol";
import { Icons, ProjectTile, type TileTone } from "@apx/ui";
import type { t as tr } from "../i18n/index.ts";

// The three kinds of artifact, each with one color and icon wherever it is listed: a widget, an app, a web page.

export type ArtifactKind = "widget" | "app" | "page";

export function kindOf(s: Pick<SurfaceSummary, "app" | "page">): ArtifactKind {
  return s.page ? "page" : s.app ? "app" : "widget";
}

const TONE: Record<ArtifactKind, TileTone> = { widget: "violet", app: "brand", page: "info" };
const ICON = { widget: Icons.LayoutGrid, app: Icons.AppWindow, page: Icons.Globe } as const;
const LABEL = { widget: "artifact.kindWidget", app: "artifact.kindApp", page: "artifact.kindPage" } as const;

export function kindLabel(kind: ArtifactKind, t: typeof tr): string {
  return t(LABEL[kind]);
}

/** The kind's icon alone, in the text's color. */
export function KindIcon({ kind, size = 14 }: { kind: ArtifactKind; size?: number }) {
  const Icon = ICON[kind];
  return <Icon size={size} />;
}

/** The kind's icon on its color, as lists show an artifact. */
export function KindTile({ kind, size }: { kind: ArtifactKind; size?: number }) {
  const Icon = ICON[kind];
  return <ProjectTile tone={TONE[kind]} icon={<Icon />} {...(size ? { size } : {})} />;
}
