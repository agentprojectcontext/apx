import type { SurfaceSummary } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { downloadPage } from "../data/artifacts.ts";
import type { t as tr } from "../i18n/index.ts";
import { startEditing, stopEditing } from "../panel/browserEdit.ts";
import { go } from "../shell/nav.ts";
import { popOut } from "./artifactWindows.ts";
import { shareEntries } from "./ShareMenu.tsx";

/** A web page on a screen of its own, in edit mode when asked. */
export function openPage(id: string, edit = false): void {
  go.app(id);
  if (edit) startEditing(`widget:${id}`);
  else stopEditing();
}

/** What a web page offers besides seeing and editing it: its link, a window of its own, the file. */
export function pageMenu(s: SurfaceSummary, t: typeof tr, o: { share?: boolean } = {}): MenuEntry[] {
  return [
    ...(o.share === false
      ? []
      : ([
          { type: "submenu", label: t("share.share"), icon: <Icons.Share size={16} />, items: shareEntries(s, t) },
        ] satisfies MenuEntry[])),
    { label: t("artifact.openWindow"), icon: <Icons.ExternalLink size={16} />, onSelect: () => popOut(s) },
    { label: t("page.download"), icon: <Icons.Download size={16} />, onSelect: () => void downloadPage(s.id) },
  ];
}
