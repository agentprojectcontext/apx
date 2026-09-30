// One instruction per agent per turn, unless the model says it is correcting it.
//
// The web turn that published a post the owner wanted scheduled did exactly
// this: it handed the job to the project's agent with the right order ("schedule
// it, do NOT publish"), then, seconds later in the same turn, called the same
// agent again with the opposite one ("publish it NOW") — and the second one won.
// Two orders about one job in one turn is almost never a plan; it is the model
// losing track of what it already asked for. So the second is held until the
// model restates it as a deliberate correction (`followup: true`).
const TARGET = {
  send_to_agent: (a) => a?.to,
  call_agent: (a) => a?.agent,
};
const TEXT = {
  send_to_agent: (a) => a?.message,
  call_agent: (a) => a?.prompt,
};

const norm = (v) => String(v || "").trim().toLowerCase();

export function createDelegationGuard(sent = new Map()) {
  return {
    /** A refusal for a second, unmarked instruction to the same agent; else null. */
    check(name, args) {
      const who = TARGET[name] ? norm(TARGET[name](args)) : "";
      if (!who || args?.followup === true) return null;
      const previous = sent.get(who);
      if (!previous) return null;
      return {
        error: `already_delegated: you gave "${who}" an instruction earlier in this turn — nothing was sent now.`,
        previous_instruction: previous,
        note:
          "Two different orders about the same job is how work gets done twice or backwards. " +
          "If this one deliberately corrects or adds to the first, call again with `followup: true` " +
          "and say in the message that it replaces or extends the earlier one. Otherwise leave the first one standing.",
      };
    },
    /** Remember an instruction that actually went out. */
    record(name, args) {
      const who = TARGET[name] ? norm(TARGET[name](args)) : "";
      if (!who) return;
      sent.set(who, String(TEXT[name](args) || "").slice(0, 400));
    },
  };
}
