import { badRequest, conflict, notFound } from "../errors.ts";
import { writeAtomic } from "../paths.ts";
import {
  readSource,
  SOURCE_MAX_BYTES,
  type Source,
  type SourceUpdate,
  saveSources,
  sourceBound,
  sourceHash,
  sourceState,
} from "./contact-source-state.ts";
import { HOME_THREAD_ID } from "./seed.ts";
import { newId, now } from "./sql.ts";
import type { Store } from "./store.ts";

type Allowed = (id: string, thread: string, agent: string) => Source;
export function contactSourceUpdates(store: Store, allowed: Allowed) {
  return {
    propose(
      threadId: string,
      agentId: string,
      runId: string,
      id: string,
      revision: string,
      old: string,
      replacement: string,
    ) {
      const source = allowed(id, threadId, agentId);
      const doc = readSource(store, source);
      if (doc.revision !== revision || source.revision !== revision) throw conflict("source changed; consult it again");
      if (
        !old ||
        old.length > 8000 ||
        replacement.length > 8000 ||
        doc.text.split(old).length !== 2 ||
        old === replacement
      )
        throw badRequest("give one exact passage and its changed replacement");
      const run = store.runs.get(runId);
      const origin = run?.input?.origin;
      if (
        run?.thread_id !== threadId ||
        run.agent_id !== agentId ||
        origin?.kind !== "channel" ||
        origin.role !== "contact" ||
        origin.person_id !== source.person ||
        origin.channel !== store.threads.get(threadId)?.channel?.id
      )
        throw badRequest("only a contact's incoming message can propose a correction");
      return store.tx(() => {
        const current = sourceState(store);
        const duplicate = current.updates.find(
          (u) => u.source === id && u.revision === revision && u.old === old && u.replacement === replacement,
        );
        if (duplicate) return duplicate;
        if (
          current.updates.filter((u) => u.person === source.person && ["pending", "applying"].includes(u.state))
            .length >= 5
        )
          throw badRequest("corrections already await the owner; nothing changed");
        const update: SourceUpdate = {
          id: newId("csup"),
          source: id,
          revision,
          old,
          replacement,
          state: "pending",
          person: source.person,
          channel: origin.channel,
          thread: threadId,
          run: runId,
          ...(origin.message_id ? { message: origin.message_id } : {}),
          created_at: now(),
        };
        current.updates.push(update);
        saveSources(store, current);
        const en = store.settings.get("owner_language") === "en";
        store.notifications.add({
          kind: "agent",
          ref: `contact-source:${update.id}`,
          thread_id: HOME_THREAD_ID,
          title: en ? "Review a contact's correction" : "Revisá una corrección de un contacto",
          body: en
            ? "Ask your super-agent to review the proposed document update. Nothing has been changed."
            : "Pedile a tu super-agente que revise la actualización propuesta. Todavía no se cambió nada.",
        });
        return update;
      });
    },
    updates(person?: string) {
      return sourceState(store).updates.filter((u) => !person || u.person === person);
    },
    resolve(id: string, accept: boolean) {
      return resolve(store, id, accept);
    },
  };
}

function resolve(store: Store, id: string, accept: boolean) {
  const current = sourceState(store);
  const update = current.updates.find((u) => u.id === id);
  if (!update) throw notFound("source update");
  if (["accepted", "rejected"].includes(update.state)) return update;
  if (!accept && update.state === "applying") throw conflict("finish the already approved update before rejecting it");
  if (accept) {
    const source = current.sources.find((s) => s.id === update.source);
    if (!source || !sourceBound(store, source)) throw conflict("source authorization changed");
    if (!source.allow_updates)
      throw conflict("this reference is read-only; only an explicitly editable record can be updated");
    const doc = readSource(store, source);
    const recovered = update.state === "applying" && doc.revision === update.result_revision;
    if (source.revision !== update.revision || (!recovered && doc.revision !== update.revision))
      throw conflict("source changed; review a new proposal");
    if (!recovered) {
      const after = doc.text.replace(update.old, update.replacement);
      if (doc.text.split(update.old).length !== 2 || Buffer.byteLength(after) > SOURCE_MAX_BYTES)
        throw conflict("proposed passage changed or is too large");
      update.state = "applying";
      update.result_revision = sourceHash(after);
      saveSources(store, current);
      try {
        writeAtomic(doc.at, after, doc.mode, () => {
          const check = readSource(store, source);
          const live = sourceState(store).sources.find((s) => s.id === source.id);
          if (check.revision !== update.revision || !sourceBound(store, source) || live?.revision !== source.revision)
            throw conflict("source changed before saving");
        });
      } catch {
        // The approved journal survives a restart; retry verifies either the old or the exact new bytes.
        throw conflict("approved correction could not be saved; retry after reviewing the source");
      }
    }
    if (update.result_revision) source.revision = update.result_revision;
  }
  update.state = accept ? "accepted" : "rejected";
  store.tx(() => {
    saveSources(store, current);
    store.notifications.resolve("agent", `contact-source:${id}`);
  });
  return update;
}
