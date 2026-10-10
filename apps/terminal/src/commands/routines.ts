// apx routines: an agent's scheduled work from the terminal.
import fs from "node:fs";
import { CallModel, type Routine, type Schedule } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx routines                                   Routines and when they run next
apx routines add <name> <prompt…> --agent a [--project p] (--cron "30 8 * * 1-5" | --every 60 | --at <ISO date>)
                 [--pre "<command>"] [--call always|output|fails|never] [--post "<command>"]
                                                The pre-command's output reaches the prompt at {{pre_output}}
apx routines show <routine>                    Its schedule, commands and full prompt
apx routines edit <routine> [<prompt…> | --prompt-file f] [--name n] [--cron …|--every …|--at …]
                 [--pre "<command>"] [--call …] [--post "<command>"]   Change only what is given
apx routines run <routine>                     Run now
apx routines on|off <routine>
apx routines rm <routine>
apx routines log <routine>                     Recent runs
<routine> is its id (rtn_…) or its name; --project narrows a name to one project's routines`;

type Opts = {
  project?: string | undefined;
  agent?: string | undefined;
  cron?: string | undefined;
  every?: string | undefined;
  at?: string | undefined;
  pre?: string | undefined;
  post?: string | undefined;
  call?: string | undefined;
  name?: string | undefined;
  promptFile?: string | undefined;
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

/** routines.set for an existing routine: what the options give replaces it, the rest stays as it was. */
export function editOf(r: Routine, o: Opts, prompt: string | undefined) {
  const changed = o.cron ?? o.every ?? o.at;
  return {
    id: r.id,
    name: o.name ?? r.name,
    agent: o.agent ?? r.agent_id,
    ...(r.project_id ? { project: r.project_id } : {}),
    schedule: changed ? scheduleOf(o) : r.schedule,
    prompt: prompt ?? r.prompt,
    // Absent, the core keeps a routine's commands; "" removes one.
    ...(o.pre === undefined ? {} : { pre_command: o.pre }),
    ...(o.post === undefined ? {} : { post_command: o.post }),
    ...(o.call ? { call_model: callModel(o.call) } : {}),
    enabled: r.enabled,
  };
}

const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString() : "—");

/** The routine `ref` names: its id, else its exact name, else its name in any case. Two with that name is an error. */
export function findRoutine(list: readonly Routine[], ref: string, project?: string): Routine {
  const byId = list.find((r) => r.id === ref);
  if (byId) return byId;
  const scoped = project ? list.filter((r) => r.project_id === project) : list;
  const exact = scoped.filter((r) => r.name === ref);
  const named = exact.length ? exact : scoped.filter((r) => r.name.toLowerCase() === ref.toLowerCase());
  if (named.length === 1 && named[0]) return named[0];
  if (named.length > 1)
    throw new Error(
      `${named.length} routines are named ${ref}; give the id:\n${named
        .map((r) => `  ${r.id}  · ${r.agent_id}${r.project_id ? `  · project ${r.project_id}` : ""}`)
        .join("\n")}`,
    );
  const near = scoped.filter((r) => r.name.toLowerCase().includes(ref.toLowerCase())).map((r) => r.name);
  throw new Error(
    `no routine ${ref}${project ? ` in project ${project}` : ""}${near.length ? ` (did you mean ${near.slice(0, 5).join(", ")}?)` : ""}; apx routines lists them`,
  );
}

export async function routines(client: ApxClient, [sub, id, ...rest]: string[], opts: Opts): Promise<void> {
  const get = async (ref: string): Promise<Routine> =>
    findRoutine((await client.call("routines.list", {})).routines, ref, opts.project);
  if (sub === "help") {
    console.log(USAGE);
    return;
  }
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
  if (sub === "show" && id) {
    const r = await get(id);
    console.log(
      `${r.id}  ${r.name}  · ${r.agent_id}  · ${describe(r.schedule)}  · ${r.enabled ? `next ${when(r.next_run_at)}` : "off"}`,
    );
    if (r.pre_command) console.log(`pre:  ${r.pre_command}`);
    if (r.post_command) console.log(`post: ${r.post_command}`);
    console.log(`\n${r.prompt}`);
    return;
  }
  if (sub === "edit" && id) {
    if (rest.length && opts.promptFile) throw new Error("give the prompt as words or --prompt-file, not both");
    const prompt = opts.promptFile
      ? fs.readFileSync(opts.promptFile, "utf8")
      : rest.length
        ? rest.join(" ")
        : undefined;
    const saved = await client.call("routines.set", editOf(await get(id), opts, prompt));
    console.log(`${saved.id}  saved · ${saved.enabled ? `next ${when(saved.next_run_at)}` : "off"}`);
    return;
  }
  if (sub === "run" && id) {
    const r = await client.call("routines.run", { routine: (await get(id)).id });
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
    const r = await client.call("routines.remove", { routine: (await get(id)).id });
    console.log(r.removed ? "removed" : "no such routine");
    return;
  }
  if (sub === "log" && id) {
    const { runs } = await client.call("routines.runs", { routine: (await get(id)).id });
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
