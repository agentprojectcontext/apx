// Tools that have no dedicated daemon route, executed in-process.
//
// Everything else in the catalog points at an existing endpoint; these are the
// exceptions. Split out of registry.js so the router stays a router.


// ---------------------------------------------------------------------------
// Inline call handlers for tools without a dedicated HTTP endpoint
// ---------------------------------------------------------------------------

export function makeInlineHandlers({ projects }) {
  return {
    memory_append: async (body) => {
      const { default: fetch } = await import("node-fetch");
      const base = `http://localhost:${process.env.APX_PORT || 7430}`;
      // GET current
      const getRes = await fetch(`${base}/api/memory${body.project ? `?project=${body.project}` : ""}`);
      if (!getRes.ok) throw new Error(`memory_get failed: ${getRes.status}`);
      const { body: current } = await getRes.json();
      // POST updated
      const text = body.text || "";
      const postRes = await fetch(`${base}/api/memory${body.project ? `?project=${body.project}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: current + text }),
      });
      if (!postRes.ok) throw new Error(`memory_set failed: ${postRes.status}`);
      return { ok: true, appended_chars: text.length };
    },

    memory_list: async (body) => {
      const { default: fs } = await import("node:fs");
      // These paths were "../parser.js" and "../agent-memory.js", neither of
      // which exists — memory_list threw on every call. Dynamic imports are
      // invisible to the linter and nothing tested this tool, so it stayed
      // broken until a typecheck pass looked at it.
      const { readAgents } = await import("../apc/parser.js");
      const { agentMemoryPath } = await import("../agent/memory.js");
      // Find the project
      const all = projects.list();
      let p = null;
      if (body.project) {
        const ref = String(body.project);
        const found = all.find((x) => String(x.id) === ref || x.path === ref);
        p = found ? projects.get(found.id) : null;
      }
      if (!p) p = projects.get(all.filter((x) => x.id !== 0)[0]?.id) || projects.get(0);
      if (!p) throw new Error("no project registered");
      const result = readAgents(p.path).map((agent) => {
        const slug = agent.slug;
        const memPath = agentMemoryPath(p, slug);
        if (!fs.existsSync(memPath)) return null;
        const stat = fs.statSync(memPath);
        return { agent: slug, path: memPath, size: stat.size, mtime: stat.mtime };
      }).filter(Boolean);
      return { project: p.path, agents_with_memory: result };
    },
  };
}
