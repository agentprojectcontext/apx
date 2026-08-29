// Rule 11, made mechanical.
//
// The web panel is its own pnpm workspace, and eslint.config.js ignores it
// wholesale ("own pnpm workspace with its own strict tsc gate"). That gate is
// a TYPE checker, not a linter: ~47k lines of TS/TSX are typed and nothing
// else. So the three invariants rule 11 states as prose — Base UI only, every
// request through lib/api, every string in both dictionaries — were held by
// discipline alone. All three were green when this file landed; the point is
// that they stay green without anyone remembering to look.
//
// Asserting on the front end from the backend suite is the established pattern
// here (chat-turn-shape, web-composer, web-chat-dock and a dozen more read the
// same sources), and it costs no new dependency: esbuild is already a devDep,
// and this suite already runs in preflight, pre-push and CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const WEB = path.join(__dirname, "..", "src", "interfaces", "web");
const WEB_SRC = path.join(WEB, "src");

/** Every .ts/.tsx under the panel's src/, as [repo-relative path, source]. */
function webSources() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(full);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push([path.relative(WEB_SRC, full), fs.readFileSync(full, "utf8")]);
      }
    }
  })(WEB_SRC);
  return out;
}

/** Load a locale dictionary by transpiling it — the files are plain object
 *  literals, so this reads the REAL keys rather than regexing 2.5k lines. */
