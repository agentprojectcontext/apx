// Every owner-only method that changes something, placed once: changed by the super-agent through apx_settings, through
// a tool of its own, kept the owner's own (and why), or not decided yet. settings.test.ts fails on a method left out, so
// what the owner can do in the panel never quietly stays out of the super-agent's reach.

/** Owner methods the super-agent reaches through a tool of its own, by tool. */
export const BY_TOOL: Readonly<Record<string, string>> = {
  "agents.create": "agent_set",
  "agents.update": "agent_set",
  "agents.archive": "agent_set",
  "org.set": "agent_set",
  "agents.set_limits": "agent_limits",
  "threads.go_on": "agent_limits",
  "routines.set": "routine_set",
  "routines.run": "routine_set",
  "pairing.respond": "answer_contact_request",
  "browser.import_cookies": "browser_use_my_login",
  "asana.write": "asana",
};

/**
 * Tools above that act as the owner yet may run without a card in Total (or under the agent's rule `auto`), by reason.
 * Every other one marks its changes `ownerSetting` or `keepsCard` (DECISIONS.md#d-143); owner-setting.test.ts holds it.
 */
export const TOTAL_SKIPS: Readonly<Record<string, string>> = {
  routine_set: "the owner's decision: routines change freely for an agent they set to Total",
  asana: "a write to the owner's Asana acts in their name, which Total lets run like a send (DECISIONS.md#d-047)",
};

const SECRET = "carries a key, a password or a sign-in the owner types themselves";
const POWER = "what agents may do or which model runs them stays the owner's (DECISIONS.md#d-060)";
const MACHINE = "installs or controls this computer and its devices";
const PANEL = "the panel's own view of chats, files, git and the terminal; agents have tools of their own for these";
const AS_OWNER = "the owner's own word: their answer, their send, their read";

/** Owner methods no agent calls, by reason. */
export const OWNER_ONLY: Readonly<Record<string, string>> = {
  "secrets.set": SECRET,
  "providers.set": SECRET,
  "services.set": SECRET,
  "clients.create": SECRET,
  "clients.revoke": SECRET,
  "chatgpt.connect": SECRET,
  "chatgpt.disconnect": SECRET,
  "integrations.connect": SECRET,
  "integrations.disconnect": SECRET,
  "integrations.oauth_start": SECRET,
  "integrations.oauth_finish": SECRET,
  "mcp.signIn": SECRET,
  "extensions.set_secret": SECRET,
  "access.set": POWER,
  "webhooks.set": MACHINE,
  "models.set_config": POWER,
  "threads.model": POWER,
  "tools.grant_set": POWER,
  "tools.revoke": POWER,
  "mcp.trust": POWER,
  "mcp.approveTool": POWER,
  "environments.enable": POWER,
  "environments.bind": POWER,
  "telemetry.set": POWER,
  "agents.set_fan_out_ask": POWER,
  "desktop.set": MACHINE,
  "desktop.install": MACHINE,
  "desktop.install_cancel": MACHINE,
  "devices.pair_start": MACHINE,
  "devices.pair_cancel": MACHINE,
  "devices.revoke": MACHINE,
  "environments.configure": MACHINE,
  "environments.stop": MACHINE,
  "browser.control": MACHINE,
  "system.update": MACHINE,
  "system.import_v1": MACHINE,
  "setup.finish": MACHINE,
  "setup.greet": MACHINE,
  "setup.import_v1": MACHINE,
  "setup.take_over_cli": MACHINE,
  "extensions.install": MACHINE,
  "extensions.remove": MACHINE,
  "profiles.install": MACHINE,
  "embeddings.install": MACHINE,
  "transcription.install": MACHINE,
  "files.keep": PANEL,
  "files.open": PANEL,
  "files.rename": PANEL,
  "files.reveal": PANEL,
  "files.trash": PANEL,
  "files.write": PANEL,
  "git.branch": PANEL,
  "git.checkout": PANEL,
  "git.commit": PANEL,
  "git.run": PANEL,
  "git.stage": PANEL,
  "git.unstage": PANEL,
  "terminal.open": PANEL,
  "terminal.input": PANEL,
  "terminal.resize": PANEL,
  "terminal.close": PANEL,
  "threads.compact": PANEL,
  "threads.delete": PANEL,
  "threads.fork": PANEL,
  "threads.read": PANEL,
  "threads.rewind": PANEL,
  "media.upload": PANEL,
  "documents.open": PANEL,
  "channels.open": PANEL,
  "mcp.call": PANEL,
  "mcp.describe": PANEL,
  "mcp.tools": PANEL,
  "environments.appearance": PANEL,
  "environments.display": PANEL,
  "environments.screen": PANEL,
  "channels.recover": PANEL,
  "surfaces.import": PANEL,
  "sessions.resume": PANEL,
  "runs.respond": AS_OWNER,
  "channels.send": AS_OWNER,
  "contacts.suggestions.send": AS_OWNER,
  "contacts.suggestions.discard": AS_OWNER,
  "notifications.read": AS_OWNER,
  "notices.feedback": AS_OWNER,
  "telemetry.seen": AS_OWNER,
  "system.news_tell": AS_OWNER,
  "environments.control": AS_OWNER,
};

/** Not decided yet: what the owner changes in the panel and the super-agent cannot, the next ones to place. */
export const NOT_YET: readonly string[] = [];
