// The tools a turn may use: the agent's, narrowed by its callers, its chat (a contact's, the computer, a phone chat)
// and what is turned on; MCP's join behind the bridge on first use, and never in a contact's turn.
import { BROWSER_CAP } from "@apx/protocol";
import { memorySettings } from "../domain/memory-settings.ts";
import { answersChecked, type Origin } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { CONTACT_TOOLS, contactToolNames } from "../tools/contact.ts";
import { STICKER_TOOL, stickersFor } from "../tools/directory.ts";
import { IMESSAGE_TOOLS } from "../tools/imessage.ts";
import { MCP_CALL, MCP_SEARCH, mcpBridge } from "../tools/mcp-bridge.ts";
import { inherit } from "../tools/policy.ts";
import type { Tool } from "../tools/types.ts";
import { COMPUTER_TOOL } from "../tools/vm.ts";
import { WEB_TOOLS } from "../tools/web.ts";
import { callersOf } from "./ancestry.ts";
import { MAX_DEPTH } from "./limits.ts";
import type { Turn, TurnDeps } from "./turn.ts";

/** What only a caller may use: a delegate asks no one (DECISIONS.md#d-074). */
const SESSION_TOOLS = new Set(["delegate", "list_sessions", "stop_session"]);
const MEMORY_TOOLS = new Set(["remember", "recall", "forget", "search_owner_notes"]);
/**
 * The owner's turns on WhatsApp keep notes, write to people and rooms, and hand the rest off: a phone chat is no place
 * for tool cards, so other tool work goes to an agent of its own (delegate). A send stays here, since what the owner
 * asked to send cannot be relayed to another agent; its confirmation comes as numbered options.
 */
const HANDOFF_ONLY = new Set(["whatsapp"]);
const HANDOFF_TOOLS = new Set([
  ...MEMORY_TOOLS,
  "delegate",
  "list_agents",
  "read_output",
  "load_skill",
  "message_contact",
  "channel_post",
  "channel_list",
  "contact_list",
  STICKER_TOOL,
  "apx_settings",
  "read_chat",
]);

/**
 * What a Flow's AI model step leaves out unless it may delegate: handing work to other agents, their sessions and tasks
 * (a task or its comment wakes its assignee) (DECISIONS.md#d-171).
 */
const TEAM_TOOLS = new Set([
  ...SESSION_TOOLS,
  "list_agents",
  "grant_tool",
  "agent_set",
  "task_create",
  "task_update",
  "task_comment",
  "task_close",
]);
/**
 * A bot of a Flow speaks through the super-agent, who can read all the owner's chats, mail and calendar: it keeps only
 * tools that work on the task itself (the web, files and commands where it works, its own browser), never the owner's
 * data, memory, team or accounts (DECISIONS.md#d-171).
 */
const BOT_KEEPS = new Set([
  "web_search",
  "web_read",
  "video_transcript",
  "file_read",
  "file_write",
  "file_edit",
  "file_parallel",
  "shell",
  "shell_output",
  "shell_kill",
  "read_output",
  "load_skill",
  "make_image",
  "browser_open",
  "browser_snapshot",
  "browser_text",
  "browser_click",
  "browser_type",
  "task_get",
  "task_list",
]);

/** The kind of channel a message came on ("telegram"), for how the answer should look; none for the app. */
export function channelKindOf(store: Store, o: Origin, replyChannel?: string | null) {
  const channel = replyChannel === null ? undefined : (replyChannel ?? (o.kind === "channel" ? o.channel : undefined));
  if (!channel) return undefined;
  return store.settings.read("channels").find((c) => c.id === channel)?.type ?? channel;
}

const VM_BROWSER_TOOLS = new Set(["browser_open", "browser_snapshot", "browser_text", "browser_click", "browser_type"]);
/**
 * Host tools a chat on the computer keeps: they read nothing of the Mac's files or screen. APX's own work (tasks,
 * delegation, memory) and web look-ups run in the core as they do elsewhere (DECISIONS.md#d-154).
 */
const VM_HOST_TOOLS = new Set([
  "make_image",
  ...MEMORY_TOOLS,
  ...SESSION_TOOLS,
  "list_agents",
  "read_output",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
  "task_comment",
  "task_close",
  "web_search",
  "web_read",
]);

