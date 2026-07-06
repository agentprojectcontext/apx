// GitHub integration plugin — Personal Access Token auth. Same shape as the
// Asana plugin: a pure REST client + a lifecycle descriptor the daemon API
// dispatches to. Self-contained (GitHub REST over fetch); no GitHub App / OAuth
// broker yet — a PAT is enough to connect, list repos and open issues.

const GITHUB_API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "apx-integrations",
  };
}

async function request(token, method, apiPath, { params, payload } = {}) {
  let url = `${GITHUB_API_BASE}${apiPath}`;
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
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("GitHub request timed out");
    throw new Error(`GitHub request failed: ${e.message}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body?.message || JSON.stringify(body);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`GitHub API ${res.status}: ${detail}`);
  }
  return res.json();
}

// ─── REST client ──────────────────────────────────────────────────────────────

export async function validateToken(token) {
  const user = await request(token, "GET", "/user");
  if (!user?.login) throw new Error("GitHub returned an empty user response");
  return user;
}

export async function listRepos(token, { affiliation = "owner,collaborator,organization_member", perPage = 30 } = {}) {
  return request(token, "GET", "/user/repos", {
    params: { affiliation, per_page: perPage, sort: "updated" },
  });
}

export async function createIssue(token, { owner, repo, title, body }) {
  return request(token, "POST", `/repos/${owner}/${repo}/issues`, { payload: { title, body } });
}

// ─── Plugin descriptor + lifecycle ────────────────────────────────────────────

function safeToken(record) {
  const token = record?.config?.token || "";
  if (!token) throw new Error("GitHub token not configured");
  return token;
}

export const githubPlugin = {
  slug: "github",
  name: "GitHub",
  type: "source_control",
  description: "Conectá GitHub con un token para que los agentes listen repos y abran issues",
  auth: "token",
  tools: [
    { slug: "github_list_repos", desc: "Listar repositorios accesibles" },
    { slug: "github_create_issue", desc: "Crear un issue en un repo" },
  ],
  ui: {
    accent: "slate",
    configFields: [
      {
        key: "token",
        label: "Personal Access Token",
        type: "password",
        placeholder: "ghp_... o github_pat_...",
        help: {
          label: "¿Cómo obtener el token?",
          url: "https://github.com/settings/tokens",
          urlLabel: "github.com/settings/tokens",
          steps: [
            "Abrí github.com/settings/tokens.",
            'Generá un token (classic o fine-grained) con scope "repo".',
            "Copiá el token — empieza con ghp_ o github_pat_.",
            "Pegalo en el campo de abajo.",
          ],
        },
      },
    ],
    connectedFields: [
      { key: "user_login", label: "Conectado como" },
      { key: "user_name", label: "Nombre" },
    ],
  },

  configure(record, body = {}) {
    const token = (body.token || "").trim();
    if (!token && !record) throw new Error("Provide a GitHub token");
    const config = {};
    if (token) config.token = token;
    const patch = { name: "GitHub", type: this.type, description: this.description, config };
    if (token) patch.status = "pending_validation";
    return { patch };
  },

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
    const config = { user_login: user.login, user_name: user.name || null, last_error: null };
    return {
      patch: { status: "active", is_enabled: true, config },
      result: { ok: true, user_login: user.login, user_name: user.name || null },
    };
  },

  status(record) {
    const config = record?.config || {};
    return {
      slug: this.slug,
      status: record?.status || "disconnected",
      is_enabled: !!record?.is_enabled,
      user_login: config.user_login || null,
      user_name: config.user_name || null,
    };
  },

  deactivate() {
    return { patch: { status: "inactive", is_enabled: false } };
  },

  actions: {
    async repos(record) {
      const token = safeToken(record);
      const repos = await listRepos(token);
      return { repos: repos.map((r) => ({ full_name: r.full_name, private: r.private, url: r.html_url })) };
    },
  },
};

export default githubPlugin;
