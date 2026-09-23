// GET  /engines            — list engine adapter ids known to core/engines.
// GET  /engines/presets     — curated catalog (known models, defaults) per engine.
// POST /engines/models      — live model catalog from a provider.
// POST /engines/test        — one-shot "is this wired up?" message to one model.
import { ENGINE_IDS, callEngine } from "#core/engines/index.js";
import { listModels } from "#core/engines/catalog.js";
import { ENGINE_PRESETS } from "#core/engines/presets.js";
import { asyncRoute } from "./shared.js";

export function register(api, { config }) {
  api.get("/engines", (_req, res) => res.json({ engines: ENGINE_IDS }));

  // Curated fallback catalog shared with the CLI wizard. The web hydrates its
  // provider forms from here so model lists never drift between surfaces.
  api.get("/engines/presets", (_req, res) => res.json({ presets: ENGINE_PRESETS }));

  // Plan OAuth status (APX-owned stores under ~/.apx/auth/). Login stays CLI:
  // `apx auth chatgpt-codex login` / `apx auth claude login`.
  api.get("/engines/auth/:target", asyncRoute(async (req, res) => {
    const target = String(req.params.target || "").toLowerCase();
    if (target === "chatgpt-codex" || target === "codex" || target === "codex-plus") {
      const { readApxCodexAuth, chatgptCodexAuthPath, resolveApxCodexCreds } =
        await import("#core/engines/codex-plus-oauth.js");
      const stored = readApxCodexAuth();
      if (!stored) {
        return res.json({
          target: "chatgpt-codex",
          logged_in: false,
          path: chatgptCodexAuthPath(),
          login_cmd: "apx auth chatgpt-codex login",
        });
      }
      try {
        const creds = await resolveApxCodexCreds();
        return res.json({
          target: "chatgpt-codex",
          logged_in: true,
          path: creds.auth_path,
          account_id: creds.account_id,
          expires_at: creds.expires_at || null,
          source: "apx",
          login_cmd: "apx auth chatgpt-codex login",
        });
      } catch (e) {
        return res.json({
          target: "chatgpt-codex",
          logged_in: false,
          broken: true,
          error: e.message,
          path: chatgptCodexAuthPath(),
          login_cmd: "apx auth chatgpt-codex login",
        });
      }
    }
    if (target === "claude" || target === "claude-subscription") {
      const { readApxClaudeAuth, claudeSubscriptionAuthPath, resolveApxClaudeCreds } =
        await import("#core/engines/claude-subscription-oauth.js");
      const stored = readApxClaudeAuth();
      if (!stored) {
        return res.json({
          target: "claude-subscription",
          logged_in: false,
          path: claudeSubscriptionAuthPath(),
          login_cmd: "apx auth claude login",
        });
      }
      try {
        const creds = await resolveApxClaudeCreds();
        return res.json({
          target: "claude-subscription",
          logged_in: true,
          path: creds.auth_path,
          expires_at_ms: creds.expires_at_ms || null,
          source: "apx",
          login_cmd: "apx auth claude login",
        });
      } catch (e) {
        return res.json({
          target: "claude-subscription",
          logged_in: false,
          broken: true,
          error: e.message,
          path: claudeSubscriptionAuthPath(),
          login_cmd: "apx auth claude login",
        });
      }
    }
    return res.status(404).json({ error: `unknown auth target "${target}"` });
  }));

  // Web login: start / poll / complete / logout for plan OAuth.
  api.post("/engines/auth/:target/login/start", asyncRoute(async (req, res) => {
    const target = String(req.params.target || "").toLowerCase();
    if (target === "chatgpt-codex" || target === "codex" || target === "codex-plus") {
      const { startCodexDeviceLogin } = await import("#core/engines/codex-plus-oauth.js");
      const started = await startCodexDeviceLogin();
      return res.json({
        target: "chatgpt-codex",
        flow: "device_code",
        user_code: started.user_code,
        device_auth_id: started.device_auth_id,
        interval_s: started.interval_s,
        verification_url: started.verification_url,
      });
    }
    if (target === "claude" || target === "claude-subscription") {
      const { startClaudePkceLogin } = await import("#core/engines/claude-subscription-oauth.js");
      const started = startClaudePkceLogin();
      return res.json({
        target: "claude-subscription",
        flow: "pkce",
        session_id: started.session_id,
        auth_url: started.auth_url,
      });
    }
    return res.status(404).json({ error: `unknown auth target "${target}"` });
  }));

  api.post("/engines/auth/:target/login/poll", asyncRoute(async (req, res) => {
    const target = String(req.params.target || "").toLowerCase();
    if (!(target === "chatgpt-codex" || target === "codex" || target === "codex-plus")) {
      return res.status(400).json({ error: "poll only for chatgpt-codex" });
    }
    const { device_auth_id, user_code } = req.body || {};
    const {
      pollCodexDeviceLoginOnce,
      exchangeCodexDeviceCode,
    } = await import("#core/engines/codex-plus-oauth.js");
    const step = await pollCodexDeviceLoginOnce({ device_auth_id, user_code });
    if (step.status === "pending") return res.json({ done: false });
    const done = await exchangeCodexDeviceCode({
      authorization_code: step.authorization_code,
      code_verifier: step.code_verifier,
    });
    return res.json({ done: true, path: done.path, account_id: done.account_id });
  }));

  api.post("/engines/auth/:target/login/complete", asyncRoute(async (req, res) => {
    const target = String(req.params.target || "").toLowerCase();
    if (!(target === "claude" || target === "claude-subscription")) {
      return res.status(400).json({ error: "complete only for claude" });
    }
    const { session_id, code } = req.body || {};
    const { completeClaudePkceLogin } = await import("#core/engines/claude-subscription-oauth.js");
    const done = await completeClaudePkceLogin({ session_id, code });
    return res.json({ done: true, path: done.path });
  }));

  api.post("/engines/auth/:target/logout", asyncRoute(async (req, res) => {
    const target = String(req.params.target || "").toLowerCase();
    if (target === "chatgpt-codex" || target === "codex" || target === "codex-plus") {
      const { clearApxCodexAuth, chatgptCodexAuthPath } = await import("#core/engines/codex-plus-oauth.js");
      clearApxCodexAuth();
      return res.json({ ok: true, path: chatgptCodexAuthPath() });
    }
    if (target === "claude" || target === "claude-subscription") {
      const { clearApxClaudeAuth, claudeSubscriptionAuthPath } =
        await import("#core/engines/claude-subscription-oauth.js");
      clearApxClaudeAuth();
      return res.json({ ok: true, path: claudeSubscriptionAuthPath() });
    }
    return res.status(404).json({ error: `unknown auth target "${target}"` });
  }));

  api.post("/engines/models", asyncRoute(async (req, res) => {
    const b = req.body || {};
    const engine = String(b.engine || "").toLowerCase();
    if (!engine) return res.status(400).json({ models: [], error: "engine requerido" });
    // api_key: prefer the one typed by the user (unsaved provider), else the
    // stored secret for that provider slug. The key never leaves the daemon.
    const slug = b.slug || engine;
    const stored = config?.engines?.[slug]?.api_key;
    const apiKey = b.api_key || stored || "";
    const out = await listModels(engine, b.base_url, apiKey);
    if (out.error) return res.status(502).json({ engine, models: [], error: out.error });
    res.json({ engine, models: out.models.sort((x, y) => x.localeCompare(y)) });
  }));

  // One message in, one reply out. Deliberately NOT the agent path: no history,
  // no tools, no skills, no memory — just enough to prove the credentials, the
  // endpoint and the model id all work together.
  //
  // Substitution is caught by `served_model` (the gateway's own `model` /
  // `modelVersion` field), not by asking the weights to name themselves.
  // Self-identification is colour: models guess, and a distilled model will
  // happily claim to be Claude. The prompt still asks, but tells it to say
  // "I don't know" rather than invent an id.
  const TEST_SYSTEM = [
    "You are answering a one-off connection test from an admin panel.",
    "Reply in at most two short sentences: which model you are, and what you are doing right now.",
    "If you do not know your exact model id, say so instead of guessing.",
    "Answer in the language of the user's message.",
  ].join(" ");

  // What the gateway says it served. OpenAI-shaped bodies use `model`; Gemini
  // uses `modelVersion`. Missing is fine — streaming adapters leave `raw` null.
  function servedModelOf(out) {
    const raw = out?.raw;
    if (!raw || typeof raw !== "object") return null;
    for (const key of ["model", "modelVersion"]) {
      const v = raw[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  }

  api.post("/engines/test", asyncRoute(async (req, res) => {
    const b = req.body || {};
    const provider = String(b.provider || "").trim();
    const model = String(b.model || "").trim();
    const message = String(b.message || "").trim();
    if (!provider) return res.status(400).json({ error: "provider requerido" });
    if (!model) return res.status(400).json({ error: "model requerido" });

    const started = Date.now();
    try {
      const out = await callEngine({
        modelId: `${provider}:${model}`,
        system: TEST_SYSTEM,
        messages: [{ role: "user", content: message || "¿Andás?" }],
        config,
        temperature: 0.3,
        maxTokens: 300,
      });
      res.json({
        provider,
        model,
        served_model: servedModelOf(out),
        text: out?.text || "",
        usage: out?.usage || null,
        ms: Date.now() - started,
      });
    } catch (e) {
      res.status(502).json({ error: e?.message || "la llamada falló", ms: Date.now() - started });
    }
  }));
}