/** The tools this turn may use: the agent's, narrowed by whoever asked for it up the chain; a contact's, by their flags. */
export async function turnTools(deps: TurnDeps, turn: Turn) {
  const inVm = deps.vm?.hasThread(turn.thread.id);
  // Offered only to an agent the owner allowed: one without it never asks to use it (DECISIONS.md#d-154).
  const computerOn = Boolean(deps.vm?.serves(turn.thread.id) && deps.vm.permitted(turn.agent.id, turn.thread.id));
  const sealed = turn.audience.kind === "contact";
  const callers = callersOf(deps.store, turn.thread.id);
  const step = deps.store.threads.context(turn.thread.id).flow_step;
  // MCP tools are reached through mcp_search and mcp_call; their servers start only when one is first used.
  const servers = !sealed && !inVm && deps.mcpTools ? (deps.mcpServers?.(turn.thread) ?? []) : [];
  let loading: Promise<Tool[]> | undefined;
  // A contact's turn reaches no MCP tool, not even one it names without being offered it.
  const mcpLate = () => {
    if (inVm || sealed || step?.bot) return Promise.resolve([]);
    loading ??= (deps.mcpTools?.(turn.thread) ?? Promise.resolve([]))
      .catch(() => [])
      .then((all) => all.filter((t) => policy.allows(t.name) && (!only || only.has(t.name) || only.has(MCP_CALL))));
    return loading;
  };
  const bridge = servers.length ? mcpBridge(servers, mcpLate) : [];
  // With memory off, the tools that read or write it are not offered; iMessage's only once the owner turned it on; a
  // tool with `when` (an account's) only where it says.
  const memoryOn = memorySettings(deps.store).mode !== "off";
  const imessageOn = deps.store.settings.read("imessage").on;
  // Offered only on a turn from a channel with stickers to send; the tool reads that channel itself.
  const stickersHere = stickersFor(deps.store, turn.input.origin, 1).length > 0;
  const offered = deps.tools.filter(
    (t) =>
      (t.name === COMPUTER_TOOL
        ? computerOn
        : t.name === STICKER_TOOL
          ? stickersHere
          : !inVm || t.name === "shell" || VM_BROWSER_TOOLS.has(t.name) || VM_HOST_TOOLS.has(t.name)) &&
      (memoryOn || !MEMORY_TOOLS.has(t.name)) &&
      (imessageOn || !IMESSAGE_TOOLS.has(t.name)) &&
      (!t.needsCap || (inVm && t.needsCap === BROWSER_CAP) || Boolean(deps.hasCap?.(t.needsCap))) &&
      (!t.when || t.when(turn.thread)),
  );
  // A contact's turn gets only what the owner allowed for that person (nothing by default); the owner's turns never
  // see the contact-only tools.
  const forContact =
    turn.audience.kind === "contact"
      ? new Set([...contactToolNames(turn.audience.person), ...(turn.web ? WEB_TOOLS : []), STICKER_TOOL])
      : new Set<string>();
  const narrowed = inherit(
    turn.agent,
    callers,
    sealed
      ? offered.filter((t) => forContact.has(t.name))
      : [...offered.filter((t) => !CONTACT_TOOLS.has(t.name)), ...bridge],
  );
  // The mode it acts in comes from the one place every permission question asks; its callers narrow its tools.
  const policy = { ...narrowed, agent: deps.permissions.agentIn(turn.agent, turn.thread.id) };
  // A worker asks no one, and keeps to the tools its caller named for it (when it named any).
  const named = turn.worker?.tools?.length ? new Set(turn.worker.tools) : undefined;
  const o = turn.input.origin;
  // The answer to the owner's words the super-agent checked is still their turn on that chat (DECISIONS.md#d-144).
  const ownerOnChannel = (o.kind === "channel" && o.role === "owner") || answersChecked(o);
  const replyChannel = turn.input.reply_to === null ? null : turn.input.reply_to?.channel;
  const handoff = ownerOnChannel && HANDOFF_ONLY.has(channelKindOf(deps.store, o, replyChannel) ?? "");
  const only = handoff ? new Set([...HANDOFF_TOOLS].filter((n) => !named || named.has(n))) : named;
  const out = step && !step.delegate ? TEAM_TOOLS : undefined;
  const tools = policy.tools.filter(
    (t) =>
      (!step?.bot || BOT_KEEPS.has(t.name)) &&
      !out?.has(t.name) &&
      ((callers.length < MAX_DEPTH && !turn.worker) || !SESSION_TOOLS.has(t.name)) &&
      (!only || only.has(t.name) || (t.name === MCP_SEARCH && only.has(MCP_CALL))),
  );
  return { policy, tools, mcpLate };
}
