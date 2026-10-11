import type { Agent, Thread } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { cancel, compactThread } from "../../data/actions.ts";
import { setThreadModel } from "../../data/composer.ts";
import { forAgents, loadCatalog, modelOf, splitRef, useModels, withEffort } from "../../data/models.ts";
import { isNewChat, newChatId } from "../../data/newChat.ts";
import { listSkills } from "../../data/resources.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { type CommandId, type SlashItem, slashItems } from "./slash.ts";

const ICON: Record<CommandId, ReactNode> = {
  new: <Icons.SquarePen size={14} />,
  compact: <Icons.Layers size={14} />,
  model: <Icons.Sparkles size={14} />,
  effort: <Icons.Brain size={14} />,
  stop: <Icons.Square size={14} />,
  usage: <Icons.Activity size={14} />,
  skills: <Icons.BookOpen size={14} />,
};

type Skills = ReadonlyArray<{ name: string; description: string }>;

/**
 * The "/" menu of a chat's composer: commands on the chat, then its skills. Arrows move, Enter or Tab picks, Esc
 * closes; a command with a list (model, effort) fills the field so typing narrows it.
 */
export function useSlashMenu(o: {
  thread: Thread;
  agent: Agent | undefined;
  text: string;
  setText: (v: string) => void;
  busy: boolean;
}) {
  const { thread, agent, text, setText } = o;
  const t = useT();
  const id = useId();
  const catalog = useModels((s) => s.catalog);
  const catalogLoad = useModels((s) => s.catalogLoad);
  const [skills, setSkills] = useState<Skills | undefined>();
  const [active, setActive] = useState(0);
  const [closedFor, setClosedFor] = useState<string | undefined>();
  const open = text.startsWith("/") && !text.includes("\n") && closedFor !== text;
  // An engine session (Claude Code, Codex) has its own skills and context: APX's are not offered there.
  const direct = Boolean(thread.engine);
  // A new chat not made yet has nothing to compact.
  const fresh = isNewChat(thread.id);

  // Read once the menu first opens, not for every chat painted.
  useEffect(() => {
    if (!open) return;
    if (skills === undefined && !direct)
      void listSkills(thread.project_id).then((all) => setSkills((all ?? []).filter((s) => s.on !== false)));
    if (catalogLoad === "idle") void loadCatalog();
  }, [open, skills, direct, thread.project_id, catalogLoad]);

  const current = thread.model_choice?.model ?? agent?.model_choice?.model;
  const items = useMemo(() => {
    if (!open) return [];
    const models = catalog
      .filter((e) => (direct ? e.id === thread.engine : forAgents(e)))
      .flatMap((e) => e.models.filter((m) => m.chat).map((m) => ({ ref: `${e.id}/${m.id}`, label: m.name })));
    return slashItems(text, {
      busy: o.busy,
      skills: direct ? [] : (skills ?? []),
      models,
      currentModel: current ? withEffort(current, undefined) : undefined,
      efforts: current ? (modelOf(current, catalog)?.efforts ?? []) : [],
      currentEffort: current ? splitRef(current).effort : undefined,
    })
      .filter((i) => !(direct && i.kind === "command" && (i.id === "compact" || i.id === "skills")))
      .filter((i) => !(fresh && i.kind === "command" && i.id === "compact"));
  }, [open, text, catalog, skills, direct, fresh, thread.engine, current, o.busy]);

  // A new list starts at its first row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on every change of the typed text
  useEffect(() => setActive(0), [text]);

  const router = thread.model_choice?.router ?? true;
  const run = (item: SlashItem) => {
    if (item.kind === "skill") return setText(`/${item.name} `);
    if (item.kind === "model") {
      setText("");
      return void setThreadModel(thread.id, { model: item.ref, router });
    }
    if (item.kind === "effort") {
      setText("");
      return current && void setThreadModel(thread.id, { model: withEffort(current, item.effort), router });
    }
    if (item.sub) return setText(`/${item.id} `);
    setText("");
    switch (item.id) {
      case "new":
        // Made with its first message, like any new chat.
        return (
          agent &&
          go.thread(newChatId({ agent: agent.id, ...(thread.project_id ? { project: thread.project_id } : {}) }))
        );
      case "compact":
        return void compactThread(thread.id);
      case "stop":
        return void cancel(thread.id);
      case "usage":
        return go.panel("usage");
      case "skills":
        return go.resources("skills");
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !items.length || e.nativeEvent.isComposing) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + items.length) % items.length);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setClosedFor(text);
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      const item = items[Math.min(active, items.length - 1)];
      if (!item) return false;
      e.preventDefault();
      run(item);
      return true;
    }
    return false;
  };

  const optId = (i: number) => `${id}-o${i}`;
  const shown = open && items.length > 0;
  const popup = shown ? (
    <div className="slash" id={`${id}-list`} role="listbox" aria-label={t("slash.label")}>
      {items.map((item, i) => (
        <div
          key={rowKey(item)}
          id={optId(i)}
          role="option"
          aria-selected={i === active}
          tabIndex={-1}
          className={`slash__row${i === active ? " is-active" : ""}`}
          onMouseEnter={() => setActive(i)}
          // Keep the focus in the field: the pick happens on mouse down, before the blur.
          onMouseDown={(e) => {
            e.preventDefault();
            run(item);
          }}
        >
          <Row item={item} />
        </div>
      ))}
    </div>
  ) : undefined;

  return {
    popup,
    onKey,
    aria: { controls: `${id}-list`, expanded: shown, activedescendant: shown ? optId(active) : undefined },
  };
}

const rowKey = (i: SlashItem) =>
  i.kind === "command" ? `c:${i.id}` : i.kind === "skill" ? `s:${i.name}` : i.kind === "model" ? i.ref : i.effort;

function Row({ item }: { item: SlashItem }) {
  const t = useT();
  if (item.kind === "command")
    return (
      <>
        <span className="slash__icon">{ICON[item.id]}</span>
        <span className="slash__name">/{item.id}</span>
        <span className="slash__desc">{t(`slash.${item.id}` as MessageKey)}</span>
      </>
    );
  if (item.kind === "skill")
    return (
      <>
        <span className="slash__icon">
          <Icons.BookOpen size={14} />
        </span>
        <span className="slash__name">/{item.name}</span>
        <span className="slash__desc">{item.description || t("slash.skill")}</span>
      </>
    );
  const name = item.kind === "model" ? item.label : item.effort;
  const desc = item.kind === "model" ? item.ref : t("slash.effortRow");
  return (
    <>
      <span className="slash__icon">{item.current ? <Icons.Check size={14} /> : null}</span>
      <span className="slash__name">{name}</span>
      <span className="slash__desc">{desc}</span>
    </>
  );
}
