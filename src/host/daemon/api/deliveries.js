// The delivery queue over HTTP — a read-only window onto what agents have left
// waiting for Manu, and what has been crossed off.
//
//   GET /projects/:pid/deliveries[?status=pending|notified|held|answered]
//   GET /deliveries                — every project's queue, newest first
//
// The queue is WRITTEN by the routine runner (core/stores/deliveries.js); this
// only surfaces it, so a panel can show it piling up and being resolved.
import { listDeliveries } from "#core/stores/deliveries.js";

export function register(api, { projects, project }) {
  api.get("/projects/:pid/deliveries", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const status = req.query.status || undefined;
    const limit = Math.min(500, Number(req.query.limit) || 100);
    res.json(listDeliveries(p.storagePath, { status, limit }));
  });

  api.get("/deliveries", (req, res) => {
    const status = req.query.status || undefined;
    const out = [];
    for (const entry of projects.list()) {
      const pr = projects.get(entry.id);
      if (!pr?.storagePath) continue;
      for (const d of listDeliveries(pr.storagePath, { status })) {
        out.push({ ...d, project_id: d.project_id ?? entry.id, project_name: entry.name || entry.path });
      }
    }
    out.sort((a, b) => String(b.created_at || b.ts || "").localeCompare(String(a.created_at || a.ts || "")));
    res.json(out.slice(0, Math.min(1000, Number(req.query.limit) || 200)));
  });
}
