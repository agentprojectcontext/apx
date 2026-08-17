// apx nudge — argument routing for the interruption budget.
import {
  cmdNudgeStatus, cmdNudgeList, cmdNudgeSet, cmdNudgeCheck, cmdNudgeFeedback,
} from "../commands/nudge.js";

export const aliases = ["nudges"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "status") await cmdNudgeStatus(a);
  else if (sub === "list" || sub === "ls") await cmdNudgeList(a);
  else if (sub === "set" || sub === "config") await cmdNudgeSet(a);
  else if (sub === "check") await cmdNudgeCheck(a);
  else if (sub === "feedback") await cmdNudgeFeedback(a);
  else die(`unknown nudge subcommand: ${sub}\nUsage: apx nudge <status|list|set|check|feedback>`);
}
