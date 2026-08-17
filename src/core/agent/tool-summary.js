// A compact record of what a turn actually DID, small enough to store on every
// message.
//
// The full trace carries arguments and results and can run to kilobytes; on a
// channel like Telegram, writing it to the ledger on every reply would bloat
// the day-file for a detail nobody reads back. What people do want, looking at
// a conversation after the fact, is "it read three files and sent a message" —
// and whether any of it failed. That fits in a line.
//
// Shape: { total, failed, tools: [{ name, count, failed }] }

/** How many entries to keep. A turn with 40 distinct tools is a runaway, not a report. */
const MAX_KINDS = 12;

function isError(result) {
  if (!result || typeof result !== "object") return false;
  // Tools signal failure two ways: an `error` field, or the budget's
  // `suppressed`. Both are "it did not happen", which is what the reader needs.
  return Boolean(result.error) || result.suppressed === true;
}

/**
 * @param {{tool: string, result?: unknown}[]} trace
 * @returns {{total: number, failed: number, tools: {name: string, count: number, failed: number}[]}|null}
 *          null when there is nothing to report, so callers can spread it
 *          conditionally without writing an empty object into every message.
 */
export function summarizeToolTrace(trace) {
  if (!Array.isArray(trace) || trace.length === 0) return null;

  const byName = new Map();
  let failed = 0;

  for (const item of trace) {
    const name = String(item?.tool || "tool");
    const row = byName.get(name) || { name, count: 0, failed: 0 };
    row.count += 1;
    if (isError(item?.result)) {
      row.failed += 1;
      failed += 1;
    }
    byName.set(name, row);
  }

  // Failures first, then the busiest. If the list is truncated, what went wrong
  // must survive the truncation — that is the half worth reading.
  const tools = [...byName.values()].sort(
    (a, b) => (b.failed - a.failed) || (b.count - a.count) || a.name.localeCompare(b.name),
  );

  return {
    total: trace.length,
    failed,
    tools: tools.slice(0, MAX_KINDS),
  };
}

/** One line for a terminal or a log. "" when there is nothing to say. */
export function formatToolSummary(summary) {
  if (!summary?.tools?.length) return "";
  const parts = summary.tools.map((t) =>
    `${t.name}${t.count > 1 ? `×${t.count}` : ""}${t.failed ? ` (${t.failed} failed)` : ""}`,
  );
  return parts.join(", ");
}
