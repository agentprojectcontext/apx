// The interruption budget, as seen from outside.
//
//   GET   /nudges                      — the ledger, newest first
//   GET   /nudges/policy               — the effective policy and where it came from
//   PUT   /nudges/policy               — the user's overrides (config.nudge)
//   POST  /nudges/:id/feedback         — { useful, note? }
//   POST  /nudges/check                — dry-run the gate without sending
//
// The ledger is the honest answer to "how often does this thing bother me",
// which is the question that decides whether someone keeps the bot on.
import { readConfig, writeConfig } from "#core/config/index.js";
import {
  listNudges, nudgeStats, recordFeedback, canNudge,
  resolveNudgePolicy, DEFAULT_POLICY,
} from "#core/nudge/index.js";
import { pageEnvelope } from "./shared.js";

export function register(api) {
  api.get("/nudges", (req, res) => {
    try {
      const rows = listNudges({
        limit: req.query.limit || 50,
        kind: req.query.kind || "",
        project_id: req.query.project_id || "",
        with_feedback:
          req.query.with_feedback === "1" ? true
          : req.query.with_feedback === "0" ? false
          : null,
      });
      const envelope = pageEnvelope(rows, req.query);
      envelope.meta = { ...(envelope.meta || {}), stats: nudgeStats() };
      res.json(envelope);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.get("/nudges/policy", (_req, res) => {
    try {
      const cfg = readConfig();
      const { source, ...policy } = resolveNudgePolicy(cfg);
      res.json({
        policy,
        // Which layers contributed, so the panel can say "this came from your
        // profile" instead of showing a number with no provenance.
        source,
        defaults: DEFAULT_POLICY,
        user_overrides: cfg.nudge || {},
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.put("/nudges/policy", (req, res) => {
    const body = req.body || {};
    try {
      const cfg = readConfig();
      const next = { ...(cfg.nudge || {}) };
      for (const key of Object.keys(DEFAULT_POLICY)) {
        if (!(key in body)) continue;
        // null clears the override and hands the key back to the profile.
        if (body[key] === null) delete next[key];
        else next[key] = body[key];
      }
      cfg.nudge = next;
      writeConfig(cfg);
      const { source, ...policy } = resolveNudgePolicy(cfg);
      res.json({ ok: true, policy, source, user_overrides: next });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.post("/nudges/:id/feedback", (req, res) => {
    const { useful, note } = req.body || {};
    if (typeof useful !== "boolean") {
      return res.status(400).json({ error: "useful (boolean) required" });
    }
    try {
      const entry = recordFeedback(req.params.id, useful, note || "");
      if (!entry) return res.status(404).json({ error: `no nudge: ${req.params.id}` });
      res.json({ ok: true, entry });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Dry run. Lets a caller (or a curious user) ask "would this get through?"
  // without spending anything — nothing is recorded here.
  api.post("/nudges/check", (req, res) => {
    const { kind, project_id, severity, unsolicited } = req.body || {};
    try {
      const gate = canNudge(
        {
          kind: kind || "unknown",
          project_id: project_id ?? null,
          severity: severity || "normal",
          unsolicited: unsolicited !== false,
        },
        readConfig(),
      );
      res.json({
        allowed: gate.allowed,
        reason: gate.reason,
        retry_after_ms: gate.retry_after_ms,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
