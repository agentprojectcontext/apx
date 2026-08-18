// Commitments — what you promised, to whom, by when. Backed by
// core/stores/commitments.js (JSONL event log, sibling of tasks).
//
//   GET    /commitments                              cross-project
//                                                    ?state=open|kept|missed|all
//                                                    &counterparty=X&overdue=1
//                                                    &due_before=ISO&due_after=ISO
//                                                    &sort=due|newest&limit=N&offset=N
//   GET    /projects/:pid/commitments                same filters, one project
//   POST   /projects/:pid/commitments                { counterparty, body, due?, … }
//   GET    /projects/:pid/commitments/:id            (id or prefix)
//   PATCH  /projects/:pid/commitments/:id            { patch: {...} }
//   POST   /projects/:pid/commitments/:id/kept       { note? }
//   POST   /projects/:pid/commitments/:id/missed     { note? }
//   POST   /projects/:pid/commitments/:id/drop       { note? }   filed by mistake
//   POST   /projects/:pid/commitments/:id/renegotiate { due, note? }
//   GET    /projects/:pid/commitments-summary
import {
  createCommitment,
  listCommitments,
  listCommitmentsAcrossProjects,
  getCommitment,
  patchCommitment,
  keepCommitment,
  missCommitment,
  dropCommitment,
  renegotiateCommitment,
  countCommitments,
} from "#core/stores/commitments.js";
import { pageEnvelope } from "./shared.js";

/** Shared filter parsing so the cross-project and per-project views cannot drift. */
function filtersFrom(query) {
  const { state, counterparty, due_before, due_after, overdue, updated_since, sort } = query;
  return {
    state: state === "all" ? "all" : (state || undefined),
    counterparty: counterparty || undefined,
    due_before: due_before || undefined,
    due_after: due_after || undefined,
    overdue: overdue === "1" || overdue === "true" || undefined,
    updated_since: updated_since || undefined,
    sort: sort === "newest" ? "newest" : "due",
  };
}

export function register(api, { project, projects }) {
  api.get("/commitments", (req, res) => {
    const entries = [];
    for (const entry of projects.list()) {
      const p = projects.get(entry.id);
      if (!p?.storagePath) continue;
      entries.push({
        id: entry.id,
        name: entry.name || entry.path,
        path: entry.path,
        storagePath: p.storagePath,
      });
    }

    const { commitments, skipped } = listCommitmentsAcrossProjects(entries, filtersFrom(req.query));
    const envelope = pageEnvelope(commitments, req.query);
    if (skipped.length) envelope.meta = { ...(envelope.meta || {}), skipped };
    res.json(envelope);
  });

  api.get("/projects/:pid/commitments", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(pageEnvelope(listCommitments(p.storagePath, filtersFrom(req.query)), req.query));
  });

  api.post("/projects/:pid/commitments", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      res.status(201).json(createCommitment(p.storagePath, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.get("/projects/:pid/commitments/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const row = getCommitment(p.storagePath, req.params.id);
    if (!row) return res.status(404).json({ error: "commitment not found" });
    res.json(row);
  });

  api.patch("/projects/:pid/commitments/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { patch } = req.body || {};
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ error: "patch object required" });
    }
    const updated = patchCommitment(p.storagePath, req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "commitment not found" });
    res.json(updated);
  });

  api.post("/projects/:pid/commitments/:id/kept", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const updated = keepCommitment(p.storagePath, req.params.id, req.body?.note || null);
    if (!updated) return res.status(404).json({ error: "commitment not found" });
    res.json(updated);
  });

  api.post("/projects/:pid/commitments/:id/missed", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const updated = missCommitment(p.storagePath, req.params.id, req.body?.note || null);
    if (!updated) return res.status(404).json({ error: "commitment not found" });
    res.json(updated);
  });

  // Filed by mistake. Separate from `missed` on purpose: see core/stores.
  api.post("/projects/:pid/commitments/:id/drop", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const updated = dropCommitment(p.storagePath, req.params.id, req.body?.note || null);
    if (!updated) return res.status(404).json({ error: "commitment not found" });
    res.json(updated);
  });

  api.post("/projects/:pid/commitments/:id/renegotiate", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { due, note } = req.body || {};
    if (!due) return res.status(400).json({ error: "a new due date is required" });
    try {
      const updated = renegotiateCommitment(p.storagePath, req.params.id, due, note || null);
      if (!updated) return res.status(404).json({ error: "commitment not found" });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.get("/projects/:pid/commitments-summary", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(countCommitments(p.storagePath));
  });
}
