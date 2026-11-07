import type { Autonomy } from "@apx/protocol";
import { memorySettings } from "../domain/memory-settings.ts";
import { ownerTimeZone } from "../domain/owner.ts";
import type { RunRecord } from "../domain/runs.ts";
import { computerBriefing, HOME_COMPUTER } from "../environments/briefing.ts";
import { AGENT_WORKSPACE } from "../environments/worker.ts";
import { systemNote } from "../harness/native.ts";
import type { ChatItem } from "../providers/types.ts";
import { askedSkill } from "../skills/picker.ts";
import { agentSkills, skillCatalog, skillsFor } from "../skills/skills.ts";
import { contactToolNames } from "../tools/contact.ts";
import { readOnlyFolders, workDir } from "../tools/folders.ts";
import { chatPlanBlock } from "../tools/plan.ts";
import { waitingBlock } from "../tools/requests.ts";
import { untrusted } from "../tools/result.ts";
import { attachmentsBlock } from "./attachments.ts";
import { ownerInstruction, roomInput } from "./audience.ts";
import { memoryQuery, recallChats } from "./chat-recall.ts";
import {
  CHAT_CHANNELS,
  COMPUTER_WORKSPACE,
  frameInput,
  HISTORY_BUDGET_CHARS,
  type InputBlock,
  joinInput,
  project,
  releaseBlock,
  rosterBlock,
  type Sections,
  turnBlocks,
  workspaceBlock,
} from "./context.ts";
import { flowEditorBlock } from "./flow-editor.ts";
import { lastTalk, unasked } from "./last-talk.ts";
import { memoryHistory, snapshotOf, visibleMemoryRuns, windowRuns } from "./memory-projection.ts";
import { ratingNote, sentMeanwhile } from "./nudges.ts";
import { taskBlock } from "./office.ts";
import { LIMIT_RESUME_NOTE } from "./provider-limit.ts";
import { recallFor } from "./recall.ts";
import { RESUME_NOTE } from "./recovery.ts";
import { askedPick } from "./skill-pick.ts";
import type { Turn, TurnDeps } from "./turn.ts";
import { channelKindOf } from "./turn-tools.ts";

