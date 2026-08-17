// apx sessions / apx session find — terminal presentation for the session
// engine in #core/sessions. This file owns printing and argument handling
// only; the scanning, decoding and filtering live in core (AGENTS.md rule 8).
import {
  ENGINES,
  collectAllSessions,
  filterSessionsByQuery,
  findSessionAcrossEngines,
  findSessionInEngine,
  resolveTargetDir,
  fmtDate,
} from "#core/sessions/index.js";

// Re-exported for the CLI's own tests and for `apx session` siblings that
// still import them from here.
export {
  ENGINES,
  collectAllSessions,
  filterSessionsByQuery,
  findSessionAcrossEngines,
  findSessionInEngine,
};

export function cmdSessionFind(args, opts = {}) {
  const query = (args._ || []).join(" ").trim();
  if (!query) {
    throw new Error(
      'apx session find: missing search text — e.g. apx session find "mejorar interfaz web"'
    );
  }
  const deep = !!(args.flags.deep || args.flags.content);
  const asJson = !!args.flags.json;
  const engineFlag =
    args.flags.engine && args.flags.engine !== true
      ? String(args.flags.engine)
      : null;
  if (engineFlag && !ENGINES[engineFlag]) {
    throw new Error(
      `unknown engine "${engineFlag}" — valid engines: ${Object.keys(ENGINES).join(", ")}`
    );
  }
  const limitFlag = args.flags.limit;
  const limit =
    limitFlag && limitFlag !== true ? parseInt(limitFlag, 10) : 20;

  const dir = resolveTargetDir(args, opts);
  const rows = collectAllSessions(opts, { dir, engineId: engineFlag });
  const matches = filterSessionsByQuery(rows, { query, deep });
  const shown = matches.slice(0, limit);

  if (asJson) {
    console.log(JSON.stringify(shown, null, 2));
    return;
  }

  if (matches.length === 0) {
    console.log(`No sessions matching "${query}"${deep ? " (title + content)" : " (title)"}.`);
    if (!deep) console.log("Tip: add --deep to search inside transcripts too.");
    if (!dir) console.log("Tip: scope with --dir <path> or --project <name> to reach unregistered Claude projects.");
    return;
  }

  console.log(
    `${matches.length} match${matches.length === 1 ? "" : "es"} for "${query}"` +
      (deep ? " (title + content)" : " (title)") +
      (shown.length < matches.length ? ` — showing ${shown.length}` : "")
  );
  console.log("");
  console.log(
    `${"DATE".padEnd(12)} ${"ENGINE".padEnd(8)} ${"SESSION ID".padEnd(38)} TITLE`
  );
  console.log(
    `${"─".repeat(12)} ${"─".repeat(8)} ${"─".repeat(38)} ${"─".repeat(30)}`
  );
  for (const m of shown) {
    console.log(
      `${fmtDate(m.mtime).padEnd(12)} ${String(m.engine).padEnd(8)} ${String(m.id).padEnd(38)} ${String(m.title).slice(0, 60)}`
    );
  }
  console.log("");
  console.log("Next:");
  const top = shown[0];
  console.log(`  apx session summary ${top.id}`);
  console.log(`  apx session ask ${top.id} "your question"`);
  console.log(`  apx session resume ${top.id} --continue`);
}

// ── command ──────────────────────────────────────────────────────────────────

function printSessions(engine, dir, result, limit) {
  if (!result.found) {
    console.log(`(no ${engine.label} sessions for ${dir})`);
    if (result.location) console.log(`  looked in: ${result.location}`);
    return;
  }
  let sessions = result.sessions;
  if (limit && limit > 0) sessions = sessions.slice(0, limit);

  console.log(`${engine.label} sessions for ${dir}`);
  console.log(`  ${result.location}`);
  console.log("");
  console.log(`${"DATE".padEnd(12)} ${"SESSION ID".padEnd(38)} TITLE`);
  console.log(`${"─".repeat(12)} ${"─".repeat(38)} ${"─".repeat(40)}`);
  for (const s of sessions) {
    console.log(
      `${fmtDate(s.mtime).padEnd(12)} ${String(s.id).padEnd(38)} ${String(
        s.title
      ).slice(0, 70)}`
    );
  }
  console.log("");
  console.log("Resume:");
  if (engine.continueHint) console.log(`  latest:   ${engine.continueHint(dir)}`);
  if (engine.resumeHint && sessions[0]) {
    console.log(`  specific: ${engine.resumeHint(sessions[0].id)}`);
  }
}

