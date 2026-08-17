// apx commitment — argument routing.
import {
  cmdCommitmentAdd, cmdCommitmentList, cmdCommitmentShow,
  cmdCommitmentKept, cmdCommitmentMissed, cmdCommitmentRenegotiate,
} from "../commands/commitment.js";

export const aliases = ["commitments"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "list" || sub === "ls") await cmdCommitmentList(a);
  else if (sub === "add" || sub === "new") await cmdCommitmentAdd(a);
  else if (sub === "show" || sub === "get") await cmdCommitmentShow(a);
  else if (sub === "kept" || sub === "done") await cmdCommitmentKept(a);
  else if (sub === "missed") await cmdCommitmentMissed(a);
  else if (sub === "renegotiate" || sub === "move") await cmdCommitmentRenegotiate(a);
  else die(`unknown commitment subcommand: ${sub}\nUsage: apx commitment <list|add|show|kept|missed|renegotiate>`);
}
