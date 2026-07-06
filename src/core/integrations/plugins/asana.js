// Asana integration plugin — ported from PandaProject's asana_service.py.
//
// Two halves:
//   1. A thin Asana REST client (Personal Access Token auth) — pure HTTP, no
//      knowledge of storage. Used by both the lifecycle below and the agent
//      tools in core/agent/tools/handlers/asana.js.
//   2. A plugin descriptor implementing the shared lifecycle contract
//      (configure / validate / status / deactivate / actions) that the daemon
//      API dispatches to. Lifecycle methods take a stored record and return a
//      patch to persist — they never touch the filesystem themselves (SRP).
//
// Contract shared by every plugin (see catalog.js):
//   configure(record, body)  -> { patch }                        (sync)
//   validate(record)         -> Promise<{ patch, result }>       (async, hits API)
//   status(record)           -> statusObject                     (sync, pure)
//   deactivate(record)       -> { patch }                        (sync)
//   actions: { <name>(record) -> Promise<any> }                  (async reads)

const ASANA_API_BASE = "https://app.asana.com/api/1.0";
const REQUEST_TIMEOUT_MS = 15_000;

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function request(token, method, apiPath, { params, payload } = {}) {
  let url = `${ASANA_API_BASE}${apiPath}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: headers(token),
      body: payload !== undefined ? JSON.stringify({ data: payload }) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("Asana request timed out");
    throw new Error(`Asana request failed: ${e.message}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      const first = Array.isArray(body?.errors) ? body.errors[0]?.message : null;
      detail = first || JSON.stringify(body);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Asana API ${res.status}: ${detail}`);
  }
  return res.json();
}

// ─── REST client (mirrors asana_service.py) ───────────────────────────────────

export async function validateToken(token) {
  const result = await request(token, "GET", "/users/me");
  const user = result?.data || {};
  if (!user.gid) throw new Error("Asana returned an empty user response");
  return user;
}

export async function getWorkspaces(token) {
  const result = await request(token, "GET", "/workspaces");
  return result?.data || [];
}

export async function listProjects(token, workspaceGid) {
  const result = await request(token, "GET", "/projects", {
    params: { workspace: workspaceGid, opt_fields: "gid,name,color,archived,permalink_url" },
  });
  return result?.data || [];
}

export async function listTasks(token, projectGid, completed = false) {
  const result = await request(token, "GET", `/projects/${projectGid}/tasks`, {
    params: {
      opt_fields: "gid,name,completed,due_on,assignee.name,notes,permalink_url",
      completed_since: completed ? "" : "now",
    },
  });
  return result?.data || [];
}

export async function createTask(token, { workspaceGid, name, notes = "", projectGid, assignee, dueOn } = {}) {
  const payload = { name, workspace: workspaceGid };
  if (notes) payload.notes = notes;
  if (projectGid) payload.projects = [projectGid];
  if (assignee) payload.assignee = assignee;
  if (dueOn) payload.due_on = dueOn;
  const result = await request(token, "POST", "/tasks", { payload });
  return result?.data || {};
}

export async function updateTask(token, taskGid, { name, notes, completed, dueOn, assignee } = {}) {
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (notes !== undefined) payload.notes = notes;
  if (completed !== undefined) payload.completed = completed;
  if (dueOn !== undefined) payload.due_on = dueOn;
  if (assignee !== undefined) payload.assignee = assignee;
  const result = await request(token, "PUT", `/tasks/${taskGid}`, { payload });
  return result?.data || {};
}

// ─── Plugin descriptor + lifecycle ────────────────────────────────────────────

function safeToken(record) {
  const token = record?.config?.personal_access_token || "";
  if (!token) throw new Error("Asana token not configured");
  return token;
}

export const asanaPlugin = {
  slug: "asana",
  name: "Asana",
  type: "project_management",
  description: "Conectá tu workspace de Asana para que los agentes creen, actualicen y consulten tareas",
  auth: "token",
  tools: [
    { slug: "asana_list_projects", desc: "Listar proyectos del workspace" },
    { slug: "asana_list_tasks", desc: "Listar tareas de un proyecto" },
    { slug: "asana_create_task", desc: "Crear una tarea" },
    { slug: "asana_update_task", desc: "Actualizar estado o campos de una tarea" },
  ],

  // Declarative UI descriptor consumed by the generic PluginConnect component
  // (see web/components/integrations/PluginConnect.tsx). configFields render as
  // inputs; `select` is a post-validate picker sourced from an action; and
  // connectedFields are the status keys shown once connected.
  ui: {
    accent: "rose",
    configFields: [
      {
        key: "personal_access_token",
        label: "Personal Access Token",
        type: "password",
        placeholder: "1/1234567890abcdef:...",
        help: {
          label: "¿Cómo obtener el token?",
          url: "https://app.asana.com/0/my-apps",
          urlLabel: "app.asana.com/0/my-apps",
          steps: [
            "Abrí app.asana.com/0/my-apps en el navegador.",
            'Bajá hasta la sección "Personal access tokens" (no tus apps OAuth).',
            'Hacé clic en "+ New access token".',
            "Dale un nombre y confirmá.",
            'Copiá el token completo — empieza con "1/..." y tiene un ":" en el medio.',
            "Pegalo en el campo de abajo.",
          ],
        },
      },
    ],
    select: {
      key: "workspace_gid",
      label: "Seleccioná el workspace a usar",
      action: "workspaces",
      listKey: "workspaces",
      valueKey: "gid",
      labelKey: "name",
    },
    connectedFields: [
      { key: "user_name", label: "Conectado como" },
      { key: "user_email", label: "Email" },
      { key: "workspace_name", label: "Workspace" },
    ],
  },

  // Save the PAT and/or the target workspace. Returns a patch to persist.
  configure(record, body = {}) {
    const pat = (body.personal_access_token || "").trim();
    const workspaceGid = (body.workspace_gid || "").trim();
    if (!pat && !workspaceGid && !record) {
      throw new Error("Provide personal_access_token or workspace_gid");
    }
    const config = {};
    if (pat) config.personal_access_token = pat;
    if (workspaceGid) config.workspace_gid = workspaceGid;
    const patch = {
      name: "Asana",
      type: this.type,
      description: this.description,
      config,
    };
    // Saving a fresh token means the connection is not yet verified.
    if (pat) patch.status = "pending_validation";
    return { patch };
  },

  // Verify the PAT against Asana and resolve user + workspace metadata.
  async validate(record) {
    const token = safeToken(record);
    let user;
    try {
      user = await validateToken(token);
    } catch (e) {
      return {
        patch: { status: "error", is_enabled: false, config: { last_error: String(e.message || e) } },
        result: { ok: false, error: String(e.message || e) },
      };
    }
    const config = { user_name: user.name || null, user_email: user.email || null, last_error: null };
    let workspaceGid = record?.config?.workspace_gid || null;
    try {
      const workspaces = await getWorkspaces(token);
      if (workspaceGid) {
        const match = workspaces.find((w) => w.gid === workspaceGid);
        if (match) config.workspace_name = match.name;
      } else if (workspaces.length === 1) {
        // Auto-select when the token owner has exactly one workspace.
        config.workspace_gid = workspaces[0].gid;
        config.workspace_name = workspaces[0].name;
        workspaceGid = workspaces[0].gid;
      }
    } catch {
      /* workspace resolution is best-effort */
    }
    return {
      patch: { status: "active", is_enabled: true, config },
      result: {
        ok: true,
        user_name: config.user_name,
        user_email: config.user_email,
        workspace_gid: config.workspace_gid || workspaceGid,
        workspace_name: config.workspace_name || null,
      },
    };
  },

  status(record) {
    const config = record?.config || {};
    return {
      slug: this.slug,
      status: record?.status || "disconnected",
      is_enabled: !!record?.is_enabled,
      user_name: config.user_name || null,
      user_email: config.user_email || null,
      workspace_gid: config.workspace_gid || null,
      workspace_name: config.workspace_name || null,
    };
  },

  deactivate() {
    return { patch: { status: "inactive", is_enabled: false } };
  },

  actions: {
    async workspaces(record) {
      const token = safeToken(record);
      return { workspaces: await getWorkspaces(token) };
    },
  },
};

export default asanaPlugin;
