import type { Agent, McpServerStatus, Thread } from "@apx/protocol";
import { type KeyboardEvent, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { cancel, compactThread } from "../../data/actions.ts";
import { setThreadModel } from "../../data/composer.ts";
import { forAgents, loadCatalog, modelOf, splitRef, useModels, withEffort } from "../../data/models.ts";
import { isNewChat, newChatId } from "../../data/newChat.ts";
import { listMcp, listSkills } from "../../data/resources.ts";
import { SlashList } from "../../lazy.ts";
import { go } from "../../shell/nav.ts";
import { type CommandId, commandOf, dollarQuery, dollarRank, slashItems } from "./slash.ts";
import type { Item } from "./slashItem.ts";

type Skills = ReadonlyArray<{ name: string; description: string }>;

/** A connector (MCP server) the agent can use here, as the "$" list and the + menu show it. */
export type Connector = { name: string; target: string };

const usable = (s: McpServerStatus) => s.enabled && !s.off_here && s.status !== "disabled" && s.status !== "off";

/**
 * The composer's menus: "/" at the start lists commands on the chat, then its skills; "$" at the end lists skills and
 * connectors. Arrows move, Enter or Tab picks, Esc closes. A pick only writes in the field (a command waits there for
 * Enter, a skill goes first so the core loads it, a connector is named); nothing is sent until the owner sends it. A
 * command with a list (model, effort) fills the field so typing narrows it.
 */
export function useSlashMenu(o: {
  thread: Thread;
  agent: Agent | undefined;
  /** A group's members, offered after "@". */
  members?: Agent[] | undefined;
  text: string;
  setText: (v: string) => void;
  busy: boolean;
  onNew?: (id: string) => void;
}) {
  const { thread, agent, text, setText } = o;
  const id = useId();
  const catalog = useModels((s) => s.catalog);
  const catalogLoad = useModels((s) => s.catalogLoad);
  const [skills, setSkills] = useState<Skills | undefined>();
  const [active, setActive] = useState(0);
  const [closedFor, setClosedFor] = useState<string | undefined>();
  const [connectors, setConnectors] = useState<Connector[] | undefined>();
  // What was in the field when the + menu opened the "/" menu: it comes back once the command is done or erased.
  const held = useRef("");
  // An engine session (Claude Code, Codex) has its own skills and context: APX's are not offered there.
  const direct = Boolean(thread.engine);
  const slashOpen = text.startsWith("/") && !text.includes("\n") && closedFor !== text;
  const dollar = direct || closedFor === text ? undefined : dollarQuery(text);
  const at = o.members && closedFor !== text ? dollarQuery(text, "@") : undefined;
  const open = slashOpen || dollar !== undefined || at !== undefined;
  // A new chat not made yet has nothing to compact.
  const fresh = isNewChat(thread.id);

  const loadConnectors = () => {
    if (connectors !== undefined || direct) return;
    setConnectors([]);
    void listMcp(thread.project_id).then((all) =>
      setConnectors((all ?? []).filter(usable).map((s) => ({ name: s.name, target: s.target }))),
    );
  };
  // Read once a menu first opens, not for every chat painted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadConnectors reads once
  useEffect(() => {
    if (!open) return;
    if (skills === undefined && !direct)
      void listSkills(thread.project_id).then((all) => setSkills((all ?? []).filter((s) => s.on !== false)));
    if (dollar) loadConnectors();
    if (catalogLoad === "idle") void loadCatalog();
  }, [open, Boolean(dollar), skills, direct, thread.project_id, catalogLoad]);

  const current = thread.model_choice?.model ?? agent?.model_choice?.model;
  const items = useMemo((): Item[] => {
    if (!open) return [];
    if (at)
      return dollarRank(
        (o.members ?? []).map((a) => ({
          kind: "agent" as const,
          name: a.name,
          description: a.role ?? "",
          // How the core finds it: its name when it is one word, else its file name or id.
          tag: /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(a.name) ? a.name : (a.slug ?? a.id),
        })),
        at.query,
      );
    if (dollar)
      return dollarRank(
        [
          ...(skills ?? []).map((x) => ({ kind: "skill" as const, name: x.name, description: x.description })),
          ...(connectors ?? []).map((c) => ({ kind: "mcp" as const, name: c.name, description: c.target })),
        ],
        dollar.query,
      );
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
  }, [open, at, o.members, dollar, text, catalog, skills, connectors, direct, fresh, thread.engine, current, o.busy]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of the typed text decides it
  useEffect(() => {
    if (text.startsWith("/")) return;
    const kept = held.current;
    held.current = "";
    if (kept && !text) setText(kept);
  }, [text]);

  // A new list starts at its first row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on every change of the typed text
  useEffect(() => setActive(0), [text]);

  const router = thread.model_choice?.router ?? true;
  /** Runs a command the field held when the owner sent it; false when it is not one to run here. */
  const runCommand = (id: CommandId): boolean => {
    if (direct && (id === "compact" || id === "skills")) return false;
    switch (id) {
      case "new":
        // Made with its first message, like any new chat.
        if (agent)
          (o.onNew ?? go.thread)(
            newChatId({ agent: agent.id, ...(thread.project_id ? { project: thread.project_id } : {}) }),
          );
        break;
      case "compact":
        if (!fresh) void compactThread(thread.id);
        break;
      case "stop":
        void cancel(thread.id);
        break;
      case "usage":
        go.panel("usage");
        break;
      case "skills":
        go.resources("skills");
        break;
    }
    return true;
  };
  const pick = (item: Item) => {
    if (item.kind === "agent") return at && setText(`${text.slice(0, at.start)}@${item.tag} `);
    if (dollar) {
      const before = text.slice(0, dollar.start).trimEnd();
      // A skill named first is loaded whole by the core; a connector is named where it was typed.
      if (item.kind === "skill") return setText(before ? `/${item.name} ${before} ` : `/${item.name} `);
      return setText(`${before ? `${before} ` : ""}$${item.kind === "mcp" ? item.name : ""} `);
    }
    if (item.kind === "command") return setText(`/${item.id} `);
    if (item.kind === "skill" || item.kind === "mcp") {
      const rest = held.current;
      held.current = "";
      return setText(rest ? `/${item.name} ${rest}` : `/${item.name} `);
    }
    // A model or an effort is a setting of the chat, not words: it changes and the field gives back what it held.
    const rest = held.current;
    held.current = "";
    setText(rest);
    if (item.kind === "model") return void setThreadModel(thread.id, { model: item.ref, router });
    return current && void setThreadModel(thread.id, { model: withEffort(current, item.effort), router });
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
      pick(item);
      return true;
    }
    return false;
  };

  const optId = (i: number) => `${id}-o${i}`;
  const shown = open && items.length > 0;
  const popup = shown ? (
    <Suspense fallback={null}>
      <SlashList
        id={id}
        items={items}
        active={active}
        dollar={Boolean(dollar)}
        optId={optId}
        onHover={setActive}
        onPick={pick}
      />
    </Suspense>
  ) : undefined;

  return {
    popup,
    onKey,
    /** The + menu's "Commands": a "/" in the field (what it held comes back after). */
    commands: () => {
      if (!text.startsWith("/")) held.current = text.trim();
      setClosedFor(undefined);
      setText("/");
    },
    /** The + menu's "Use a skill": a "$" at the end of the field lists skills and connectors. */
    skills: () => {
      setClosedFor(undefined);
      setText(text.trim() ? `${text.trimEnd()} $` : "$");
    },
    /** Names a connector in the field, as picking it after "$" does. */
    connector: (name: string) => setText(`${text.trim() ? `${text.trimEnd()} ` : ""}$${name} `),
    connectors,
    loadConnectors,
    /** The command the field holds, run instead of sent; undefined when the field is a message. */
    command: (value: string): (() => void) | undefined => {
      const id = commandOf(value);
      if (!id || (direct && (id === "compact" || id === "skills"))) return undefined;
      return () => {
        runCommand(id);
      };
    },
    aria: { controls: `${id}-list`, expanded: shown, activedescendant: shown ? optId(active) : undefined },
  };
}
