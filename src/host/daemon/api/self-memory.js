// The super-agent's own notebook — ~/.apx/memory.md.
//
//   GET /notebook   → { body, path, size, approx_tokens, entries, consolidated }
//   PUT /notebook   { body }
//
// WHY THIS EXISTS. This file is the one memory that ships in EVERY prompt on
// every channel, and until now it was the only one with no screen. The Memories
// tab listed project memory and each agent's memory; the super-agent's own
// notebook was reachable from the model (read_self_memory / remember) and from
// the CLI, and nowhere a person could look. So "where is Roby's memory?" had no
// answer in the product, which is a fair thing to be confused by.
//
// It reports its own size because that size is a tax paid on every turn — see
// core/memory/consolidate.js.
import { readSelfMemory, SELF_MEMORY_PATH } from "#core/agent/self-memory.js";
import { notebookSize } from "#core/memory/consolidate.js";
import fs from "node:fs";
import path from "node:path";

const MAX_BODY = 256 * 1024; // a notebook past this is a symptom, not a note

export function register(api) {
  api.get("/notebook", (_req, res) => {
    try {
      const body = readSelfMemory();
      res.json({ body, path: SELF_MEMORY_PATH, ...notebookSize() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.put("/notebook", (req, res) => {
    const { body } = req.body || {};
    if (typeof body !== "string") {
      return res.status(400).json({ error: "body (string) required" });
    }
    if (body.length > MAX_BODY) {
      return res.status(413).json({
        error: `notebook too large (${body.length} > ${MAX_BODY} bytes) — it ships in every prompt`,
      });
    }
    try {
      fs.mkdirSync(path.dirname(SELF_MEMORY_PATH), { recursive: true });
      fs.writeFileSync(SELF_MEMORY_PATH, body);
      res.json({ ok: true, path: SELF_MEMORY_PATH, ...notebookSize() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
