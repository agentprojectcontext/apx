// apx company — the executive layer of a company project.
import {
  cmdCompanyContext,
  cmdCompanyHandoff,
  cmdCompanyNote,
  cmdCompanyCouncil,
  cmdCompanySources,
} from "../commands/company.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (sub === "context") await cmdCompanyContext(a);
  else if (sub === "handoff") await cmdCompanyHandoff(a);
  else if (sub === "note") await cmdCompanyNote(a);
  else if (sub === "council") await cmdCompanyCouncil(a);
  else if (sub === "sources") await cmdCompanySources(a);
  else die(`unknown company subcommand: ${sub || "(none)"} — try: context, handoff, note, council, sources`);
}
