// The super-agent's turn answering a contact's agent reads, and asks the owner; it acts on nothing. Each call checks
// again that the contact's chat may still be answered (DECISIONS.md#d-269).
import { consultOpen, consultSeesFile } from "../domain/contact-consult.ts";
import type { Store } from "../domain/store.ts";
import type { Tool } from "../tools/types.ts";

/** Reads of that project's chats, its folder and the Drive files its chats used; ask_owner for the rest. */
const CONSULT_KEEPS = new Set([
  "ask_owner",
  "read_chat",
  "search_chats",
  "file_read",
  "drive_read",
  "sheets_read",
  "sheets_tabs",
  "read_output",
  "load_skill",
]);
/** These open a Drive file by id: only one this project's chats already used. */
const BY_FILE_ID = new Set(["drive_read", "sheets_read", "sheets_tabs"]);

export const WITHDRAWN = "your owner no longer lets this contact's chat be answered this way; answer nothing about it";

/** The consult's tools: none once the contact's chat may no longer be answered. */
export function consultTools(store: Store, threadId: string, tools: Tool[]): Tool[] {
  if (!consultOpen(store, threadId)) return [];
  return tools
    .filter((t) => CONSULT_KEEPS.has(t.name))
    .map((t) => ({
      ...t,
      async run(args, ctx) {
        if (!consultOpen(store, ctx.thread.id)) throw new Error(WITHDRAWN);
        if (BY_FILE_ID.has(t.name) && !consultSeesFile(store, ctx.thread, String(args.id ?? "")))
          throw new Error(
            "only Drive files this project's chats already used can be read here; find one with search_chats",
          );
        return t.run(args, ctx);
      },
    }));
}
