// What the chat's blocks decide, apart from how they look: the same rules as the web panel's chat parts.
import type { Key } from "../../i18n/index.ts";
import type { Message } from "../../protocol.ts";

type Part = Message["parts"][number];
type ToolPart = Extract<Part, { type: "tool" }>;
type SkillsPart = Extract<Part, { type: "skills" }>;
type Response = NonNullable<Extract<Part, { type: "text" }>["response"]>;

/** Computer use reads as one thing: the agent controlling the computer, not a list of pictures. */
export const isComputerGroup = (parts: ToolPart[]): boolean =>
  parts.length > 0 && parts.every((part) => part.tool.startsWith("screen_"));

/** While its run works, a running make_image call shows the picture forming instead of a tool line. */
export function isGeneratingImage(part: Part, state: string | undefined): boolean {
  return (
    (state === "working" || state === "submitted" || state === "queued") &&
    part.type === "tool" &&
    part.tool === "make_image" &&
    part.status === "running"
  );
}

export type SkillKind = "loaded" | "strong" | "hinted" | "considered";
/** Near misses worth showing: under this, every skill resembles every message a little. */
const CONSIDERED_MIN_SIM = 0.3;
const MAX_CONSIDERED = 3;

/** The skills chips over an answer: given whole, recommended, suggested, then the closest ones only weighed. */
export function skillChips(part: SkillsPart): Array<{ name: string; kind: SkillKind; label: string }> {
  const strong = part.strong ?? [];
  const injected = new Set([...part.loaded, ...strong, ...part.hinted]);
  const considered = part.scored
    .filter((one) => !injected.has(one.name) && one.sim >= CONSIDERED_MIN_SIM)
    .slice(0, MAX_CONSIDERED)
    .map((one) => one.name);
  return [
    ...part.loaded.map((name) => ({ name, kind: "loaded" as const, label: name })),
    ...strong.map((name) => ({ name, kind: "strong" as const, label: name })),
    ...part.hinted.map((name) => ({ name, kind: "hinted" as const, label: `${name}?` })),
    ...considered.map((name) => ({ name, kind: "considered" as const, label: `~${name}` })),
  ];
}

export const SKILL_WHY: Record<SkillKind, Key> = {
  loaded: "skillsLoaded",
  strong: "skillsStrong",
  hinted: "skillsHinted",
  considered: "skillsConsidered",
};

type ChatThread = { kind: string; agent_ids: string[] };

export const isIndividualChat = (thread: ChatThread): boolean =>
  thread.kind === "home" || thread.kind === "agent" || thread.kind === "loose" || thread.kind === "code";

/** In the owner's own chat, another agent's message (or a traced reply) is an event, not a new participant. */
export function isAgentEvent(thread: ChatThread, message: Message): boolean {
  if (!isIndividualChat(thread)) return false;
  if (message.author.kind !== "agent") return false;
  if (!message.parts.some((part) => part.type !== "subthread")) return false;
  return (
    message.parts.some((part) => part.type === "text" && part.response) ||
    (Boolean(thread.agent_ids[0]) && message.author.id !== thread.agent_ids[0])
  );
}

export function responseOf(message: Message): Response | undefined {
  return message.parts.flatMap((part) => (part.type === "text" && part.response ? [part.response] : []))[0];
}

type Report = Pick<Response, "state" | "end_reason" | "issue">;
export type ReportStatus = "waiting" | "running" | "done" | "failed";
const STATE: Record<string, { status: ReportStatus; label: Key }> = {
  queued: { status: "waiting", label: "runQueued" },
  submitted: { status: "running", label: "runSubmitted" },
  working: { status: "running", label: "runWorking" },
  "input-required": { status: "waiting", label: "runWaiting" },
  completed: { status: "done", label: "runDone" },
  failed: { status: "failed", label: "runFailed" },
  canceled: { status: "failed", label: "runCanceled" },
};

/** How a delegated or consulted run ended, as one state: a completed run that ran out of steps is not done. */
export function responseStatus(report: Report): { status: ReportStatus; label: Key } {
  if (report.end_reason === "step_limit") return { status: "waiting", label: "runStepLimit" };
  if (report.end_reason === "deadline") return { status: "waiting", label: "runOutOfTime" };
  if (report.issue === "no_answer") return { status: "waiting", label: "runNoAnswer" };
  if (report.issue === "actions_failed") return { status: "waiting", label: "runActionsFailed" };
  return STATE[report.state] ?? { status: "done", label: "runDone" };
}

export function responseTitle(report: Report): Key {
  if (report.end_reason === "step_limit" || report.end_reason === "deadline") return "agentProgress";
  return report.state === "completed" && report.issue !== "no_answer" ? "agentResponse" : "agentMessage";
}

/** A page's host and path, short: "example.com/docs". */
export function hostPath(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i.exec(url);
  if (!match) return url;
  const host = (match[1] ?? "").replace(/^www\./, "");
  const path = (match[2] ?? "").replace(/\/$/, "");
  return host + path;
}

/** Only web pages open from the chat; anything else stays on the computer. */
export const opensOnPhone = (url: string): boolean => /^https?:\/\//i.test(url);

/** How long a run took, short and the same in every language: 45s, 3m 20s, 1h 5m. */
export function took(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}
