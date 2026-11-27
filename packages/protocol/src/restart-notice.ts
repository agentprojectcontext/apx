const RESTART_CODES: ReadonlySet<string> = new Set(["run.interrupted", "run.resumed"]);

/** What the core says after a restart cut a turn: a line of the system's, never the agent's words. */
export const isRestartNotice = (part: { type: string; code?: string }): boolean =>
  part.type === "notice" && RESTART_CODES.has(part.code ?? "");

/**
 * The messages whose restart line is not shown because a later one says it again (a turn resumed after one restart and
 * cut by the next): the latest stands for the run. An owner message in between starts the count over.
 */
export function supersededRestarts(
  messages: readonly { id: string; author: { kind: string }; parts: readonly { type: string; code?: string }[] }[],
): ReadonlySet<string> {
  const out = new Set<string>();
  let last: string | undefined;
  for (const m of messages) {
    if (m.author.kind === "user") last = undefined;
    else if (m.parts.some(isRestartNotice)) {
      if (last) out.add(last);
      last = m.id;
    }
  }
  return out;
}
