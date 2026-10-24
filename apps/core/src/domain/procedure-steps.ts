// A procedure note's steps, reduced to what repeats the method: the site, the command and its decisive flags, the
// file. Lookups (searches, snapshots, tab juggling) are dropped and nothing that could carry a credential is kept.
import { relativeWritten } from "../paths.ts";
import { memorySensitive } from "./memories.ts";
import type { Step } from "./runs.ts";
import type { Store } from "./store.ts";

/** Never kept in a note: credentials, and commands or addresses that carry one. */
export const unsafe = (v: string) =>
  memorySensitive(v) ||
  /\b(authorization|bearer|cookies?|token|apikey|api[-_ ]?key|x-api-key|password|passwd|pass|pwd)\b|secret:\/\//i.test(
    v,
  );

/** Where a run's paths are said from: the chat's work folder, if it has one. */
export type Places = { work?: string | undefined };

/** Steps that only looked something up; they say nothing a repeat of the method needs. */
const NOISE =
  /^(mcp_search|shell_output)$|(^|_)(browser_text|snapshot|take_screenshot|screenshot|tabs|tab_list|tab_select|wait_for|console_messages|network_requests|hover|resize)$/;
export const noiseStep = (tool: string) => NOISE.test(tool);

/** A step that ran but did not do its job: a tool error, or a command that exited non-zero or was stopped. */
export const failedStep = (s: Step) =>
  s.state === "error" || (s.tool === "shell" && /^(exit [1-9]\d*|stopped after)\b/.test(s.result ?? ""));

/** A URL as a host, plus its path when that is short; never its query, fragment or credentials. */
function site(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase().replace(/^www\./, "");
    const at = u.pathname.replace(/\/+$/, "");
    return at && at.length <= 24 && !unsafe(at) ? `${host}${at}` : host;
  } catch {
    return "";
  }
}

/** A path from the chat's scratch folder or its work folder, said relative to it (Windows paths too, with `/`). */
function place(p: string, places: Places): string {
  const n = p.replace(/\\/g, "/");
  const scratch = n.replace(/^.*\/apx-scratch-[0-9a-f]{8}\/[^/]+(?=\/|$)/, "<scratch>");
  if (scratch !== n) return scratch;
  return (places.work && relativeWritten(places.work, p)) || p;
}

/** Flags whose value is a credential or a request body: dropped with it. */
const SECRET_FLAG =
  /^(-H|--header|-b|--cookies?|-c|--cookie-jar|-u|--user|--pass\w*|--token|--auth\w*|-d|--data\S*|-F|--form|-e|--env|--api-key)$/;

