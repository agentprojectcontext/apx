// The secretary profile: settings plus three routines it seeds on the super-agent and keeps in step — open the day
// and close it (anchors: they always arrive) and watch the owner's work every few hours. They stay ordinary routines:
// the owner may edit their prompts (kept on later saves) and put the default back. Its thresholds feed the watch's
// signals, and a short block in the super-agent's system prompt says the role (the profile changes rarely, so the
// prompt stays cacheable).
import type { Routine, Schedule, SecretaryProfile } from "@apx/protocol";
import type { Store } from "../domain/store.ts";

export const SECRETARY = "secretary";

type Spec = {
  key: "day-open" | "day-close" | "watch";
  name: string;
  /** v1's names for the same routine: an imported one is adopted instead of doubled. */
  v1: string[];
  action: Routine["action"];
  anchor: boolean;
  schedule: (p: SecretaryProfile) => Schedule;
  prompt: string;
};

const SPECS: Spec[] = [
  {
    key: "day-open",
    name: "Abrir el día",
    v1: ["secretary-day-open", "day-open"],
    action: "agent",
    anchor: true,
    schedule: (p) => ({ kind: "cron", cron: p.day_open }),
    prompt:
      "Open the owner's day in ONE message. Call task_list once (open tasks and commitments) and nothing else. Lead with promises due (who is owed what, by when), then what is due today, then today's calendar if a calendar block is below, then the single most important thing to do first. If the day is empty, ask one short question about what matters today instead. Short lines, no headers.",
  },
  {
    key: "day-close",
    name: "Cerrar el día",
    v1: ["secretary-day-close", "day-close"],
    action: "agent",
    anchor: true,
    schedule: (p) => ({ kind: "cron", cron: p.day_close }),
    prompt:
      'Close the owner\'s day in ONE message: what moved today, what is stuck, what carries over to tomorrow. Call task_list once. Ask whether the commitments due today were kept; when the owner answers, record it with commitment_settle (kept, missed, dropped, or renegotiated with the new date), never on your own. Say "no data" rather than guess. Short lines, no headers.',
  },
  {
    key: "watch",
    name: "Watch",
    v1: ["secretary-watch", "watch"],
    action: "watch",
    anchor: false,
    schedule: (p) => ({ kind: "every", minutes: p.watch_every_h * 60 }),
    prompt:
      "New signals from the owner's work are below. If ONE of them is worth interrupting the owner for now, say it in one line with a suggestion. Otherwise answer only SKIP. Never list everything; never repeat what they already know.",
  },
];

const originOf = (key: Spec["key"]) => `${SECRETARY}:${key}`;

/** The block the super-agent's system prompt carries while the profile is on. */
export function secretaryBlock(p: SecretaryProfile): string {
  if (!p.on) return "";
  const tone =
    p.formality === "formal"
      ? "Address the owner formally (usted)."
      : p.formality === "informal"
        ? "Address the owner informally (tú / vos)."
        : "";
  return [
    "## Your role: chief of staff",
    "Nothing falls through the cracks. Your unit of work is the project, not the single message.",
    "- Capture by default, ask rarely: record tasks and commitments yourself and say in one line what you filed and where.",
    "- A commitment is a promise to a person with a date: record it as one (task_create with person and due_at), keep it ahead of tasks, and raise it before it is late.",
    '- Never invent state: say "no activity on X since Y" instead of a tidy guess.',
    "- Interrupt rarely: one line, the most important thing, or nothing. The owner's interruption budget decides what reaches them.",
    tone,
  ]
    .filter(Boolean)
    .join("\n");
}

export function secretaryProfile(store: Store): SecretaryProfile {
  return store.settings.read("secretary");
}

/** Its routines, by origin (the ones it keeps). */
export function secretaryRoutines(store: Store): Routine[] {
  return store.routines.list().filter((r) => r.origin?.startsWith(`${SECRETARY}:`));
}

/**
 * Saves the profile and brings its routines in step: created or adopted (from v1) on the super-agent, their schedule
 * from the profile, on while it is on. A prompt the owner edited is kept.
 */
export function applySecretary(
  store: Store,
  profile: SecretaryProfile,
  nextFor: (s: Schedule) => string | undefined,
): Routine[] {
  store.settings.write("secretary", profile);
  const agent = store.agents.list().find((a) => a.kind === "secretary");
  if (!agent) return [];
  const all = store.routines.list(null);
  for (const spec of SPECS) {
    const origin = originOf(spec.key);
    const mine =
      all.find((r) => r.origin === origin) ??
      all.find((r) => !r.origin && spec.v1.includes(r.name) && r.agent_id === agent.id);
    // Off and never made: nothing to keep in step.
    if (!mine && !profile.on) continue;
    const schedule = spec.schedule(profile);
    const pre = spec.key === "day-open" ? profile.calendar_command.trim() : (mine?.pre_command ?? "");
    const draft = {
      name: mine?.name ?? spec.name,
      agent_id: agent.id,
      project_id: undefined,
      schedule,
      action: spec.action,
      prompt: mine?.prompt ?? spec.prompt,
      pre_command: pre || undefined,
      post_command: mine?.post_command,
      call_model: mine?.call_model ?? "always",
      anchor: spec.anchor,
      origin,
      enabled: profile.on,
      next_run_at: profile.on ? nextFor(schedule) : undefined,
    };
    if (mine) store.routines.update(mine.id, draft);
    else store.routines.create(draft);
  }
  return secretaryRoutines(store);
}

/** A profile routine back to its default prompt. */
export function restoreSecretaryRoutine(store: Store, id: string): Routine | undefined {
  const r = store.routines.get(id);
  const spec = SPECS.find((s) => r?.origin === originOf(s.key));
  if (!r || !spec) return undefined;
  return store.routines.update(id, {
    name: r.name,
    agent_id: r.agent_id,
    project_id: r.project_id,
    schedule: r.schedule,
    action: r.action,
    prompt: spec.prompt,
    pre_command: r.pre_command,
    post_command: r.post_command,
    call_model: r.call_model,
    anchor: r.anchor,
    origin: r.origin,
    enabled: r.enabled,
    next_run_at: r.next_run_at,
  });
}
