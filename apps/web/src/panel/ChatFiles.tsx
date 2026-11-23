import "../styles/panel-parts.css";
import "../styles/screens.css";
import { SegmentedControl } from "@apx/ui";
import { useEffect, useState } from "react";
import { useT } from "../i18n/index.ts";
import { FilesPane, type OpenFile } from "../project/files/FilesPane.tsx";
import { nav, useNav } from "../shell/nav.ts";
import { LIST_TAB, PanelTabs } from "./PanelTabs.tsx";

/** A chat's files: the folder its agent works in, or its temp folder (what the system will clear). */
export function ChatFiles({
  thread,
  root,
  label,
  stacked,
}: {
  thread: string;
  root: string | undefined;
  label: string | undefined;
  stacked: boolean;
}) {
  const t = useT();
  const [scope, setScope] = useState<"chat" | "temp">("chat");
  const asked = useNav((s) => s.panelFile);
  // A new object each time, so asking for the same file again opens it again.
  const [open, setOpen] = useState<OpenFile>();
  useEffect(() => {
    if (!asked) return;
    setScope(asked.scratch ? "temp" : "chat");
    // A temp file is named from the temp folder itself; another may be in a folder inside or beside the chat's.
    setOpen(asked.scratch ? { path: asked.path } : { at: `${asked.cwd}/${asked.path}` });
    nav.set({ panelFile: undefined });
  }, [asked]);
  return (
    <div className="chatfiles">
      <PanelTabs
        label={t("panel.files")}
        list={t("panelTabs.explorer")}
        tabs={[]}
        value={LIST_TAB}
        onSelect={() => {}}
        trailing={
          <SegmentedControl
            size="sm"
            label={t("files.scope")}
            value={scope}
            onValueChange={(v) => setScope(v as "chat" | "temp")}
            options={[
              { value: "chat", label: t("files.scope.chat") },
              { value: "temp", label: t("files.scope.temp") },
            ]}
          />
        }
      />
      {scope === "temp" && <p className="chatfiles__note">{t("files.tempNote")}</p>}
      {scope === "chat" ? (
        <FilesPane key="chat" where={{ thread }} root={root} label={label} stacked={stacked} open={open} />
      ) : (
        <FilesPane
          key="temp"
          where={{ thread, scratch: true }}
          label={t("files.scope.temp")}
          stacked={stacked}
          open={open}
        />
      )}
    </div>
  );
}
