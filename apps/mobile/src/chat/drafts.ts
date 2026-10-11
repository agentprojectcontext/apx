// The owner's unsent words per chat (and per new chat not made yet), kept on the phone: leaving a chat for another
// page or chat and coming back, or the app being closed, finds them where they were left.
import { File, Paths } from "expo-file-system";
import { AppState } from "react-native";

/** The oldest drafts go first past this many chats, and any after a month untouched. */
const MAX = 100;
const MAX_AGE = 30 * 24 * 60 * 60_000;

type Entry = { text: string; at: number };

let drafts: Map<string, Entry> | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;

const file = () => new File(Paths.document, "drafts.json");

function all(): Map<string, Entry> {
  if (drafts) return drafts;
  drafts = new Map();
  try {
    const f = file();
    if (!f.exists) return drafts;
    const fresh = Date.now() - MAX_AGE;
    for (const [id, e] of Object.entries(JSON.parse(f.textSync()) as Record<string, Partial<Entry>>))
      if (typeof e?.text === "string" && e.text && typeof e.at === "number" && e.at > fresh)
        drafts.set(id, { text: e.text, at: e.at });
  } catch {
    // Unreadable: drafts start over, in memory until the next write.
  }
  return drafts;
}

function save(): void {
  pending = undefined;
  const kept = [...all()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX);
  drafts = new Map(kept);
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Not written: the drafts still hold while the app runs.
  }
}

export function draftOf(chat: string): string {
  return all().get(chat)?.text ?? "";
}

/** Keeps `text` as the chat's draft; empty clears it. Written to the phone a moment later. */
export function keepDraft(chat: string, text: string): void {
  const map = all();
  if ((map.get(chat)?.text ?? "") === text) return;
  if (text) map.set(chat, { text, at: Date.now() });
  else map.delete(chat);
  pending ??= setTimeout(save, 400);
}

// The app may be closed from the background without notice: what is pending is written as it leaves the screen.
AppState.addEventListener("change", (state) => {
  if (state === "active" || pending === undefined) return;
  clearTimeout(pending);
  save();
});