/** A command line's segments, quote-aware: each one's words and the operator after it. */
function segments(line: string): Array<{ words: string[]; op: string }> {
  const out = [{ words: [] as string[], op: "" }];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(&&|\|\||[;|&])|([^\s"';|&]+)/g)) {
    const last = out[out.length - 1] as { words: string[]; op: string };
    if (m[3]) {
      last.op = m[3];
      out.push({ words: [], op: "" });
    } else last.words.push(m[1] ?? m[2] ?? m[4] ?? "");
  }
  return out;
}

function word(w: string, places: Places): string {
  if (/^https?:\/\//i.test(w)) {
    const s = site(w);
    return s ? `<${s.split("/")[0]}>` : "";
  }
  const kept = /^[~/.]|\/|^[A-Za-z]:\\/.test(w) ? place(w, places) : w;
  return kept.length > 48 || unsafe(kept) || /[`$]/.test(kept) ? "" : kept;
}

/** A command as its programs and decisive flags: URLs as hosts, paths relative, credentials and bodies dropped. */
function commandGist(command: string, places: Places): string {
  const parts: string[] = [];
  for (const { words, op } of segments(command.split("\n")[0] ?? "")) {
    const all = words.filter((w) => !/^\w+=/.test(w));
    const [program = "", ...args] = all;
    if (!program || program === "cd") continue;
    const kept = [program.replace(/^.*\//, "")];
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? "";
      const [flag = a, value] = a.startsWith("--") && a.includes("=") ? a.split(/=(.*)/s) : [a];
      if (SECRET_FLAG.test(flag)) {
        if (value === undefined && !(args[i + 1] ?? "-").startsWith("-")) i++;
        continue;
      }
      const w = value === undefined ? word(a, places) : `${flag}=${word(value, places)}`;
      if (w && !w.endsWith("=")) kept.push(w);
    }
    parts.push(kept.slice(0, 8).join(" "), op);
  }
  const out = parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s*(&&|\|\||[;|&])?\s*$/, "")
    .trim();
  return out.length > 140 ? `${out.slice(0, 139)}…` : out;
}

/** What a step acted on, short and safe; empty when it names nothing worth keeping. */
export function stepGist(step: Pick<Step, "tool" | "args">, places: Places = {}): string {
  const a = step.args;
  const text = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
  let out = "";
  if (text("command")) out = commandGist(text("command"), places);
  else if (text("url")) out = site(text("url"));
  else if (/^https?:\/\/\S+$/i.test(text("text"))) out = site(text("text"));
  else {
    const p = ["path", "dest", "output", "to", "route"].map(text).find(Boolean);
    if (p && !p.includes("\n")) out = place(p, places).slice(0, 120);
  }
  return !out || out.includes("`") || unsafe(out) ? "" : out;
}

/** What one step contributes to a method's one-line summary: the site, the programs, a page script. */
export function stepKey(tool: string, gist: string): string {
  if (tool === "shell")
    return gist
      .split(/\s*(?:&&|\|\||[;|&])\s*/)
      .map((s) => s.split(" ")[0] ?? "")
      .filter(Boolean)
      .join(" | ");
  if (/evaluate|run_code|run_script/.test(tool)) return "page script";
  // A site the step went to; typing a URL into a form is the input, not where the method goes.
  const visits = /browser|navigate|open|fetch|download|web|url|http/.test(tool) && !/type|fill|click|press/.test(tool);
  return visits && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(gist) ? (gist.split("/")[0] ?? "") : "";
}

/** Why a failed attempt failed, in a few words; empty when its output says nothing safe. */
export function failureReason(step: Step): string {
  const body = (step.result ?? "").replace(/<[^>\n]*>/g, "\n");
  // Words, not a progress meter or a table of numbers.
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && (l.match(/\p{L}/gu)?.length ?? 0) >= l.length / 3 && !/^(exit \d+|stopped after)\b/.test(l));
  const line =
    lines.find((l) => /\b(error|denied|required|not found|forbidden|unavailable|fail(ed|ure)?)\b/i.test(l)) ?? lines[0];
  const said = (line ?? "")
    .replace(/^(error:?\s*)+/i, "")
    .replace(/^\[[^\]]*\]\s*([\w-]+:\s*)?/, "")
    .replace(/https?:\/\/\S+/g, (u) => site(u))
    .replace(/[`"()]/g, "")
    .trim();
  const cut = said.length > 60 ? `${said.slice(0, 59).replace(/\s+\S*$/, "")}…` : said;
  return cut && !unsafe(cut) ? cut : "";
}

/** The `tool` `gist` pairs of a procedure note's steps line, in order. */
export function stepPairs(line: string): Array<{ tool: string; gist: string }> {
  return line
    .replace(/^[^:`]*:\s*/, "")
    .split(" → ")
    .map((item) => {
      const [tool = "", gist = ""] = [...item.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
      return { tool, gist };
    })
    .filter((p) => p.tool);
}

/** Where the paths of a chat's runs are said from. */
export function placesOf(store: Store, threadId: string): Places {
  const thread = store.threads.get(threadId);
  return { work: thread?.project_id ? store.projects.get(thread.project_id)?.path : undefined };
}

/** Prefixes of a procedure note's line of attempts that failed (the older one still in saved notes). */
export const FAILED_LINE = /^(Tried first, failed:|Failed attempts \(not the successful method\):)/;

/**
 * Every `quoted` fragment of a procedure note is a tool, an argument, or the reduced form of one of the run's own
 * steps: worked ones on every line, failed ones on the line of failed attempts.
 */
export function procedureSupported(text: string, steps: Step[], places: Places = {}): boolean {
  return (
    text.split("\n").every((line) => {
      const failed = FAILED_LINE.test(line);
      const fragments = [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] as string);
      const said = steps
        .filter((s) => (failed ? failedStep(s) : s.state === "ok" && !failedStep(s)))
        .flatMap((s) => {
          const gist = stepGist(s, places);
          return [
            s.tool,
            gist,
            stepKey(s.tool, gist),
            ...Object.values(s.args).flatMap((v) => (typeof v === "string" ? [v] : [])),
          ].filter(Boolean);
        });
      return fragments.every((f) => said.some((v) => v.includes(f)));
    }) && /`[^`\n]+`/.test(text)
  );
}