export async function buildContext(deps: TurnDeps, turn: Turn, run: RunRecord, mode: Autonomy) {
  const { store } = deps;
  const { agent, thread } = turn;
  // A contact's turn knows nothing of the owner's: no notes, no roster, no skills. An engine session is the engine
  // itself: none of an agent's notes, roster, skills or framing either.
  const direct = Boolean(thread.engine);
  const sealed = turn.audience.kind === "contact" || direct;
  const ctxState = store.threads.context(thread.id);
  // A bot of a Flow keeps no memory; a Flow step that may not delegate needs no roster (DECISIONS.md#d-172).
  const step = ctxState.flow_step;
  const remembers = !sealed && !step?.bot && memorySettings(store).mode !== "off";
  // A public room's turn reads the room's latest messages instead of a history of its own.
  const room = turn.audience.kind === "contact" ? turn.audience.room : undefined;
  const entries = memoryHistory(store, store.modelLog.list(thread.id), agent.id, thread.project_id);
  const projected = room
    ? { items: [] as ChatItem[], from: 0 }
    : project(entries, HISTORY_BUDGET_CHARS, ctxState.compaction);
  const { from } = projected;
  const roster = rosterBlock(agent, store.agents.list(), thread);
  const told = sectionsFor(deps, turn, mode);
  // An agent allowed the computer reads its state each turn, as the owner sees it in the panel.
  const vm = deps.vm;
  const allowed = vm && !sealed && vm.permitted(agent.id, thread.id);
  const computer = !allowed
    ? undefined
    : vm.serves(thread.id)
      ? computerBriefing(await vm.status(thread.id, true), agent.id, thread.id, told.computer === "chat")
      : thread.kind === "home" && told.computer !== "home"
        ? HOME_COMPUTER
        : undefined;
  // A worker delegates to no one: it needs no roster.
  const rosterChanged =
    !sealed &&
    !turn.worker &&
    (!step || step.delegate) &&
    (ctxState.roster_hash !== roster.hash || ctxState.roster_agent !== agent.id);
  const available = sealed
    ? []
    : agentSkills(agent, skillsFor(store, { home: deps.home, apps: deps.skillApps }, thread.project_id));
  // A skill named with "/name" goes in as asked; otherwise skills are weighed while notes are recalled (both wait on
  // the embedding engine).
  const asked = askedSkill(turn.input.text, available);
  const picking = asked ? Promise.resolve(askedPick(asked)) : deps.skills?.pick(turn.input.text, available);
  const recalled = remembers
    ? await recallFor(
        store,
        deps.memory.search,
        agent.id,
        thread,
        memoryQuery(store, thread.id, turn.input.text),
        ctxState,
        from,
        turn.input.origin.kind === "agent",
      )
    : {};
  const chats = remembers
    ? await recallChats(store, deps.memory, agent.id, thread, turn.input.text, {
        excludeRuns: visibleMemoryRuns(store, entries, from, run.id),
      })
    : undefined;
  const picked = await picking;
  // A plugin's context is for the owner's own turns only (not other agents', apps' or contacts'), as outside data.
  const o = turn.input.origin;
  const ownerTurn =
    o.kind === "user" ||
    o.kind === "input_answer" ||
    o.kind === "routine" ||
    (o.kind === "channel" && o.role === "owner");
  const extra =
    !sealed && ownerTurn && deps.hooks
      ? await deps.hooks.context({
          thread: { id: thread.id, kind: thread.kind, title: thread.title, project_id: thread.project_id },
          agent: { id: agent.id, name: agent.name },
          text: turn.input.text.slice(0, 4000),
        })
      : undefined;
  // In a contact's chat the owner's own words (typed in the app) say what to answer that contact (a room's: roomInput).
  const said =
    turn.audience.kind === "contact" && !turn.audience.room && o.kind === "user"
      ? ownerInstruction(turn.audience.name, turn.input.text)
      : turn.input.text;
  const files = attachmentsBlock(
    store,
    turn.input.attachments ?? [],
    turn.audience.kind === "contact" ? undefined : { home: deps.home, thread },
  );
  const liveThread = store.threads.get(thread.id);
  if (!liveThread || liveThread.project_id !== thread.project_id || !liveThread.agent_ids.includes(agent.id))
    throw new Error("chat access changed while preparing its context");
  const memoryBlock =
    memorySettings(store).mode !== "off" ? [recalled.text, chats?.render()].filter(Boolean).join("\n") : "";
  const images = (turn.input.attachments ?? []).filter((a) => a.kind === "image");
  const message = (text: string): InputBlock[] => [{ name: "message", text }];
  // A resumed turn already has its message in the history: it only learns why it stopped.
  const resumeNote =
    turn.input.resume_of && store.runs.get(turn.input.resume_of)?.end_reason === "provider_limit"
      ? LIMIT_RESUME_NOTE
      : RESUME_NOTE;
  const blocks: InputBlock[] = turn.input.resume_of
    ? message(String(systemNote(resumeNote).content))
    : room
      ? message(
          roomInput(store, {
            threadId: thread.id,
            runId: run.id,
            agentName: agent.name,
            from: o.kind === "channel" ? o.name : "your owner",
            owner: o.kind !== "channel" || o.role === "owner",
            text: said,
            app: o.kind === "user",
          }),
        )
      : direct
        ? // An engine session gets no header, but a result or outside text still says what it is and what to do.
          message(o.kind === "go_on" ? said : frameInput(o, files ? `${said}\n\n${files}` : said))
        : turnBlocks({
            origin: turn.input.origin,
            text: files ? `${said}\n\n${files}` : said,
            now: new Date(),
            roster: rosterChanged ? roster.text : undefined,
            memory: memoryBlock,
            skills: picked?.block || undefined,
            task: taskBlock(store, thread),
            plan: chatPlanBlock(store, thread),
            flowEditor: ownerTurn ? flowEditorBlock(store, thread.id) : undefined,
            extension: extra ? untrusted("extension_context", { from: extra.from }, extra.text) : undefined,
            waiting: !sealed && ownerTurn && o.kind !== "routine" ? waitingBlock(store, agent.id) : undefined,
            timeZone: ownerTimeZone(store),
            channel: channelKindOf(store, o, turn.input.reply_to === null ? null : turn.input.reply_to?.channel),
            voice: o.kind === "channel" && Boolean(store.threads.context(thread.id).voice_replies),
            // A contact turn with no tools makes no call that could wait: it needs no mode.
            mode: turn.audience.kind === "contact" && !told.mode ? undefined : mode,
            told,
            workspace: deps.vm?.hasThread(thread.id)
              ? told.onComputer
                ? `Folder: ${AGENT_WORKSPACE}, on the shared Linux computer`
                : COMPUTER_WORKSPACE(AGENT_WORKSPACE)
              : workspaceBlock(thread, readOnlyFolders(store, thread), workDir(store, deps.home, thread), told),
            computer,
            release: ownerTurn ? releaseBlock(store.threads.context(thread.id).release) : undefined,
            feedback: o.kind === "routine" ? ratingNote(store, `routine:${o.name}`) || undefined : undefined,
            // Only the super-agent recalls owner-wide notices in its direct and channel chats.
            meanwhile:
              (thread.kind === "home" ||
                (thread.kind === "channel" && turn.audience.kind === "owner" && agent.kind === "secretary")) &&
              (o.kind === "user" || (o.kind === "channel" && o.role === "owner"))
                ? sentMeanwhile(store, thread.id, run.id)
                : undefined,
            lastTalk:
              turn.audience.kind === "owner" && unasked(o)
                ? lastTalk(store, thread, new Date(), ownerTimeZone(store), run.id)
                : undefined,
          });
  const input: ChatItem & { role: "user" } = turn.input.resume_of
    ? (systemNote(resumeNote) as ChatItem & { role: "user" })
    : {
        role: "user",
        ...(images.length ? { images: images.map((a) => ({ media_id: a.media_id, mime: a.mime })) } : {}),
        content: room || direct ? (blocks[0] as InputBlock).text : joinInput(blocks),
      };
  const history = room
    ? []
    : project(
        memoryHistory(store, store.modelLog.list(thread.id), agent.id, thread.project_id),
        HISTORY_BUDGET_CHARS,
        store.threads.context(thread.id).compaction,
      ).items;
  const at = store.modelLog.append(
    thread.id,
    run.id,
    [input],
    snapshotOf(store, input.content, memoryBlock, agent.id, thread.project_id),
  );
  if (rosterChanged || recalled.shown)
    store.threads.mergeContext(thread.id, {
      ...(rosterChanged ? { roster_hash: roster.hash, roster_agent: agent.id } : {}),
      ...(recalled.shown ? recalled.shown(at) : {}),
    });
  const skills = sealed ? "" : skillCatalog(available);
  // A room's turn has no history of its own: only its run is in view.
  const inView = room ? new Set([run.id]) : windowRuns(entries, from, run.id);
  return { history, input, blocks, skills, picked, inView, told };
}

