// The owner's terminals: a shell in the folder a chat works in, on the core's machine. Only a human operator opens or
// types into one (never an agent, a channel or an app's token); its output comes back as terminal.output events.
import { z } from "zod";
import { Id } from "./domain.ts";

export const TerminalInfo = z.object({
  id: Id,
  thread_id: Id,
  title: z.string(),
  cwd: z.string(),
  alive: z.boolean(),
  /** false when this machine gives it no real tty (no Python): it still runs commands, without prompts or colors. */
  tty: z.boolean(),
  exit_code: z.number().int().optional(),
  started_at: z.string(),
});
export type TerminalInfo = z.infer<typeof TerminalInfo>;

const Size = { cols: z.number().int().min(20).max(500), rows: z.number().int().min(4).max(200) };

export const terminalMethods = {
  /** The chat's terminals, oldest first (a closed one stays listed until removed). */
  "terminal.list": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ terminals: z.array(TerminalInfo) }),
    effect: false,
    access: "human",
  },
  /** Starts the owner's shell in the chat's folder. */
  "terminal.open": {
    params: z.object({ thread: Id, ...Size }).strict(),
    result: TerminalInfo,
    effect: true,
    access: "human",
  },
  /** A terminal with what it printed so far (the last 256 KB), to draw it again before the live output. */
  "terminal.attach": {
    params: z.object({ terminal: Id }).strict(),
    result: z.object({ terminal: TerminalInfo, backlog: z.string() }),
    effect: false,
    access: "human",
  },
  /** Keys typed into it. */
  "terminal.input": {
    params: z.object({ terminal: Id, data: z.string().max(64 * 1024) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
    replay: false,
  },
  "terminal.resize": {
    params: z.object({ terminal: Id, ...Size }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
    replay: false,
  },
  /** Ends its shell (if running) and forgets it. */
  "terminal.close": {
    params: z.object({ terminal: Id }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
} as const;
