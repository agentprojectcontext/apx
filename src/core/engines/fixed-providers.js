// Fixed / plan providers — not DIY cards. They ship with APX, stay locked,
// and only expose login-oriented settings (model pick from the local plan
// catalog). ChatGPT/Codex + Claude subscription via APX-owned OAuth.

export const CHATGPT_CODEX_SLUG = "chatgpt-codex";
export const CHATGPT_CODEX_ENGINE = "codex-plus";
export const CHATGPT_CODEX_NAME = "ChatGPT/Codex";

export const CLAUDE_SUB_SLUG = "claude-subscription";
export const CLAUDE_SUB_ENGINE = "claude-subscription";
export const CLAUDE_SUB_NAME = "Claude (Max)";

/** Default block written into ~/.apx/config.json engines.<slug>. */
export function chatgptCodexDefaults() {
  return {
    name: CHATGPT_CODEX_NAME,
    engine: CHATGPT_CODEX_ENGINE,
    locked: true,
    is_active: true,
    default_model: "gpt-5.6-luna",
    base_url: "https://chatgpt.com/backend-api/codex",
  };
}

export function claudeSubscriptionDefaults() {
  return {
    name: CLAUDE_SUB_NAME,
    engine: CLAUDE_SUB_ENGINE,
    locked: true,
    is_active: true,
    default_model: "claude-sonnet-4-5",
    base_url: "https://api.anthropic.com",
  };
}

/**
 * Keep fixed plan rows present and correctly shaped.
 * Migrates the spike slug `especial` → `chatgpt-codex` once.
 * Returns a NEW engines object (does not mutate input).
 */
export function ensureFixedEngines(engines = {}) {
  const src = engines && typeof engines === "object" ? { ...engines } : {};
  let working = { ...src };

  // One-shot rename from the spike name.
  if (working.especial && !working[CHATGPT_CODEX_SLUG]) {
    const { especial, ...rest } = working;
    const migrated = {
      ...chatgptCodexDefaults(),
      ...(especial && typeof especial === "object" ? especial : {}),
      name: CHATGPT_CODEX_NAME,
      engine: CHATGPT_CODEX_ENGINE,
      locked: true,
    };
    working = { [CHATGPT_CODEX_SLUG]: migrated, ...rest };
  }

  const codexExisting = working[CHATGPT_CODEX_SLUG];
  const codexFixed = {
    ...chatgptCodexDefaults(),
    ...(codexExisting && typeof codexExisting === "object" ? codexExisting : {}),
    name: CHATGPT_CODEX_NAME,
    engine: CHATGPT_CODEX_ENGINE,
    locked: true,
  };

  const claudeExisting = working[CLAUDE_SUB_SLUG];
  const claudeFixed = {
    ...claudeSubscriptionDefaults(),
    ...(claudeExisting && typeof claudeExisting === "object" ? claudeExisting : {}),
    name: CLAUDE_SUB_NAME,
    engine: CLAUDE_SUB_ENGINE,
    locked: true,
  };

  const {
    [CHATGPT_CODEX_SLUG]: _dropCodex,
    [CLAUDE_SUB_SLUG]: _dropClaude,
    especial: _dropEspecial,
    ...rest
  } = working;

  // Fixed cards first for UI lists that follow Object.keys.
  return {
    [CHATGPT_CODEX_SLUG]: codexFixed,
    [CLAUDE_SUB_SLUG]: claudeFixed,
    ...rest,
  };
}

export function isFixedProviderSlug(slug) {
  return (
    slug === CHATGPT_CODEX_SLUG
    || slug === CLAUDE_SUB_SLUG
    || slug === "especial"
  );
}
