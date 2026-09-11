// The volatile half of the prompt.
//
// The prompt tree is split for cache economics:
//   stable   the agent's own definition — persona, council, output contract.
//            Identical on every run, so it is the part that gets cached.
//   charter  the routine's own prompt — one per ritual, also stable.
//   volatile this block, injected into the user turn as `{{pre_output}}`.
//
// Nothing here is instruction. It is STATE: what was already said, what the
// company's own sources report, how much of the interruption budget is left,
// and which sources could not be read. An instruction that drifted in here
// would be re-sent, uncached, on every single run.
import path from "node:path";
import { budget } from "./guard.js";
import { readLedger, renderPastDecisions } from "./ledger.js";
import { readNotes, renderCouncil } from "./council.js";
import { collectSources } from "./sources.js";
import { ritualOrThrow } from "./policy.js";

export function ledgerFile(projectPath, policy) {
  return path.resolve(projectPath, policy.ledgerPath);
}

/**
 * @param {object} options
 * @param {string} options.ritual
 * @param {{path:string, storagePath:string}} options.project
 * @param {object} options.policy
 * @param {string[]|null} [options.only]  restrict which sources run
 */
export function buildContext({ ritual, project, policy, now = new Date(), only = null, run } = {}) {
  const definition = ritualOrThrow(ritual);
  const history = readLedger(ledgerFile(project.path, policy));
  // The ritual is in the env so a source can decide it has nothing to say
  // this run (see ARTIFACTS_SKIP_SIGNAL in sources.js).
  const sources = collectSources(project.storagePath, {
    cwd: project.path,
    only,
    run,
    env: { APX_RITUAL: definition.slug },
  });
  const spend = budget({ now, history, policy });
  // What each area said on its own cadence, already on the desk. The
  // orchestrator does not have to ask, which is what made the council
  // theoretical: it was allowed to consult and almost never had a reason to.
  //
  // An area does NOT get this block. Reading the desk it is about to write to
  // is an echo chamber — it would find its own note from last week and restate
  // it — and reading its peers' invites five agents to agree with each other
  // instead of each answering its own question.
  const council = definition.toDesk ? [] : readNotes(project.storagePath, { now });

  // The guard is the owner's interruption budget. An area never reaches the
  // owner, so showing it a budget it cannot spend is noise that would only
  // teach it to self-censor for the wrong reason.
  const guardBlock = definition.toDesk ? null : [
    "<guard>",
    `deliveries by this layer this week: ${spend.used}/${spend.cap}`,
    `last delivery: ${spend.lastDeliveryAt ? `${spend.lastDeliveryAt} (${spend.lastRitual})` : "none"}`,
    `window: ${spend.quiet ? "quiet hours — only a blocker is delivered now" : "open"}`,
    "</guard>",
  ].join("\n");

  const blocks = [
    `<exec_context ritual="${definition.slug}" label="${definition.label}" now="${now.toISOString().slice(0, 16)}Z">`,
    renderPastDecisions(history),
    ...(definition.toDesk ? [] : [renderCouncil(council)]),
    ...sources.blocks,
    ...(guardBlock ? [guardBlock] : []),
    `<sources>${sources.summary || "none declared"}</sources>`,
    "</exec_context>",
  ];

  return { text: blocks.join("\n\n"), sources: sources.summary, results: sources.results, spend, council };
}

/**
 * The sources line, recovered from a context block.
 *
 * The handoff runs in a separate process from the context, and APX hands it
 * the pre-command's output in `APX_PRE_OUTPUT`. Reading the line back from
 * there is how a ledger entry records which sources were up during that run —
 * with no temp file and no env var anybody has to remember to set.
 */
export function extractSources(preOutput) {
  return String(preOutput ?? "").match(/<sources>([^<]*)<\/sources>/)?.[1]?.trim() ?? "";
}
