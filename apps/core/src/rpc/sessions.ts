// The owner's own Claude Code and Codex sessions: listed from where those CLIs keep them, and gone on with in APX as an
// engine session (the engine itself, in the session's folder, resuming its own transcript).
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { type NativeHomes, nativeSession, nativeSessions, nativeTranscript } from "../import/native-sessions.ts";
import type { Handlers } from "./router.ts";

/** What is copied into the APX chat so the owner sees where they left off (the engine has it all already). */
const SHOWN_TURNS = 40;
const TURN_CHARS = 8000;

/** The registered project whose folder holds `dir` (the deepest one), if any. */
function projectOf(store: Store, dir: string): string | undefined {
  let best: { id: string; len: number } | undefined;
  for (const p of store.projects.list()) {
    if (!p.path) continue;
    const root = path.resolve(p.path);
    if ((dir === root || dir.startsWith(`${root}${path.sep}`)) && root.length > (best?.len ?? -1))
      best = { id: p.id, len: root.length };
  }
  return best?.id;
}

export function sessionHandlers(store: Store, homes: NativeHomes) {
  return {
    "sessions.native": ({ engine, limit }) => {
      const taken = store.harnessSessions.sessionIds(engine);
      return {
        sessions: nativeSessions(homes, engine, limit ?? 100)
          .filter((s) => !taken.has(s.id))
          .map(({ id, title, cwd, updated_at }) => ({ id, title, cwd, updated_at })),
      };
    },
    "sessions.resume": ({ engine, id }) => {
      const already = store.harnessSessions.threadOf(engine, id);
      const open = already ? store.threads.get(already) : undefined;
      if (open) return open;
      const s = nativeSession(homes, engine, id);
      if (!s) throw notFound(`${engine} session ${id}`);
      if (!fs.existsSync(s.cwd)) throw badRequest(`the session's folder ${s.cwd} is not on this machine anymore`);
      const agent = store.agents.list().find((a) => a.kind === "secretary") ?? store.agents.list()[0];
      if (!agent) throw notFound("an agent to own the session");
      const turns = nativeTranscript(s, SHOWN_TURNS);
      return store.tx(() => {
        const t = store.threads.create({
          kind: "code",
          title: s.title,
          agent_ids: [agent.id],
          project_id: projectOf(store, s.cwd),
          cwd: s.cwd,
          write: "ask",
          engine,
        });
        store.threads.mergeContext(t.id, { model_choice: { model: engine, router: false } });
        store.harnessSessions.set(t.id, engine, id);
        for (const turn of turns)
          store.messages.add({
            thread_id: t.id,
            author: turn.role === "user" ? { kind: "user" } : { kind: "agent", id: agent.id },
            parts: [{ type: "text", text: turn.text.slice(0, TURN_CHARS) }],
            ...(turn.role === "assistant" ? { model: engine } : {}),
          });
        const last = turns.at(-1)?.text ?? "";
        return store.threads.patch(t.id, { preview: last.slice(0, 140) });
      });
    },
  } satisfies Partial<Handlers>;
}
