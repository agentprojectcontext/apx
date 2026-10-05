// apx routines: an agent's scheduled work from the terminal.
import { CallModel, type Routine, type Schedule } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx routines                                   Routines and when they run next
apx routines add <name> <prompt…> --agent a [--project p] (--cron "30 8 * * 1-5" | --every 60 | --at <ISO date>)
                 [--pre "<command>"] [--call always|output|fails|never] [--post "<command>"]
                                                The pre-command's output reaches the prompt at {{pre_output}}
apx routines run <id>                          Run now
apx routines on|off <id>
apx routines rm <id>
apx routines log <id>                          Recent runs`;

type Opts = {
  project?: string | undefined;
  agent?: string | undefined;
  cron?: string | undefined;
  every?: string | undefined;
  at?: string | undefined;
  pre?: string | undefined;
  post?: string | undefined;
  call?: string | undefined;
};

const scheduleOf = (o: Opts): Schedule =>
  o.cron
    ? { kind: "cron", cron: o.cron }
    : o.every
      ? { kind: "every", minutes: Number(o.every) }
      : o.at
        ? { kind: "once", at: new Date(o.at).toISOString() }
        : { kind: "manual" };

const describe = (s: Schedule) =>
  s.kind === "cron"
    ? `cron ${s.cron}`
    : s.kind === "every"
      ? `every ${s.minutes} min`
      : s.kind === "once"
        ? `once ${s.at}`
        : "by hand";

const callModel = (v: string): CallModel => {
  const r = CallModel.safeParse(v);
  if (!r.success) throw new Error(`--call is one of: ${CallModel.options.join(", ")}`);
  return r.data;
};

const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString() : "—");

export async function routines(client: ApxClient, [sub, id, ...rest]: string[], opts: Opts): Promise<void> {
  const get = async (routine: string): Promise<Routine> => {
    const r = (await client.call("routines.list", {})).routines.find((x) => x.id === routine);
    if (!r) throw new Error(`no routine ${routine}`);
    return r;
  };
  if (sub === "add") {
    const prompt = rest.join(" ");
    if (!id || !prompt || !opts.agent) throw new Error(USAGE);
    const r = await client.call("routines.set", {
      name: id,
      agent: opts.agent,
      ...(opts.project ? { project: opts.project } : {}),
      schedule: scheduleOf(opts),
      prompt,
      ...(opts.pre ? { pre_command: opts.pre } : {}),
      ...(opts.post ? { post_command: opts.post } : {}),
      ...(opts.call ? { call_model: callModel(opts.call) } : {}),
    });
    console.log(`${r.id}  next: ${when(r.next_run_at)}`);
    return;
  }
  if (sub === "run" && id) {
    const r = await client.call("routines.run", { routine: id });
    console.log(`started in thread ${r.thread_id}`);
    return;
  }
  if ((sub === "on" || sub === "off") && id) {
    const r = await get(id);
    const saved = await client.call("routines.set", {
      id: r.id,
      name: r.name,
      agent: r.agent_id,
      ...(r.project_id ? { project: r.project_id } : {}),
      schedule: r.schedule,
      prompt: r.prompt,
      // The commands are not this command's business: absent, the core keeps them.
      enabled: sub === "on",
    });
    console.log(saved.enabled ? `on, next: ${when(saved.next_run_at)}` : "off");
    return;
  }
  if (sub === "rm" && id) {
    const r = await client.call("routines.remove", { routine: id });
    console.log(r.removed ? "removed" : "no such routine");
    return;
  }
  if (sub === "log" && id) {
    const { runs } = await client.call("routines.runs", { routine: id });
    for (const r of runs)
      console.log(
        `${when(r.started_at)}  ${r.state}${r.delivered === false ? "  (nothing to say)" : ""}  thread ${r.thread_id}`,
      );
    if (!runs.length) console.log("(no runs yet)");
    return;
  }
  if (sub) throw new Error(USAGE);
  const { routines: list } = await client.call("routines.list", opts.project ? { project: opts.project } : {});
  for (const r of list)
    console.log(
      `${r.id}  ${r.name}  · ${r.agent_id}  · ${describe(r.schedule)}  · ${r.enabled ? `next ${when(r.next_run_at)}` : "off"}${r.last ? `  · last ${r.last.state}` : ""}`,
    );
  if (!list.length) console.log(`(no routines)\n\n${USAGE}`);
}
