import { createCommitment } from "#core/stores/commitments.js";

/**
 * Capture a promise made to a person.
 *
 * Deliberately separate from create_task. The model needs a reason to reach
 * for one over the other, and "did you promise this to someone by name?" is a
 * question it can actually answer from the conversation — which is why the
 * description leads with the phrasing that gives it away ("I told Ana I'd send
 * it Friday") rather than with an abstract definition.
 */
export default {
  name: "record_commitment",
  schema: {
    type: "function",
    function: {
      name: "record_commitment",
      description:
        "Record something the user PROMISED TO A PERSON — 'I told Ana I'd send it Friday', " +
        "'I said we'd have the quote by the 10th'. Use this instead of create_task whenever " +
        "there is a named counterparty waiting on it: breaking a promise costs trust, and " +
        "these are tracked, chased and reported separately from ordinary work. " +
        "A to-do with no one waiting on it is a task, not a commitment. " +
        "Do not ask permission to record one you clearly heard — record it and say you did.",
      parameters: {
        type: "object",
        required: ["project", "counterparty", "body"],
        properties: {
          project:      { type: "string", description: "Project id, name, or path." },
          counterparty: { type: "string", description: "Who is waiting on this. A name as the user says it — free text, not an id." },
          body:         { type: "string", description: "What was promised, in one line." },
          due:          { type: "string", description: "When it was promised for (ISO date or datetime). Include it whenever the user gave one, even loosely resolved ('Friday' → that date)." },
          origin_channel: { type: "string", description: "Where the promise was made (telegram, meeting, email, …)." },
          origin_message_ref: { type: "string", description: "Optional reference back to the message it came from." },
        },
      },
    },
  },
  makeHandler: ({ projects, channel }) => async (args = {}) => {
    const { project: ref, counterparty, body, due, origin_channel, origin_message_ref } = args;
    if (!ref) return { error: "project required" };
    if (!counterparty) return { error: "counterparty required — without one this is a task, use create_task" };
    if (!body) return { error: "body required" };

    const r = String(ref);
    const found = projects.list().find((p) => String(p.id) === r || p.name === r || p.path === r);
    if (!found) return { error: `project not found: ${ref}` };
    const proj = projects.get(found.id);
    if (!proj) return { error: `project storage not loaded: ${ref}` };

    const c = createCommitment(proj.storagePath, {
      counterparty,
      body,
      due: due || null,
      origin_channel: origin_channel || channel || "super-agent",
      origin_message_ref: origin_message_ref || null,
      created_by: "super-agent",
    });

    return {
      id: c.id,
      project: { id: proj.id, name: proj.name },
      counterparty: c.counterparty,
      due: c.due,
      state: c.state,
    };
  },
};
