import "../styles/panel-parts.css";
import "../styles/screens.css";
import { SegmentedControl } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { relativeInside } from "../data/paths.ts";
import { useT } from "../i18n/index.ts";
import type { FileChange } from "../project/files/FileActions.tsx";
import { FileIcon, FileTree, FileView, movedPath } from "../project/files/FilesPane.tsx";
import { nav, useNav } from "../shell/nav.ts";
import { closeTab, renameTab, useOpenTabs } from "./openTabs.ts";
import { LIST_TAB, PanelTabs } from "./PanelTabs.tsx";

type Scope = "chat" | "temp";
/** A tab is a file in one of the two folders: `chat:src/app.ts`, `temp:notes.md`. */
const tabId = (scope: Scope, path: string) => `${scope}:${path}`;
const tabOf = (id: string) => {
  const at = id.indexOf(":");
  return { scope: id.slice(0, at) as Scope, path: id.slice(at + 1) };
};

/**
 * A chat's files: the Explorer tab browses the folder its agent works in, or its temp folder (what the system will
 * clear); each file opened from either shows in a tab of its own.
 */
export function ChatFiles({
  thread,
  root,
  label,
}: {
  thread: string;
  root: string | undefined;
  label: string | undefined;
}) {
  const t = useT();
  const [scope, setScope] = useState<Scope>("chat");
  const [active, setActive] = useState(LIST_TAB);
  const key = `files:${thread}`;
  const open = useOpenTabs(key, active === LIST_TAB ? undefined : active);
  const where = (s: Scope) => (s === "temp" ? { thread, scratch: true } : { thread });

  // A file asked for from the chat: a temp file is named from the temp folder itself; another by its full path, which
  // may be in a folder inside the chat's.
  const asked = useNav((s) => s.panelFile);
  // The ask is cleared as soon as it is taken, so the folder's answer is matched to the latest ask, not to the effect.
  const lastAsk = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new ask opens a file.
  useEffect(() => {
    if (!asked) return;
    nav.set({ panelFile: undefined });
    const ask = ++lastAsk.current;
    const s: Scope = asked.scratch ? "temp" : "chat";
    setScope(s);
    if (asked.scratch) return setActive(tabId(s, asked.path));
    client.call("files.tree", { ...where(s), dir: "" }).then(
      (r) => {
        const rel = relativeInside(r.root, `${asked.cwd}/${asked.path}`);
        if (ask === lastAsk.current && rel) setActive(tabId(s, rel));
      },
      () => {},
    );
  }, [asked]);

  // A rename or a trash in the tree: its tabs follow the new name, or close.
  const changed = (s: Scope, c: FileChange) => {
    for (const id of open) {
      const tab = tabOf(id);
      if (tab.scope !== s) continue;
      const to = movedPath(tab.path, c);
      if (to === tab.path) continue;
      if (to) renameTab(key, id, tabId(s, to));
      else closeTab(key, id);
      if (id === active) setActive(to ? tabId(s, to) : LIST_TAB);
    }
  };
  const shown = active === LIST_TAB ? undefined : tabOf(active);
  return (
    <div className="chatfiles">
      <PanelTabs
        label={t("panel.files")}
        list={t("panelTabs.explorer")}
        tabs={open.map((id) => {
          const { path } = tabOf(id);
          return { id, label: path.split("/").at(-1) ?? path, icon: <FileIcon path={path} /> };
        })}
        value={active}
        onSelect={setActive}
        onClose={(id) => {
          const left = closeTab(key, id);
          if (id === active) setActive(left.at(-1) ?? LIST_TAB);
        }}
      />
      {shown && (
        <section className="files__view chatfiles__file" aria-label={shown.path}>
          <FileView key={active} where={where(shown.scope)} path={shown.path} />
        </section>
      )}
      {/* Kept while a file is in front, so the folders opened in the tree stay open. */}
      <div className="chatfiles__explorer" hidden={Boolean(shown)}>
        <div className="chatfiles__bar">
          <SegmentedControl
            size="sm"
            label={t("files.scope")}
            value={scope}
            onValueChange={(v) => setScope(v as Scope)}
            options={[
              { value: "chat", label: t("files.scope.chat") },
              { value: "temp", label: t("files.scope.temp") },
            ]}
          />
          {scope === "temp" && <p className="chatfiles__note">{t("files.tempNote")}</p>}
        </div>
        <FileTree
          key={scope}
          where={where(scope)}
          root={scope === "chat" ? root : undefined}
          label={scope === "chat" ? label : t("files.scope.temp")}
          picked={undefined}
          onPick={(path) => setActive(tabId(scope, path))}
          onChange={(c) => changed(scope, c)}
        />
      </div>
    </div>
  );
}