/** The fixed instructions this chat's turns call for, told once in its system prompt (context.ts sectionLines). */
function sectionsFor(deps: TurnDeps, turn: Turn, mode: Autonomy): Sections {
  const { store, vm } = deps;
  const { thread, agent, audience } = turn;
  if (thread.engine || (audience.kind === "contact" && audience.room)) return {};
  const contact = audience.kind === "contact";
  const on = store.settings.read("channels").filter((c) => c.enabled);
  const typeOf = (id: string) => on.find((c) => c.id === id)?.type ?? id;
  // A channel chat hears from its own account; Home covers every enabled account for direct super-agent work.
  const types = contact
    ? [typeOf(thread.channel?.id ?? "")]
    : thread.kind === "channel" && thread.channel
      ? [typeOf(thread.channel.id)]
      : thread.kind === "home"
        ? [...new Set([...on.map((c) => c.type), ...(store.settings.read("imessage").on ? ["imessage"] : [])])]
        : [];
  const chats = types.filter((t) => CHAT_CHANNELS.has(t));
  // A contact with no tools makes no call that could wait for the owner.
  const acts = !contact || turn.web || contactToolNames(audience.person).size > 0;
  const allowed = !contact && vm?.permitted(agent.id, thread.id);
  return {
    mode: acts ? mode : undefined,
    chats,
    ownerChats: contact ? [] : chats,
    voice: chats.length > 0 && Boolean(store.threads.context(thread.id).voice_replies),
    stickers: chats.some((t) => store.stickers.known(t, 1).length > 0),
    computer: allowed ? (vm?.serves(thread.id) ? "chat" : thread.kind === "home" ? "home" : undefined) : undefined,
    onComputer: Boolean(vm?.hasThread(thread.id)),
    write: thread.cwd && thread.write ? thread.write : undefined,
    // Project agents edit its files from task chats too, not only from a code folder's chat.
    edits:
      thread.cwd && thread.write
        ? thread.write !== "read-only"
        : !contact && acts && mode !== "plan" && Boolean(thread.project_id ?? agent.project_id),
  };
}
