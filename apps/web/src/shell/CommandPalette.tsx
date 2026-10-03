import type { Task } from "@apx/protocol";
import { AgentAvatar, Dialog, Icons, Kbd, ProjectTile } from "@apx/ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { isListed, projectInitial, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { type ConfigSection, go, useNav } from "./nav.ts";

type Item = { key: string; group: MessageKey; title: string; detail?: string; icon: ReactNode; run(): void };

const SECTIONS: Partial<Record<ConfigSection, MessageKey>> = {
  account: "config.account",
  appearance: "config.appearance",
  engines: "config.engines",
  agents: "config.agents",
  memory: "config.memory",
  channels: "config.channels",
  browser: "config.browser",
  desktop: "config.desktop",
  advanced: "config.advanced",
};
const MAX_PER_GROUP = 6;

/** Lowercase, without accents: "Acción" matches "accion". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
/** Every word of the query appears in the text, in any order. */
const matches = (text: string, words: string[]) => {
  const t = fold(text);
  return words.every((w) => t.includes(w));
};

/**
 * ⌘K: one box to jump anywhere — chats, projects, agents, open tasks, and the places of the app (Tasks, Resources,
 * each Settings section). Arrows move, Enter opens, Esc closes.
 */
export function CommandPalette() {
  const t = useT();
  const open = useNav((s) => s.palette);
  const threads = useData((s) => s.threads);
  const projects = useData((s) => s.projects);
  const agents = useData((s) => s.agents);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAt(0);
    void client
      .call("tasks.list", { limit: 200 })
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]));
  }, [open]);

  const items = useMemo((): Item[] => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const close = (fn: () => void) => () => {
      go.palette(false);
      fn();
    };
    const places: Item[] = [
      { key: "p:inbox", title: t("nav.inbox"), icon: <Icons.Inbox size={15} />, run: close(go.inbox) },
      {
        key: "p:tasks",
        title: t("nav.tasks"),
        icon: <Icons.ListChecks size={15} />,
        run: close(() => go.view("tasks")),
      },
      {
        key: "p:resources",
        title: t("nav.resources"),
        icon: <Icons.Layers size={15} />,
        run: close(() => go.view("resources")),
      },
      ...(Object.entries(SECTIONS) as Array<[ConfigSection, MessageKey]>).map(([id, label]) => ({
        key: `c:${id}`,
        title: t(label),
        detail: t("palette.settings"),
        icon: <Icons.Settings size={15} />,
        run: close(() => go.config(id)),
      })),
    ].map((i) => ({ ...i, group: "palette.places" as MessageKey }));
    const chats: Item[] = Object.values(threads)
      .filter(isListed)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((th) => ({
        key: `t:${th.id}`,
        group: "palette.chats",
        title: th.title || t("palette.untitled"),
        ...(th.preview ? { detail: th.preview } : {}),
        icon: <Icons.MessageSquare size={15} />,
        run: close(() => go.thread(th.id)),
      }));
    const projectItems: Item[] = projects.map((p) => ({
      key: `p:${p.id}`,
      group: "palette.projects",
      title: p.name,
      ...(p.path ? { detail: p.path } : {}),
      icon: <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} size={18} />,
      run: close(() => go.project(p.id)),
    }));
    const agentItems: Item[] = Object.values(agents).map((a) => ({
      key: `a:${a.id}`,
      group: "palette.agents",
      title: a.name,
      ...(a.role ? { detail: a.role } : {}),
      icon: <AgentAvatar name={a.name} blob={a.blob} size={18} animated={false} />,
      run: close(() => {
        const chat = Object.values(threads)
          .filter((th) => isListed(th) && th.agent_ids?.[0] === a.id)
          .sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0];
        if (chat) go.thread(chat.id);
        else go.inbox();
      }),
    }));
    const taskItems: Item[] = tasks.map((task) => ({
      key: `k:${task.id}`,
      group: "palette.tasks",
      title: task.title,
      ...(task.description ? { detail: task.description.slice(0, 120) } : {}),
      icon: <Icons.CircleDashed size={15} />,
      run: close(() => go.thread(task.thread_id)),
    }));
    const groups = [chats, projectItems, agentItems, taskItems, places];
    // With nothing typed: the latest chats and the places; with words: what matches, a few per group.
    if (!words.length) return [...chats.slice(0, 5), ...places];
    return groups.flatMap((g) =>
      g.filter((i) => matches(`${i.title} ${i.detail ?? ""}`, words)).slice(0, MAX_PER_GROUP),
    );
  }, [query, threads, projects, agents, tasks, t]);

  useEffect(() => {
    list.current?.querySelector(".palette__item.is-on")?.scrollIntoView({ block: "nearest" });
  });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setAt((i) => (items.length ? (i + step + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[at]?.run();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => go.palette(o)}
      title={t("palette.title")}
      bare
      size="lg"
      className="palette"
    >
      <div className="palette__box">
        <Icons.Search size={16} />
        <input
          autoFocus
          className="palette__input"
          aria-label={t("palette.title")}
          aria-controls="palette-list"
          aria-activedescendant={items[at] ? `palette-${items[at].key}` : undefined}
          placeholder={t("topbar.search")}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setAt(0);
          }}
          onKeyDown={onKey}
        />
        <Kbd keys={["esc"]} />
      </div>
      <div className="palette__list" id="palette-list" role="listbox" ref={list} aria-label={t("palette.title")}>
        {!items.length && <div className="palette__empty">{t("palette.none")}</div>}
        {items.map((item, i) => (
          <div key={item.key}>
            {(i === 0 || items[i - 1]?.group !== item.group) && <div className="palette__group">{t(item.group)}</div>}
            <div
              id={`palette-${item.key}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === at}
              className={`palette__item${i === at ? " is-on" : ""}`}
              onMouseMove={() => i !== at && setAt(i)}
              onClick={item.run}
              onKeyDown={(e) => e.key === "Enter" && item.run()}
            >
              <span className="palette__icon">{item.icon}</span>
              <span className="palette__title">{item.title}</span>
              {item.detail && <span className="palette__detail">{item.detail}</span>}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
