import type { FileEntry, Thread } from "@apx/protocol";
import { IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useState } from "react";
import { MOD } from "../../common/modKey.ts";
import { client } from "../../data/client.ts";
import { useData } from "../../data/state.ts";
import { loadTasks, tasksLoaded, useTasks } from "../../data/tasks.ts";
import { useT } from "../../i18n/index.ts";
import type { ContextRef } from "./contextRefs.ts";
import type { Connector } from "./SlashMenu.tsx";

/** How many of each kind a context list offers: the newest first. */
const LIST = 12;

/** A row with a second line under its name, keyed for the menu's list. */
function twoLines(key: string, label: string, sub: string) {
  return (
    <span key={key} className="plusmenu__label">
      {label}
      <span className="plusmenu__sub">{sub}</span>
    </span>
  );
}

/**
 * The composer's +: a file (also ⌘/Ctrl+U), an audio to transcribe into the message; a skill, a connector, a command;
 * and context (a project, a chat, a task or a file). Every pick only writes in the composer: nothing is sent until the
 * owner sends it. `direct`: an engine's own session, which has its own skills and connectors. Last, a side question
 * (`onAside`), which stays out of the chat (DECISIONS.md#d-208).
 */
export function PlusMenu(o: {
  thread: Thread;
  /** The chat once it exists (its folder lists the files). */
  made: string | undefined;
  disabled: boolean;
  direct: boolean;
  connectors: readonly Connector[] | undefined;
  onOpen: () => void;
  onFiles: () => void;
  onAudio: () => void;
  onSkill: () => void;
  onConnector: (name: string) => void;
  onCommands: () => void;
  onContext: (ref: ContextRef) => void;
  /** Opens a side question; none where there is no chat to ask about yet, or in an engine's own session. */
  onAside?: (() => void) | undefined;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const threads = useData((s) => s.threads);
  const tasks = useTasks((s) => s.tasks);
  const [files, setFiles] = useState<FileEntry[] | undefined>();

  const opened = (open: boolean) => {
    if (!open) return;
    o.onOpen();
    if (!tasksLoaded()) void loadTasks();
    const where = o.made
      ? { thread: o.made }
      : o.thread.project_id
        ? { project: o.thread.project_id }
        : { base: true as const };
    void client.call("files.tree", where).then(
      (r) => setFiles(r.entries),
      () => setFiles([]),
    );
  };

  const none = (loading: boolean): MenuEntry => ({
    label: t(loading ? "composer.loading" : "composer.none"),
    disabled: true,
  });
  const list = <T,>(rows: readonly T[] | undefined, entry: (row: T) => MenuEntry): MenuEntry[] =>
    rows === undefined ? [none(true)] : rows.length ? rows.slice(0, LIST).map(entry) : [none(false)];
  const pickRef = (ref: ContextRef) => () => o.onContext(ref);

  const chats = Object.values(threads)
    .filter((th) => th.id !== o.thread.id && th.title)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const openTasks = Object.values(tasks)
    .filter((x) => x.state === "open")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const items: MenuEntry[] = [
    {
      label: t("composer.addFile"),
      icon: <Icons.Paperclip size={14} />,
      shortcut: `${MOD}U`,
      disabled: o.disabled,
      onSelect: o.onFiles,
    },
    {
      label: twoLines("audio", t("composer.addAudio"), t("composer.addAudioDesc")),
      icon: <Icons.Mic size={14} />,
      disabled: o.disabled,
      onSelect: o.onAudio,
    },
    { type: "separator" },
    ...(o.direct
      ? []
      : ([
          { label: t("composer.useSkill"), icon: <Icons.Sparkles size={14} />, shortcut: "$", onSelect: o.onSkill },
          {
            type: "submenu",
            label: t("composer.connectors"),
            icon: <Icons.Layers size={14} />,
            items: list(o.connectors, (c) => ({
              label: twoLines(c.name, c.name, c.target),
              shortcut: "MCP",
              onSelect: () => o.onConnector(c.name),
            })),
          },
        ] satisfies MenuEntry[])),
    { label: t("composer.commands"), icon: <Icons.Code size={14} />, shortcut: "/", onSelect: o.onCommands },
    {
      type: "submenu",
      label: twoLines("context", t("composer.addContext"), t("composer.addContextDesc")),
      icon: <Icons.FileText size={14} />,
      items: [
        {
          type: "submenu",
          label: t("composer.ctx.project"),
          icon: <Icons.Folder size={14} />,
          items: list(projects, (p) => ({
            label: p.name,
            onSelect: pickRef({ kind: "project", id: p.id, label: p.name }),
          })),
        },
        {
          type: "submenu",
          label: t("composer.ctx.chat"),
          icon: <Icons.MessageCircle size={14} />,
          items: list(chats, (th) => ({
            label: th.title,
            onSelect: pickRef({ kind: "chat", id: th.id, label: th.title }),
          })),
        },
        {
          type: "submenu",
          label: t("composer.ctx.task"),
          icon: <Icons.ListChecks size={14} />,
          items: list(tasksLoaded() ? openTasks : undefined, (x) => ({
            label: x.title,
            onSelect: pickRef({ kind: "task", id: x.id, label: x.title }),
          })),
        },
        {
          type: "submenu",
          label: t("composer.ctx.file"),
          icon: <Icons.FileText size={14} />,
          items: list(files, (f) => ({
            label: f.kind === "dir" ? `${f.name}/` : f.name,
            icon: f.kind === "dir" ? <Icons.Folder size={14} /> : <Icons.FileText size={14} />,
            onSelect: pickRef({ kind: "file", id: f.path, label: f.name }),
          })),
        },
      ],
    },
    ...(o.onAside
      ? ([
          { type: "separator" },
          {
            label: twoLines("aside", t("composer.aside"), t("composer.asideDesc")),
            icon: <Icons.MessageCircle size={14} />,
            disabled: o.disabled,
            onSelect: o.onAside,
          },
        ] satisfies MenuEntry[])
      : []),
  ];
  return (
    <Menu
      align="start"
      side="top"
      className="plusmenu"
      items={items}
      onOpenChange={opened}
      trigger={
        <IconButton
          size="md"
          shape="circle"
          className="composer__plus"
          label={t("composer.add")}
          icon={<Icons.Plus size={16} />}
        />
      }
    />
  );
}
