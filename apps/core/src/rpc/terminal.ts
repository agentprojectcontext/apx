// The owner's terminals in a chat's folder (see terminal/terminals.ts).
import type { Store } from "../domain/store.ts";
import { badRequest } from "../errors.ts";
import type { Terminals } from "../terminal/terminals.ts";
import { threadFolder } from "./files.ts";
import type { Handlers } from "./router.ts";

export function terminalHandlers(store: Store, terminals: Terminals) {
  const known = <T>(work: () => T): T => {
    try {
      return work();
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    "terminal.list": ({ thread }) => {
      threadFolder(store, thread);
      return { terminals: terminals.list(thread) };
    },
    "terminal.open": ({ thread, cols, rows }) =>
      known(() => terminals.open(thread, threadFolder(store, thread), { cols, rows })),
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
