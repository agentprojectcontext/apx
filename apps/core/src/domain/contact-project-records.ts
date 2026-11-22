import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors.ts";
import { type SourceUpdate, saveSources, sourceHash, sourceState } from "./contact-source-state.ts";
import { HOME_THREAD_ID } from "./seed.ts";
import { newId, now } from "./sql.ts";
import type { Store } from "./store.ts";

const Record = z.object({
  id: z.string(),
  person: z.string(),
  agent: z.string(),
  project: z.string(),
  label: z.string(),
  text: z.string(),
  revision: z.string(),
});
const Records = z.array(Record);
const KEY = "contact_project_records";
type Binding = { person: string; agent: string; project: string };
const records = (store: Store) => Records.parse(JSON.parse(store.settings.get(KEY) ?? "[]"));
const matches = (r: Binding, b: Binding) => r.person === b.person && r.agent === b.agent && r.project === b.project;

function recordEdit(
  current: { text: string; revision: string } | undefined,
  revision: string,
  old: string,
  replacement: string,
) {
  if (!current || current.revision !== revision) throw conflict("private record changed; search the project again");
  if (old && current.text.split(old).length !== 2) throw conflict("give a unique passage from the private record");
  return {
    old: current.text,
    replacement: old ? current.text.replace(old, () => replacement) : `${current.text}\n${replacement}`,
  };
}

/** Approved contact data stays in a private project record, never in global memory or the original document. */
export function contactProjectRecords(store: Store) {
  return {
    list: (binding: Binding) => records(store).filter((r) => matches(r, binding)),
    propose(
      o: Binding & {
        thread: string;
        run: string;
        source: string;
        label: string;
        source_revision: string;
        reference: NonNullable<SourceUpdate["project_record"]>["reference"];
        record_revision?: string;
        old: string;
        replacement: string;
      },
    ) {
      const run = store.runs.get(o.run);
      const origin = run?.input?.origin;
      const thread = store.threads.get(o.thread);
      if (
        run?.thread_id !== o.thread ||
        run.agent_id !== o.agent ||
        origin?.kind !== "channel" ||
        origin.role !== "contact" ||
        origin.person_id !== o.person ||
        origin.channel !== thread?.channel?.id
      )
        throw badRequest("only a contact's incoming message can propose a project record update");
      if (!o.replacement.trim() || o.old === o.replacement || o.old.length > 8000 || o.replacement.length > 8000)
        throw badRequest("give the current private record and its changed replacement, up to 8000 characters");
      return store.tx(() => {
        const state = sourceState(store);
        const requestKey = o.record_revision
          ? sourceHash(JSON.stringify([o.record_revision, o.old, o.replacement]))
          : undefined;
        const repeated =
          requestKey &&
          state.updates.find((u) => u.source === o.source && u.project_record?.request_key === requestKey);
        if (repeated) return repeated;
        const current = records(store).find((r) => r.id === o.source && matches(r, o));
        if (o.record_revision) o = { ...o, ...recordEdit(current, o.record_revision, o.old, o.replacement) };
        if (o.replacement.length > 8000) throw badRequest("the private record would exceed 8000 characters");
        const revision = sourceHash(o.old);
        const duplicate = state.updates.find(
          (u) =>
            u.source === o.source &&
            u.project_record &&
            u.revision === revision &&
            u.old === o.old &&
            u.replacement === o.replacement,
        );
        if (duplicate) return duplicate;
        if ((current?.text ?? "") !== o.old) throw conflict("private record changed; search the project again");
        if (state.updates.filter((u) => u.person === o.person && ["pending", "applying"].includes(u.state)).length >= 5)
          throw badRequest("corrections already await the owner; nothing changed");
        const update: SourceUpdate = {
          id: newId("csup"),
          source: o.source,
          person: o.person,
          channel: origin.channel,
          thread: o.thread,
          run: o.run,
          ...(origin.message_id ? { message: origin.message_id } : {}),
          revision,
          old: o.old,
          replacement: o.replacement,
          state: "pending",
          created_at: now(),
          project_record: {
            agent: o.agent,
            project: o.project,
            label: o.label.slice(0, 200),
            source_revision: o.source_revision,
            ...(o.reference ? { reference: o.reference } : {}),
            ...(requestKey ? { request_key: requestKey } : {}),
          },
        };
        state.updates.push(update);
        saveSources(store, state);
        const en = store.settings.get("owner_language") === "en";
        store.notifications.add({
          kind: "agent",
          ref: `contact-source:${update.id}`,
          thread_id: HOME_THREAD_ID,
          title: en ? "Review a contact's update" : "Revisá una actualización de un contacto",
          body: en
            ? "Ask your super-agent to review the private project record proposal. Nothing has changed."
            : "Pedile a tu super-agente que revise la propuesta para el registro privado del proyecto. Todavía no se cambió nada.",
        });
        return update;
      });
    },
    resolve(id: string, accept: boolean, authorized: (update: SourceUpdate) => boolean) {
      return store.tx(() => {
        const state = sourceState(store);
        const update = state.updates.find((u) => u.id === id && u.project_record);
        if (!update?.project_record) throw notFound("project record proposal");
        if (update.state !== "pending") {
          store.notifications.resolve("agent", `contact-source:${id}`);
          return update;
        }
        if (!accept) {
          update.state = "rejected";
          saveSources(store, state);
          store.notifications.resolve("agent", `contact-source:${id}`);
          return update;
        }
        const meta = update.project_record;
        const thread = store.threads.get(update.thread);
        const agent = store.agents.get(meta.agent);
        if (!authorized(update) || thread?.channel?.person_id !== update.person || agent?.project_id !== meta.project)
          throw conflict("project or source access changed; proposal was not applied");
        const all = records(store);
        const current = all.find((r) => r.id === update.source);
        if (sourceHash(current?.text ?? "") !== update.revision || (current?.text ?? "") !== update.old)
          throw conflict("private record changed; proposal was not applied");
        const record = {
          id: update.source,
          person: update.person,
          agent: meta.agent,
          project: meta.project,
          label: meta.label,
          text: update.replacement,
          revision: sourceHash(update.replacement),
        };
        store.settings.set(KEY, JSON.stringify([...all.filter((r) => r.id !== record.id), record]));
        update.state = "accepted";
        update.result_revision = record.revision;
        saveSources(store, state);
        store.notifications.resolve("agent", `contact-source:${id}`);
        return update;
      });
    },
  };
}
