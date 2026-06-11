// cli/commands/search.js
// `apx search "query"` — web search from the terminal.
// Uses the daemon's tools/search.js module directly (no HTTP roundtrip,
// no need to have `apx daemon start` running).

import { webSearch } from "#core/tools/search.js";

const DIM   = "\x1b[2m";
const BOLD  = "\x1b[1m";
const BLUE  = "\x1b[34m";
const CYAN  = "\x1b[36m";
const RESET = "\x1b[0m";

export async function cmdSearch(args) {
  const query = (args._ || []).join(" ").trim();
  if (!query) {
    console.error("apx search: missing <query>");
    console.error("usage: apx search \"<query>\" [--mode auto|ddg|brave|browser] [-n N]");
    process.exit(1);
  }

  const mode  = args.flags?.mode || "auto";
  const limit = parseInt(args.flags?.n || args.flags?.limit || "5", 10) || 5;
  const json  = !!args.flags?.json;

  process.stderr.write(`${DIM}Searching... (${mode})${RESET}\n`);

  let r;
  try {
    r = await webSearch({ query, mode, limit });
  } catch (e) {
    console.error(`${DIM}error:${RESET} ${e.message}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const results = r.results || [];
  if (results.length === 0) {
    console.log(`${DIM}(no results from ${r.mode})${RESET}`);
    if (r.raw_excerpt) console.log(`${DIM}excerpt:${RESET} ${r.raw_excerpt.slice(0, 400)}…`);
    return;
  }

  console.log(`${DIM}${results.length} result${results.length === 1 ? "" : "s"} via ${r.mode}${RESET}\n`);
  results.forEach((item, i) => {
    const num = `[${i + 1}]`;
    const title = item.title || "(no title)";
    console.log(`${BOLD}${num} ${title}${RESET}  ${DIM}— ${hostname(item.url)}${RESET}`);
    if (item.snippet) console.log(`    ${item.snippet}`);
    console.log(`    ${BLUE}${item.url}${RESET}`);
    if (i < results.length - 1) console.log("");
  });
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}
