// The owner's terminals in the folder a chat works in (see terminal/terminals.ts).
import fs from "node:fs";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import type { Terminals } from "../terminal/terminals.ts";
import { workDir } from "../tools/folders.ts";
import type { Handlers } from "./router.ts";

export function terminalHandlers(store: Store, terminals: Terminals, home: string) {
  /** Where the chat's agent runs its own commands: its folder, its project's, or else APX's work folder. */
  const folderOf = (threadId: string) => {
    if (store.settings.read("computer_chats").includes(threadId))
      throw badRequest("use the VM terminal in the Computer panel");
    const t = store.threads.get(threadId);
    if (!t) throw notFound(`thread ${threadId}`);
    const dir = workDir(store, home, t);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const known = <T>(work: () => T): T => {
    try {
      return work();
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    "terminal.list": ({ thread }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      return { terminals: terminals.list(thread) };
    },
    "terminal.open": ({ thread, cols, rows, command, message }) => {
      const cwd = folderOf(thread);
      if (message && store.messages.get(message)?.thread_id !== thread)
        throw badRequest(`message ${message} is not in this chat`);
      return known(() => terminals.open(thread, cwd, { cols, rows }, command ? { command, message } : undefined));
    },
    "terminal.attach": ({ terminal }) => known(() => terminals.attach(terminal)),
    "terminal.input": ({ terminal, data }) => {
      known(() => terminals.input(terminal, data));
      return { ok: true as const };
    },
    "terminal.resize": ({ terminal, cols, rows }) => {
      known(() => terminals.resize(terminal, { cols, rows }));
      return { ok: true as const };
    },
    "terminal.close": ({ terminal }) => {
      known(() => terminals.close(terminal));
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
