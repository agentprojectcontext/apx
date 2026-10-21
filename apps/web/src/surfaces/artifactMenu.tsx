import type { SurfaceSummary } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { setSurfaceFlags } from "../data/actions.ts";
import { exportArtifact } from "../data/artifacts.ts";
import { projectName } from "../data/identity.ts";
import { data } from "../data/state.ts";
import type { t as tr } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { popOut } from "./artifactWindows.ts";
import { dropLive } from "./livePool.ts";
import { shareEntries } from "./ShareMenu.tsx";
import { openWidgetChat } from "./WidgetChat.tsx";

/** The artifact as an .apxart file to keep, share or load in another APX: alone, or with what it remembers. */
export function downloadEntry(s: SurfaceSummary, t: typeof tr): MenuEntry {
  return {
    type: "submenu",
    label: t("artifact.download"),
    icon: <Icons.Download size={16} />,
    items: [
      {
        label: t("artifact.downloadPlain"),
        icon: <Icons.File size={16} />,
        onSelect: () => void exportArtifact(s.id, false),
      },
      {
        label: t("artifact.downloadMemory"),
        icon: <Icons.Database size={16} />,
        onSelect: () => void exportArtifact(s.id, true),
      },
    ],
  };
}

/** Where an artifact is listed, named by place: its project's board and the Apps list are two different things. */
export function placeEntries(s: SurfaceSummary, t: typeof tr, after?: { removedFromApps?: () => void }): MenuEntry[] {
  const project = projectName(data.get().projects, s.project_id);
  return [
    {
      label: s.pinned ? t("artifact.unpinFrom", { project }) : t("artifact.pinTo", { project }),
      icon: s.pinned ? <Icons.PinOff size={16} /> : <Icons.Pin size={16} />,
      onSelect: () => void setSurfaceFlags(s.id, { pinned: !s.pinned }),
    },
    {
      label: s.app ? t("app.remove") : t("widget.installApp"),
      icon: <Icons.AppWindow size={16} />,
      onSelect: async () => {
        await setSurfaceFlags(s.id, { app: !s.app });
        if (s.app) after?.removedFromApps?.();
      },
    },
  ];
}

/** An artifact's whole menu (right-click in the Apps list): open, ask, share, memory, then where it is listed. */
export function artifactMenu(
  s: SurfaceSummary,
  t: typeof tr,
  o: { onMemory: () => void; onProperties: () => void; running: boolean },
): MenuEntry[] {
  return [
    { label: t("widget.openApp"), icon: <Icons.AppWindow size={16} />, onSelect: () => go.app(s.id) },
    { label: t("artifact.openWindow"), icon: <Icons.ExternalLink size={16} />, onSelect: () => popOut(s) },
    { label: t("widget.chatShort"), icon: <Icons.MessageSquare size={16} />, onSelect: () => void openWidgetChat(s) },
    { type: "submenu", label: t("share.share"), icon: <Icons.Share size={16} />, items: shareEntries(s, t) },
    { label: `${t("artifact.properties")}…`, icon: <Icons.Info size={16} />, onSelect: o.onProperties },
    { label: `${t("artifact.memory")}…`, icon: <Icons.Database size={16} />, onSelect: o.onMemory },
    downloadEntry(s, t),
    { type: "separator" },
    ...placeEntries(s, t),
    ...(o.running
      ? ([
          { type: "separator" },
          { label: t("artifact.closeApp"), icon: <Icons.X size={16} />, onSelect: () => dropLive(s.id) },
        ] satisfies MenuEntry[])
      : []),
  ];
}
