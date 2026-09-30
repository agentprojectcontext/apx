// Work handed to someone else — an agent, a runtime, a long command — either
// waited for its answer or was left running. The agent picks; the tool row says
// which, so the owner is not left guessing whether it is still going.
const HAND_OFF_TOOLS = new Set(["call_agent", "send_to_agent", "call_runtime", "run_shell"]);

export type HandOffMode = "background" | "waited" | null;

interface ToolPartLike {
  tool: string;
  status?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

export function handOffMode(part: ToolPartLike): HandOffMode {
  if (!HAND_OFF_TOOLS.has(part.tool)) return null;
  const result = part.result as { job_id?: unknown } | null | undefined;
  const leftRunning =
    (!!result && typeof result === "object" && typeof result.job_id === "string") ||
    (part.status === "running" && part.args?.background === true);
  if (leftRunning) return "background";
  // A plain shell command is not a hand-off; only delegations say "waited".
  return part.tool === "run_shell" ? null : "waited";
}
