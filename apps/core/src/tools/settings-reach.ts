// Every owner-only method that changes something, placed once: changed by the super-agent through apx_settings, through
// a tool of its own, kept the owner's own (and why), or not decided yet. settings.test.ts fails on a method left out, so
// what the owner can do in the panel never quietly stays out of the super-agent's reach.

/** Owner methods the super-agent reaches through a tool of its own, by tool. */
export const BY_TOOL: Readonly<Record<string, string>> = {
  "agents.create": "agent_set",
  "agents.update": "agent_set",
  "agents.review_ack": "agent_set",
  "agents.archive": "agent_set",
  "org.set": "agent_set",
  "agents.set_limits": "agent_limits",
  "threads.go_on": "agent_limits",
  "routines.set": "routine_set",
  "continuations.create": "chat_followup",
  "routines.run": "routine_set",
  "pairing.respond": "answer_contact_request",
  "browser.import_cookies": "browser_use_my_login",
  "browser.evaluate": "browser_evaluate",
  "asana.write": "asana",
};

/**
 * Tools above that act as the owner yet may run without a card in Total (or under the agent's rule `auto`), by reason.
 * Every other one says which calls keep their card with `keepsCard` (DECISIONS.md#d-143, DECISIONS.md#d-203);
 * owner-setting.test.ts holds it. apx_settings says it per method (`Setting.asks`).
 */
export const TOTAL_SKIPS: Readonly<Record<string, string>> = {
  routine_set: "the owner's decision: routines change freely for an agent they set to Total",
  chat_followup:
    "the owner's decision: a bounded follow-up stays in the same chat and uses current permissions when it runs",
  agent_set:
    "the owner's decision: the team changes at their word in the super-agent's mode; autonomy and the main model stay theirs (DECISIONS.md#d-203)",
  asana: "a write to the owner's Asana acts in their name, which Total lets run like a send (DECISIONS.md#d-047)",
};

const SECRET = "carries a key, a password or a sign-in the owner types themselves";
const POWER = "how far agents may act stays the owner's (DECISIONS.md#d-060, DECISIONS.md#d-268)";
const MACHINE = "installs or controls this computer and its devices";
const PANEL = "the panel's own view of chats, files, git and the terminal; agents have tools of their own for these";
const AS_OWNER = "the owner's own word: their answer, their send, their read";

