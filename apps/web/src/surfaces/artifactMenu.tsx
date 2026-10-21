import type { SurfaceSummary } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { setSurfaceFlags } from "../data/actions.ts";
import { projectName } from "../data/identity.ts";
import { data } from "../data/state.ts";
import type { t as tr } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { shareEntries } from "./ShareMenu.tsx";
import { openWidgetChat } from "./WidgetChat.tsx";

/** The artifact alone in a window of its own: a desktop window in the app, a new tab or popup on the web. */
export function openArtifactWindow(s: SurfaceSummary): void {
  if (window.apxDesktop?.openArtifactWindow) return window.apxDesktop.openArtifactWindow(s.id, s.title);
  const url = `${window.location.origin}/?artifact=${encodeURIComponent(s.id)}`;
  window.open(url, `apx-artifact-${s.id}`, "popup,width=1200,height=820");
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
export function artifactMenu(s: SurfaceSummary, t: typeof tr, o: { onMemory: () => void }): MenuEntry[] {
  return [
    { label: t("widget.openApp"), icon: <Icons.AppWindow size={16} />, onSelect: () => go.app(s.id) },
    { label: t("artifact.openWindow"), icon: <Icons.ExternalLink size={16} />, onSelect: () => openArtifactWindow(s) },
    { label: t("widget.chatShort"), icon: <Icons.MessageSquare size={16} />, onSelect: () => void openWidgetChat(s) },
    { type: "submenu", label: t("share.share"), icon: <Icons.Share size={16} />, items: shareEntries(s, t) },
    { label: `${t("artifact.memory")}…`, icon: <Icons.Database size={16} />, onSelect: o.onMemory },
    { type: "separator" },
    ...placeEntries(s, t),
  ];
}