function printProjects(engine, projects) {
  if (projects.length === 0) {
    console.log(`(no ${engine.label} projects found)`);
    return;
  }
  console.log(`${engine.label} projects:`);
  console.log("");
  console.log(`${"SESSIONS".padEnd(9)} ${"LAST".padEnd(12)} PROJECT`);
  console.log(`${"─".repeat(9)} ${"─".repeat(12)} ${"─".repeat(40)}`);
  for (const p of projects) {
    console.log(
      `${String(p.count).padEnd(9)} ${fmtDate(p.mtime).padEnd(12)} ${p.label}`
    );
  }
  console.log("");
  console.log(
    `Re-run with --project <name> or --dir <path> to list sessions of one project.`
  );
}

// Run the single-engine list flow. Returns true if anything printed.
function listSingleEngine(engine, args, opts, { headerPrefix = "" } = {}) {
  const detected = engine.detect(opts);
  if (!detected.available) {
    // Caller filters by detect() already in "all engines" mode; this path is
    // hit only when --engine names something the user explicitly asked for.
    console.log(`${headerPrefix}engine "${engine.id}" not available: ${detected.reason}`);
    return false;
  }
  if (!engine.implemented) {
    console.log(
      `${headerPrefix}engine "${engine.id}" (${engine.label}) detected but listing not implemented yet.`
    );
    return false;
  }

  const dir = resolveTargetDir(args, opts);
  const limitFlag = args.flags.limit || args.flags.last;
  const limit = limitFlag && limitFlag !== true ? parseInt(limitFlag, 10) : null;

  if (dir) {
    printSessions(engine, dir, engine.listSessions(dir, opts), limit);
  } else {
    printProjects(engine, engine.listProjects(opts));
  }
  return true;
}

export function cmdSessionsList(args, opts = {}) {
  const engineFlag = args.flags.engine;
  if (engineFlag === true) {
    throw new Error("--engine requires a value (apx, claude, codex, antigravity)");
  }

  // Explicit engine → behave exactly as before (single-engine view).
  if (engineFlag) {
    const engineId = String(engineFlag);
    const engine = ENGINES[engineId];
    if (!engine) {
      throw new Error(
        `unknown engine "${engineId}" — valid engines: ${Object.keys(ENGINES).join(", ")}`
      );
    }
    listSingleEngine(engine, args, opts);
    return;
  }

  // No --engine → iterate every engine present on the system. Detected-but-
  // empty engines still get a heading with "(sin nada)" so the user sees what
  // exists; engines not installed are silently skipped (no clutter).
  let anyDetected = false;
  let first = true;
  for (const engine of Object.values(ENGINES)) {
    const detected = engine.detect(opts);
    if (!detected.available) continue;
    anyDetected = true;
    if (!first) console.log("");
    first = false;
    console.log(`══ ${engine.label} (${engine.id}) ══`);
    if (!engine.implemented) {
      console.log("  (detected — listing no soportado todavía)");
      continue;
    }
    const dir = resolveTargetDir(args, opts);
    const limitFlag = args.flags.limit || args.flags.last;
    const limit =
      limitFlag && limitFlag !== true ? parseInt(limitFlag, 10) : null;
    if (dir) {
      const result = engine.listSessions(dir, opts);
      if (!result.found || (result.sessions || []).length === 0) {
        console.log("  (sin nada)");
        if (result.location) console.log(`  looked in: ${result.location}`);
      } else {
        printSessions(engine, dir, result, limit);
      }
    } else {
      const list = engine.listProjects(opts);
      if (list.length === 0) {
        console.log("  (sin nada)");
      } else {
        printProjects(engine, list);
      }
    }
  }
  if (!anyDetected) {
    console.log("(no engines detected — install claude, codex, or run `apx init` somewhere)");
  } else {
    console.log("");
    console.log(
      "Tip: --engine <id> filters to one engine; --project <name> or --dir <path> drills into a project."
    );
  }
}
