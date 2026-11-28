// The super-agent's button in the middle of the bottom bar (and its bubble): what a tap does, and which chat a voice
// note recorded on it goes to. Plain functions, so they are tested without a phone.
import { textOrder } from "../format.ts";
import type { Thread } from "../hooks/useWorkspace";

/** A call when this phone can carry one and the computer says calls work; otherwise hold to record a voice note. */
export type CenterMode = "call" | "record";

export function centerMode(phone: { nativeVoice: boolean; callsReady: boolean | undefined }): CenterMode {
  return phone.nativeVoice && phone.callsReady === true ? "call" : "record";
}

/** A chat the owner talks in with the super-agent: not a contact's, a session, a routine run, a task or a Flow step. */
export function isOwnChat(thread: Thread, agentId: string): boolean {
  return (
    !thread.archived &&
    thread.agent_ids.includes(agentId) &&
    !thread.channel &&
    !thread.engine &&
    !thread.routine_id &&
    !thread.task_id &&
    !thread.flow &&
    thread.kind !== "routine" &&
    thread.kind !== "task"
  );
}

const newest = (a: Thread, b: Thread) => textOrder(b.updated_at, a.updated_at);

/**
 * Where a voice note from the button goes: the super-agent's chat the owner pinned, else the last of its chats the
 * owner opened, else its latest chat. Undefined: there is none yet, and a new one is made with the note.
 */
export function voiceNoteTarget(threads: readonly Thread[], agentId: string, lastOpened?: string): Thread | undefined {
  const own = threads.filter((thread) => isOwnChat(thread, agentId)).sort(newest);
  return own.find((thread) => thread.pinned) ?? own.find((thread) => thread.id === lastOpened) ?? own[0];
}