function loadDict(file, exportName) {
  const built = buildSync({
    entryPoints: [path.join(WEB_SRC, "i18n", file)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
  const dict = mod.exports[exportName];
  assert.ok(dict && typeof dict === "object", `${file} must export \`${exportName}\``);
  return dict;
}

/** Dotted paths of every leaf string, so a whole missing group is one diff. */
function leafKeys(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) leafKeys(v, key, out);
    else out.add(key);
  }
  return out;
}

test("i18n: every key exists in both dictionaries (rule 11)", () => {
  // Why this cannot be left to tsc. `t()` is typed as DeepKeys<EsStrings> — so
  // TypeScript checks call sites against es.ts and NOTHING checks en.ts, which
  // enters the dictionary map as `unknown`. Worse, lookupWithFallback() falls
  // back to the Spanish dict when the active locale lacks the key, so a key
  // missing from en.ts is not a crash and not a dev warning (that fires only
  // when BOTH lack it) — it is an English-speaking user silently reading
  // Spanish. Nothing in the build, the type check or the browser reports it.
  const en = loadDict("en.ts", "en");
  const es = loadDict("es.ts", "es");
  const EN = leafKeys(en);
  const ES = leafKeys(es);

  const missingInEs = [...EN].filter((k) => !ES.has(k)).sort();
  const missingInEn = [...ES].filter((k) => !EN.has(k)).sort();
  const show = (list) => list.slice(0, 20).join(", ") + (list.length > 20 ? `, …(+${list.length - 20})` : "");

  assert.deepEqual(missingInEn, [], `keys in es.ts with no en.ts entry — these read as Spanish for an English user: ${show(missingInEn)}`);
  assert.deepEqual(missingInEs, [], `keys in en.ts with no es.ts entry: ${show(missingInEs)}`);
  // A dictionary that loaded as an empty object would pass the two checks
  // above trivially, so pin the order of magnitude too.
  assert.ok(EN.size > 2000, `expected the full dictionary, got ${EN.size} keys`);
});

test("web: the panel is Base UI, never Radix or a shadcn install (rule 11)", () => {
  // The decision is spec/decisions/005-no-radix-on-web-panel.md. It survives
  // as long as nobody runs `npx shadcn add`, which would write components.json
  // and pull the whole Radix tree in behind it as a transitive dep.
  const pkg = JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const radix = Object.keys(deps).filter((d) => d.startsWith("@radix-ui/"));
  assert.deepEqual(radix, [], `Radix packages in the web panel: ${radix.join(", ")}`);

  assert.ok(
    !fs.existsSync(path.join(WEB, "components.json")),
    "components.json is back — that is the shadcn installer's config, and rule 11 keeps it deleted",
  );

  const offenders = webSources()
    .filter(([, src]) => /from\s+["']@radix-ui\//.test(src))
    .map(([rel]) => rel);
  assert.deepEqual(offenders, [], `files importing Radix directly: ${offenders.join(", ")}`);
});

test("web: requests go through lib/api, not a bare fetch (rule 11)", () => {
  // Every call needs the daemon's base URL and the bearer token that
  // useTokenBootstrap fetches from /api/admin/web-token. A component calling
  // fetch() directly gets neither: it works on localhost with auth off and
  // 401s the moment the panel is reached over Tailscale.
  //
  // These three ARE the plumbing, so they are where raw fetch belongs:
  const ALLOWED = new Set([
    "lib/http.ts", // the get/post helper every lib/api module is built on
    "lib/net.ts", // probes candidate daemon origins before a base URL exists
    "hooks/useTokenBootstrap.ts", // fetches the token itself — cannot use it yet
  ]);

  const offenders = webSources()
    .filter(([rel]) => !rel.startsWith("lib/api/") && !ALLOWED.has(rel))
    // `fetch(` preceded by a word character is someone else's method
    // (`api.fetch(`, `queryClient.fetchX`) — only the global call counts.
    .filter(([, src]) => /(^|[^\w.])fetch\s*\(/m.test(src))
    .map(([rel]) => rel);

  assert.deepEqual(
    offenders,
    [],
    `bare fetch() outside lib/api — route these through src/lib/api/*: ${offenders.join(", ")}`,
  );
});

// Rule 11a: a user-visible label starts with a Capital; a FRAGMENT does not.
//
// A fragment is a string the interface composes into a running sentence or
// drops mid-text ("in {amount}", "cada {n} horas…"), plus the rule's data
// carve-out — a slug, a path, a file name, a command or a config key keeps its
// real spelling. Those are the only strings allowed to open lowercase, and each
// one is listed here under the reason it qualifies.
//
// The list is explicit rather than a pattern, on purpose. A heuristic ("ends in
// _ph", "contains a {placeholder}") would quietly re-open the door this closes:
// 169 keys had already drifted into lowercase labels by the time the gate was
// written — status chips reading "running", badges reading "agents", form
// labels reading "slug" — and most of them would have matched some plausible
// pattern and stayed that way.
//
// Adding a key here is a claim that the string is grammatically part of
// something larger. If it NAMES something on screen, Capitalise it instead.
const SENTENCE_FRAGMENTS = new Set([
  // schedule descriptions (lib/cron.ts / routines/shared.ts build the phrase; AGENTS.md 11a names these verbatim)
  "cron.daily", "cron.weekdays", "cron.weekends", "cron.monthly", "cron.every_hour",
  "cron.every_n_hours", "cron.every_n_minutes", "cron.every_minute", "agents_ui.every_n_unit",
  "agents_ui.every_v", "agents_ui.sched_manual",

  // time units substituted into `every {n} {unit}`
  "agents_ui.unit_seconds", "agents_ui.unit_minutes", "agents_ui.unit_hours",
  "agents_ui.unit_days",

  // substituted into "Window model: {value}." — never a label on its own
  "modules_ui.desktop_model_inherit",

  // relative time dropped mid-text (AGENTS.md 11a names `in`)
  "when.now", "when.in", "when.ago",

  // sits between two numbers: `{n} of {m}`
  "logs.count_of",

  // a preposition introducing its object, like `in` / `ago` above
  "project.tasks.via", "project.threads.via",

  // follows the file name it describes
  "chat_ui.attachment_missing", "chat_ui.attachment_failed", "chat_ui.attach_failed",
  "chat_ui.attach_too_big",

  // follows the subject it qualifies
  "project.groups.pulled_by", "project.commitments.no_date", "settings.profile.over_budget",
  "settings.nudge.bypass", "settings.nudge.unrated", "project.agent_detail.model_unlisted",
  "provider_test.served_mismatch", "voice_ui.stt_hw_limited", "router_panel.hint_offline",

  // routing condition, read as `When: …`
  "routing_panel.when_any", "routing_panel.when_image", "routing_panel.when_no_image",
  "routing_panel.when_min_prompt", "routing_panel.when_max_prompt",
  "routing_panel.when_min_context", "routing_panel.when_channels",
  "routing_panel.when_keywords",

  // descriptive hint continuing the field it sits under
  "project.groups.members_hint", "project.mcps.args_hint", "agents_ui.comma_separated",
  "agents_ui.brain_pan_hint", "agents_ui.config_def_desc", "agents_ui.memory_durable_desc",
  "memory_panel.openai_desc", "memory_panel.gemini_desc", "voice_ui.openai_model_hint",
  "telegram_channels.no_owner", "project.agents.slug_invalid", "base.defaults_slug_invalid",
  "agents_ui.body_hint", "project.mcps.env_invalid",

  // config key / field name shown verbatim.
  //
  // TelegramChannelDialog labels every field with the key it writes on the
  // channel object — bot_token, chat_id, route_to_agent, owner_user_id — so
  // `name` and `project` belong in that spelling too. The first pass over 11a
  // capitalised those two, which broke the one pattern the dialog has; they are
  // back to lowercase and listed here so the gate stops asking.
  "project.config.model", "project.config.perm", "project.config.route",
  "project.telegram.route_agent", "telegram_channel_dialog.token_label",
  "telegram_channel_dialog.chat_id", "telegram_channel_dialog.route_label",
  "telegram_channel_dialog.owner_label", "telegram_channel_dialog.name_label",
  "telegram_channel_dialog.project_label", "telegram_ui.send_chat_id",
  "telegram_ui.user_id_fallback", "project.mcps.transport_stdio", "project.mcps.logs_stderr",
  "project.memories.chars",

  // example value typed into the field (a slug, a command, a model id, a path)
  "project.agents.slug_ph", "project.agents.role_ph", "project.agents.skills_ph",
  "project.agents.tools_ph", "project.mcps.name_ph", "project.mcps.cmd_ph",
  "project.mcps.url_ph", "project.agent_detail.area_ph", "telegram_roles.name_ph",
  "telegram_roles.tools_ph", "skills_page.add_slug_ph", "skills_page.repo_url_ph",
  "providers_modal.base_url_ph", "agents_ui.slug_kebab_hint", "memory_panel.model_ph",
  "project.commitments.field_what_ph", "project.routines.prompt_exec_ph",
  "project.routines.prompt_super_ph", "agents_ui.tg_text_ph", "agents_ui.hb_message_ph",
  "project.agent_detail.tools_csv_ph", "shared_ui.kv_value_ph",

  // `e.g.` / `ej.` — a lowercase abbreviation opens the string
  "pairing.code_ph", "pairing.label_ph", "project.chat.model_hint", "project.agents.model_hint",
  "project.agent_detail.area_hint", "project.config.model_hint",
  "project.tasks.add_placeholder", "logs.filter_channel", "files.path_example",
  "voice_ui.stt_custom_baseurl_hint", "voice_ui.stt_custom_model_hint",
  "settings_ui.test_placeholder",

  // process exit output, reproduced as the shell prints it
  "modules_ui.code_artifact_exit_ok", "modules_ui.code_artifact_exit_fail",
  "modules_ui.code_artifact_exit_badge",

  // the product spells its own name lowercase
  "superagent.badge", "code_module.badge", "modules_ui.code_super_agent",
  "agents_ui.super_agent_badge",
]);

/** Dotted path -> the string itself, so a key can be looked up by the name the
 *  allowlist and the failure message both use. */
function leafEntries(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) leafEntries(v, key, out);
    else out[key] = v;
  }
  return out;
}

test("i18n: user-visible labels start with a Capital (rule 11a)", () => {
  const en = leafEntries(loadDict("en.ts", "en"));
  const es = leafEntries(loadDict("es.ts", "es"));

  // \p{Ll}, not [a-z]: three Spanish labels opened with "ú" ("última:") while
  // their English twins had already been fixed to "Last:". An ASCII-only check
  // called those clean, and per-locale drift is exactly what 11a forbids —
  // "both en.ts and es.ts follow this per key".
  const opensLowercase = (s) => typeof s === "string" && /^\p{Ll}/u.test(s);

  const offenders = [];
  for (const key of Object.keys(en)) {
    if (SENTENCE_FRAGMENTS.has(key)) continue;
    for (const [lang, dict] of [["en", en], ["es", es]]) {
      if (opensLowercase(dict[key])) offenders.push(`${key} (${lang}) = ${JSON.stringify(dict[key])}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these open lowercase. If one NAMES something on screen, Capitalise it in BOTH dictionaries; " +
      "if it is a fragment, add it to SENTENCE_FRAGMENTS with the reason:\n  " +
      offenders.slice(0, 25).join("\n  "),
  );

  // Keeps the list honest: an entry whose string no longer opens lowercase (it
  // was reworded, or its key was deleted) is a stale claim, and a stale
  // allowlist is how an exception list turns into somewhere to hide things.
  const stale = [...SENTENCE_FRAGMENTS].filter((k) => !opensLowercase(en[k]) && !opensLowercase(es[k]));
  assert.deepEqual(stale, [], `SENTENCE_FRAGMENTS entries that no longer apply — remove them: ${stale.join(", ")}`);
});