/** Owner methods no agent calls, by reason. */
export const OWNER_ONLY: Readonly<Record<string, string>> = {
  "email.signature_import": "it only fills the owner's signature editor with Gmail's; saving it is theirs",
  "engines.set_usage": "the owner chooses whether APX queries and displays their external account limits",
  "secrets.set": SECRET,
  "secrets.provide_login": SECRET,
  "account.start": SECRET,
  "account.finish": SECRET,
  "account.rename": "the owner's public account name is theirs to choose",
  "account.logout": "the owner signs out of their optional cloud account",
  "surfaces.public_preview":
    "the owner reviews the exact copy before publishing it; agents receive only the draft summary",
  "surfaces.public_discard": "the owner closes a private review; unused agent previews expire automatically",
  "channels.add": "a new account starts with its sign-in, which is the owner's to give (Channels › New channel)",
  "contacts.add":
    "the panel's one-step Add contact; agents add a contact and its address with contacts.set and contacts.address",
  "contacts.keep":
    "the panel's one-step keep from a channel's people; agents add a contact with contacts.set and contacts.address and take an address as the owner's with contacts.claim, on its card",
  "contacts.unclaim":
    "which addresses are the owner's own is theirs to take back; an agent only proposes taking one, with contacts.claim's card (DECISIONS.md#d-144)",
  "secrets.move": "which project a stored secret belongs to is the owner's to say, as setting it is",
  "secrets.set_sites":
    "where agents may sign in with a stored secret is the owner's to say; an agent asks with its own card (DECISIONS.md#d-193)",
  "providers.set": SECRET,
  "clients.create": SECRET,
  "clients.revoke": SECRET,
  "public_routes.rotate": SECRET,
  "public_routes.revoke": SECRET,
  "flows.token_rotate": SECRET,
  "chatgpt.connect": SECRET,
  "chatgpt.disconnect": SECRET,
  "openrouter.connect": SECRET,
  "openrouter.finish": SECRET,
  "integrations.connect": SECRET,
  "integrations.disconnect": SECRET,
  "integrations.oauth_start": SECRET,
  "integrations.oauth_finish": SECRET,
  "mcp.signIn": SECRET,
  "mcp.finishSignIn": SECRET,
  "extensions.set_secret": SECRET,
  "extensions.settings": SECRET,
  "extensions.events_emit":
    "observations come from an extension's monitor or the owner's authenticated CLI, not an agent inventing appliance state",
  "extensions.add_agent": "the Add agent button on an extension's page; agents make an agent with agent_set",
  "access.set": POWER,
  "webhooks.set": MACHINE,
  "threads.group": "the owner picks who is in a group chat in the panel (D-218)",
  "threads.group_set": "the owner changes a group chat's members and models in its card (D-218)",
  "tools.grant_set":
    "narrowing a grant to a condition or a date is the owner's, in Resources; agents grant with grant_tool",
  "tools.revoke":
    "the owner takes back any grant, a chat's too, in Resources; agents take back one agent's with grant_tool revoke",
  // A drawing is published and run by hand through apx_flow's card or in the panel's Flows editor (DECISIONS.md#d-184).
  "flows.draft_discard": "the owner deletes a Flow draft on purpose",
  "flows.cancel_run": "the owner stops a Flow run they are looking at",
  "flows.test_start": "a test sends, calls, runs and writes for real, with what the owner approved in the editor",
  "flows.test_stop": "the owner stops waiting for the test event they started",
  "flows.history_restore": "the owner brings back an earlier drawing from the Flow's page, having looked at it",
  "flows.path_set": "a new address stops the old one, which the services that call it still use",
  "environments.enable": POWER,
  "environments.bind": POWER,
  "telemetry.set": POWER,
  "phone.configure_privacy": POWER,
  "storage.clear": "the owner frees space from Settings › Storage, having seen what it removes (DECISIONS.md#d-185)",
  "projects.move_folder":
    "a retry of the move APX runs by itself at start; it deletes files in the owner's folder, so the owner presses Try again on the project or runs apx doctor --fix (DECISIONS.md#d-275)",
  "storage.compact":
    "it blocks the core while it rewrites the database; the owner runs it from Settings › Storage › Compact or apx doctor --fix (DECISIONS.md#d-200)",
  "storage.computers.delete":
    "an agents' computer and all it holds go only when the owner deletes it (DECISIONS.md#d-185)",
  "storage.backups.delete":
    "a backup copy of the owner's data goes only when the owner deletes it (DECISIONS.md#d-185)",
  "instance.import":
    "bringing a whole setup in replaces agents, Flows and settings; the owner looks at its preview first (DECISIONS.md#d-192)",
  "desktop.set": MACHINE,
  "desktop.install": MACHINE,
  "desktop.install_cancel": MACHINE,
  "devices.pair_start": MACHINE,
  "devices.pair_cancel": MACHINE,
  "devices.revoke": MACHINE,
  // Errands on the way (DECISIONS.md#d-286): what the phone in car mode reports, and the owner's answers on the car.
  "car.trip_start": "the phone in car mode says when the owner drives",
  "car.position": "the phone in car mode says where the owner is",
  "car.trip_end": "the phone in car mode says when the drive ended",
  "car.answer": AS_OWNER,
  "car.errand": AS_OWNER,
  "environments.configure": MACHINE,
  "environments.stop": MACHINE,
  "browser.control": MACHINE,
  "browser.input": "the owner's own hand on a tab they hold; agents use browser_click and browser_type instead",
  "browser.preview_edits": "the owner's own preview of a page's edits; agents change the page's code instead",
  "surfaces.edit_open": "the owner's own edit view of a widget; agents change the widget itself instead",
  "surfaces.edit_preview": "the owner's own preview of a widget's edits; agents change the widget itself instead",
  "surfaces.edit_save": "the owner's own edits saved into a widget; agents use edit_widget instead",
  "surfaces.edit_close": "the owner's own edit view of a widget; agents change the widget itself instead",
  "system.update": MACHINE,
  "system.update_prepare": MACHINE,
  "system.import_v1": MACHINE,
  "setup.finish": MACHINE,
  "setup.greet": MACHINE,
  "setup.prepare": MACHINE,
  "setup.onboard": AS_OWNER,
  "setup.prepare_status": MACHINE,
  "setup.import_v1": MACHINE,
  "setup.take_over_cli": MACHINE,
  "extensions.install": MACHINE,
  "extensions.remove": MACHINE,
  "extensions.rollback": MACHINE,
  // Where extensions may come from is the owner's to choose, like installing one.
  "extensions.catalog_add": MACHINE,
  "extensions.catalog_sync": MACHINE,
  "extensions.catalog_remove": MACHINE,
  "profiles.install": MACHINE,
  "voice.install": MACHINE,
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
  "threads.aside": "the owner's own question beside a chat, answered by that chat's agent; an agent asks in a chat",
  "threads.flow_editor": "the Flow editor says which Flow its own chat draws; agents read it in that chat's turns",
  "threads.delete": PANEL,
  "threads.fork": PANEL,
  "threads.read": PANEL,
  "threads.rewind": PANEL,
  "media.upload": PANEL,
  "media.discard": PANEL,
  "media.reveal": PANEL,
  "tasks.detach": PANEL,
  "documents.open": PANEL,
  "channels.open": PANEL,
  "mcp.call": PANEL,
  "mcp.describe": PANEL,
  "mcp.tools": PANEL,
  "environments.appearance": PANEL,
  "environments.display": PANEL,
  "environments.screen": PANEL,
  // A call is the owner speaking: no agent opens or closes one.
  "calls.start": AS_OWNER,
  "calls.end": AS_OWNER,
  "calls.say": AS_OWNER,
  "voice.wake": AS_OWNER,
  "voice.greeting": AS_OWNER,
  "channels.recover": PANEL,
  "channels.email_history":
    "the owner explicitly imports private mailbox history with apx channels email-history; agents must not import it unasked",
  "surfaces.import": PANEL,
  "sessions.resume": PANEL,
  "runs.respond": AS_OWNER,
  // The owner's messages waiting for their agent (DECISIONS.md#d-186): an agent never changes what the owner said.
  "runs.update_queued": AS_OWNER,
  "runs.remove_queued": AS_OWNER,
  "runs.reorder": AS_OWNER,
  "runs.send_now": AS_OWNER,
  "runs.unsend": AS_OWNER,
  "channels.send": AS_OWNER,
  // Agents send mail with gmail_send or a contact message, behind their own card.
  "mail.send": AS_OWNER,
  "email.signatures_set": "the owner's identity appended to outgoing mail is configured only by the owner",
  "contacts.suggestions.send": AS_OWNER,
  "contacts.suggestions.discard": AS_OWNER,
  "notifications.read": AS_OWNER,
  "notices.feedback": AS_OWNER,
  "telemetry.seen": AS_OWNER,
  "telemetry.note": AS_OWNER,
  "system.news_tell": AS_OWNER,
  "environments.control": AS_OWNER,
};

/**
 * Flow and table methods apx_flow leaves out that change nothing, by reason. With FLOW_SETTINGS and OWNER_ONLY they place
 * every `flows.*` and `tables.*` method; flow-tool.test.ts fails on one left out (rules/FLOWS.md#agents-reach-it).
 */
export const FLOW_ELSEWHERE: Readonly<Record<string, string>> = {
  "flows.history_get": "an agent reads a version with flows.history {flow, entry}",
  "flows.next_runs": "the editor's preview of a schedule's next times while the owner types it",
  "flows.outward": "the editor's list of what a drawing sends out, shown before the owner publishes it",
  "flows.path_check": "the editor checks a new address is free before the owner sets it",
  "flows.token": "the webhook card shows its key to the owner; a key never reaches a model",
  "flows.try": "the owner tries a Flow's rules on a sample event in the editor",
  "flows.try_graph": "the owner tries one step on sample input in the editor",
};

/** Not decided yet: what the owner changes in the panel and the super-agent cannot, the next ones to place. */
export const NOT_YET: readonly string[] = [];
