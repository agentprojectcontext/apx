import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import { browserTools } from "./browser.ts";
import { planUsageTools } from "./plan-usage.ts";
import { allowedTools, authorize, inherit } from "./policy.ts";
import { shellTools } from "./shell.ts";
import { type Confirm, defineTool, type Effect } from "./types.ts";

const base = (name: string, effect: Effect = "none", confirm: Confirm = "never") => ({
  name,
  description: name,
  args: z.object({}),
  effect,
  confirm,
  deadlineMs: 1000,
  title: () => name,
  run: async () => "",
});
const tool = (...a: Parameters<typeof base>) => defineTool(base(...a));

const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  name: "Ann",
  role: "",
  kind: "agent",
  browser_profile: "shared",
  source: "local",
  prompt: "",
  ...over,
});

const ALL = [
  tool("browser_open", "external"),
  tool("browser_text"),
  tool("show_widget", "local"),
  tool("delegate", "message"),
  tool("read_output"),
  tool("ask_owner"),
];
const names = (a: AgentRecord) => allowedTools(a, ALL).map((t) => t.name);
/** What a turn sends directly for this agent (its focus), and what an outsider's turn lets it use at all. */
const focused = (a: AgentRecord, tools = ALL) => {
  const p = inherit(a, [], tools);
  return p.tools.filter((t) => p.focus(t.name)).map((t) => t.name);
};
const walled = (a: AgentRecord, tools = ALL, callers: AgentRecord[] = []) => inherit(a, callers, tools, true);

test("tools: a list is the agent's focus by name or group; every other tool stays reachable (DECISIONS.md#d-271)", () => {
  assert.deepEqual(
    focused(agent()),
    ALL.map((t) => t.name),
  );
  assert.deepEqual(focused(agent({ tools: ["browser"] })), [
    "browser_open",
    "browser_text",
    "read_output",
    "ask_owner",
  ]);
  assert.deepEqual(focused(agent({ tools: ["Show_Widget", "agents"] })), [
    "show_widget",
    "delegate",
    "read_output",
    "ask_owner",
  ]);
  // The list no longer walls the owner's agent off anything: it reaches every tool its rules allow.
  assert.deepEqual(
    names(agent({ tools: ["browser"] })),
    ALL.map((t) => t.name),
  );
  // An outsider's turn (a contact, a consult, a Flow bot) keeps the list as a wall.
  assert.deepEqual(
    walled(agent({ tools: ["browser"] })).tools.map((t) => t.name),
    ["browser_open", "browser_text", "read_output", "ask_owner"],
  );
});

test("an agent with a stale tools list still reaches show_widget through the bridge; rules off and outsiders do not", () => {
  const bridge = [tool("tool_search"), tool("tool_run")];
  const all = [...ALL, ...bridge, tool("task_list"), tool("shell", "local", "ask")];
  // The list templates wrote before widgets and images were in it.
  const stale = agent({ tools: ["files", "shell", "tasks", "memory", "browser", "agents", "mcp", "web_search"] });
  const p = inherit(stale, [], all);
  assert.equal(p.allows("show_widget"), true, "show_widget is still the agent's");
  assert.equal(p.focus("show_widget"), false, "outside its focus it is found with tool_search, not sent");
  assert.equal(p.focus("tool_search") && p.allows("tool_search"), true, "the bridge stays in the turn");
  assert.equal(p.focus("shell"), true);
  // An explicit rule turning a risk off still takes the tool away, list or not.
  assert.equal(inherit(agent({ ...stale, rules: { write: "off" } }), [], all).allows("show_widget"), false);
  // A contact's sealed turn, a consult or a Flow bot: the list stays a wall.
  assert.equal(walled(stale, all).allows("show_widget"), false);
});

test("quota reads obey risk rules, never open administration, and a caller's list no longer narrows a helper", () => {
  const quota = planUsageTools();
  const all = [...ALL, ...quota, tool("apx_settings")];
  assert.ok(allowedTools(agent(), all).some((t) => t.name === "plan_usage"));
  assert.ok(!allowedTools(agent(), all).some((t) => t.name === "apx_settings"));
  assert.ok(!allowedTools(agent({ tools: ["apx_settings"] }), all).some((t) => t.name === "apx_settings"));
  assert.ok(!allowedTools(agent({ rules: { read: "off" } }), all).some((t) => t.name === "plan_usage"));
  assert.ok(allowedTools(agent({ tools: ["browser"] }), all).some((t) => t.name === "plan_usage"));
  assert.equal(inherit(agent(), [agent({ tools: ["browser"] })], all).allows("plan_usage"), true);
  assert.equal(walled(agent(), all, [agent({ tools: ["browser"] })]).allows("plan_usage"), false);
  // A rule off above still narrows the helper (actingAs), whatever the lists say.
  assert.equal(inherit(agent(), [agent({ rules: { read: "off" } })], all).allows("plan_usage"), false);
});

test("an MCP-only list focuses on MCP for the owner, and still restricts builtins in an outsider's turn", () => {
  for (const tools of [["mcp"], ["mcp_notes_echo"], ["tool_search", "tool_run"]]) {
    assert.deepEqual(
      names(agent({ tools })),
      ALL.map((t) => t.name),
    );
    assert.deepEqual(focused(agent({ tools })), ["read_output", "ask_owner"]);
    assert.deepEqual(
      walled(agent({ tools })).tools.map((t) => t.name),
      ["read_output", "ask_owner"],
    );
  }
});

test("tools: a list of MCP tools restricts what joins later only in an outsider's turn", () => {
  const withBridge = [...ALL, tool("tool_search"), tool("tool_run")];
  const a = agent({ tools: ["mcp_notes_echo"] });
  assert.deepEqual(
    walled(a, withBridge).tools.map((t) => t.name),
    ["read_output", "ask_owner", "tool_search", "tool_run"],
  );
  // There the MCP tools that join later are held to the same list, and to every caller's up the chain.
  const p = walled(a, withBridge, [agent({ id: "boss", tools: ["mcp"] })]);
  assert.equal(p.allows("mcp_notes_echo"), true);
  assert.equal(p.allows("mcp_notes_wipe"), false);
  assert.equal(
    walled(agent(), withBridge, [agent({ id: "boss", tools: ["browser"] })]).allows("mcp_notes_echo"),
    false,
  );
  // For the owner, every MCP tool stays reachable through the bridge.
  assert.equal(inherit(a, [agent({ id: "boss", tools: ["browser"] })], withBridge).allows("mcp_notes_wipe"), true);
});

test("tools: a list naming nothing APX knows focuses on nothing, and strips no tool", () => {
  assert.deepEqual(
    focused(agent({ tools: ["Bash", "Edit"] })),
    ALL.map((t) => t.name),
  );
  assert.deepEqual(
    walled(agent({ tools: ["Bash", "Edit"] })).tools.map((t) => t.name),
    ALL.map((t) => t.name),
  );
});

test("manual asks before every call that changes something; total confirms nothing, not even 'always'", () => {
  const open = tool("x", "external", "untrusted");
  const read = tool("y");
  const always = tool("z", "local", "always");
  assert.equal(authorize(open, {}, agent({ autonomy: "manual" }), false).kind, "confirm");
  assert.equal(authorize(read, {}, agent({ autonomy: "manual" }), true).kind, "allow");
  assert.equal(authorize(open, {}, agent({ autonomy: "total" }), true).kind, "allow");
  assert.equal(authorize(always, {}, agent({ autonomy: "total" }), false).kind, "allow");
  assert.equal(authorize(always, {}, agent({ autonomy: "total" }), true).kind, "allow");
  assert.equal(authorize(always, {}, agent(), false).kind, "confirm");
});

const write = defineTool({ ...base("file_write", "local", "untrusted"), workspace: true });
const command = defineTool({ ...base("shell", "external", "ask"), workspace: true });
const destroy = defineTool({ ...base("shell", "external", "always"), workspace: true });
const send = tool("message_contact", "message", "untrusted");
const post = tool("post_it", "external", "ask");

test("auto, the default: writes and commands where it works run, outside content or not; strong actions ask", () => {
  for (const a of [agent(), agent({ autonomy: "auto" })]) {
    assert.equal(authorize(write, {}, a, true).kind, "allow");
    assert.equal(authorize(command, {}, a, true).kind, "allow");
    assert.equal(authorize(command, {}, a, false).kind, "allow");
    assert.equal(authorize(destroy, {}, a, false).kind, "confirm");
    // Sending in the owner's name asks once outside content is in the turn, and a call that asks for itself asks.
    assert.equal(authorize(send, {}, a, true).kind, "confirm");
    assert.equal(authorize(send, {}, a, false).kind, "allow");
    assert.equal(authorize(post, {}, a, false).kind, "confirm");
  }
});

test("accept edits: file edits where it works run; a command that changes something asks", () => {
  const edits = agent({ autonomy: "accept_edits" });
  assert.equal(authorize(write, {}, edits, true).kind, "allow");
  assert.equal(authorize(command, {}, edits, false).kind, "confirm");
  assert.equal(authorize(destroy, {}, edits, false).kind, "confirm");
  assert.equal(authorize(send, {}, edits, true).kind, "confirm");
});

test("plan: reads run, anything that changes something is refused with what to do instead", () => {
  const plan = agent({ autonomy: "plan" });
  assert.equal(authorize(tool("read_it"), {}, plan, true).kind, "allow");
  for (const t of [write, command, send, post]) {
    const d = authorize(t, {}, plan, false);
    assert.equal(d.kind, "deny", t.name);
    assert.match(d.kind === "deny" ? d.reason : "", /proposal in your answer/);
  }
  // It still asks the owner and hands reading work to a helper.
  assert.equal(authorize(tool("ask_owner", "message"), {}, plan, false).kind, "allow");
  assert.equal(authorize(tool("delegate", "message"), {}, plan, false).kind, "allow");
});

test("a delegated run works in its caller's mode, not the strictest of the chain", () => {
  const all = [tool("x")];
  const total = agent({ id: "top", autonomy: "total" });
  assert.equal(inherit(agent({ id: "h" }), [total], all).agent.autonomy, "total");
  assert.equal(
    inherit(agent({ id: "h", autonomy: "total" }), [agent({ id: "c", autonomy: "manual" })], all).agent.autonomy,
    "manual",
  );
  // Down a chain the top caller's mode reaches every helper (callers nearest first).
  assert.equal(
    inherit(agent({ id: "h" }), [agent({ id: "mid", autonomy: "manual" }), total], all).agent.autonomy,
    "total",
  );
  // A helper set to manual runs a command its caller on total would not stop for.
  const helper = inherit(agent({ id: "h", autonomy: "manual" }), [total], [command]).agent;
  assert.equal(authorize(command, {}, helper, true).kind, "allow");
});

test("auto: high-impact calls wait only while untrusted content is in context", () => {
  assert.equal(authorize(send, {}, agent(), false).kind, "allow");
  assert.equal(authorize(send, {}, agent(), true).kind, "confirm");
  assert.equal(authorize(tool("open", "external"), {}, agent(), true).kind, "allow");
});

test("rules: an agent's own rule for a risk wins over its mode, and off takes the tools away", () => {
  const sendIt = tool("send_it", "message");
  const writeIt = tool("write_it", "local", "ask");
  const wipe = tool("wipe_it", "local", "always");
  const read = tool("read_it");
  const ruled = agent({ autonomy: "total", rules: { outside: "ask", irreversible: "off", write: "auto" } });
  assert.equal(authorize(sendIt, {}, ruled, false).kind, "confirm");
  assert.equal(authorize(wipe, {}, ruled, false).kind, "deny");
  assert.equal(authorize(writeIt, {}, agent({ autonomy: "manual", rules: { write: "auto" } }), true).kind, "allow");
  assert.equal(authorize(read, {}, ruled, true).kind, "allow");
  assert.deepEqual(
    allowedTools(ruled, [sendIt, wipe, read, tool("ask_owner")]).map((t) => t.name),
    ["send_it", "read_it", "ask_owner"],
  );
});

test("rules: a delegated helper keeps its own rules over its caller's mode, and an off above stays off", () => {
  const caller = agent({ id: "boss", autonomy: "total", rules: { outside: "auto" } });
  const { agent: run } = inherit(agent({ id: "w", rules: { outside: "ask" } }), [caller], []);
  assert.equal(run.autonomy, "total");
  assert.equal(run.rules?.outside, "ask");
  assert.equal(inherit(agent({ id: "w2" }), [caller], []).agent.rules?.outside, "auto");
  const strict = inherit(agent({ id: "w3", rules: { write: "auto" } }), [agent({ rules: { write: "off" } })], []);
  assert.equal(strict.agent.rules?.write, "off");
});

test("shell: a command that only reads here never waits, outside content in the turn or not, in any mode", () => {
  const store = { settings: { read: () => ({ about: "", timezone: "" }) } };
  const shell = shellTools(store as never, "/nonexistent-apx-home", () => 7440).find((t) => t.name === "shell");
  assert.ok(shell);
  const run = (command: string, a: AgentRecord) => authorize(shell, { command }, a, true).kind;
  const reads = [
    "find . -maxdepth 4 -type f | grep -i readme",
    "git ls-tree -r --name-only 1a2b3c4 | grep src/",
    "git log --since='2 weeks ago' --format='%h %an %s'",
    "git -C ~/work/northwind-docs rev-parse --short HEAD",
    "git branch -avv",
    "find apps/mobile/src -name '*.tsx' | sort",
    "pwd; git status --short; ls ..",
  ];
  for (const autonomy of ["manual", "auto", "accept_edits", "plan"] as const)
    for (const c of reads) assert.equal(run(c, agent({ autonomy })), "allow", `${autonomy}: ${c}`);
  // The owner's own rule for reads still holds.
  assert.equal(run(reads[0] as string, agent({ rules: { read: "ask" } })), "confirm");
  // Anything that reaches the network, writes or is unknown runs in auto and asks in manual and accepting edits.
  for (const c of [
    "curl -s https://example.com",
    "gh pr list",
    "git fetch origin",
    "rm notes.txt",
    "ls > listing.txt",
  ]) {
    assert.equal(run(c, agent()), "allow", c);
    assert.equal(run(c, agent({ autonomy: "manual" })), "confirm", c);
    assert.equal(run(c, agent({ autonomy: "accept_edits" })), "confirm", c);
  }
  // Publishing a branch runs in Auto; a release (a tag) or a forced push waits (DECISIONS.md#d-208).
  assert.equal(run("git push origin main", agent()), "allow");
  assert.equal(run("git push origin main", agent({ autonomy: "manual" })), "confirm");
  assert.equal(run("git push origin v2.13.4", agent()), "confirm");
  assert.equal(run("git push --force origin main", agent()), "confirm");
});

test("total and a rule 'auto' skip a card, except one a call keeps (DECISIONS.md#d-143, DECISIONS.md#d-203)", () => {
  const always = tool("routine_like", "local", "always");
  const kept = defineTool({ ...base("login_like", "local", "always"), keepsCard: () => "grant" as const });
  const setting = defineTool({ ...base("setting_like", "local", "always"), ownerSetting: () => true });
  const key = defineTool({
    ...base("key_like", "local", "always"),
    ownerSetting: () => true,
    keepsCard: () => "card" as const,
  });
  for (const who of [agent({ autonomy: "total" }), agent({ rules: { irreversible: "auto" } })]) {
    assert.equal(authorize(always, {}, who, true).kind, "allow");
    assert.equal(authorize(kept, {}, who, false).kind, "confirm");
    // A setting the owner asks for follows the mode; one that keeps its card does not.
    assert.equal(authorize(setting, {}, who, true).kind, "allow");
    assert.equal(authorize(key, {}, who, false).kind, "confirm");
  }
  assert.equal(authorize(setting, {}, agent({}), false).kind, "confirm");
});

test("copying the owner's logins keeps its card in total, a grant counting only for the shared profile", () => {
  const login = browserTools({} as never, "/path/to/home", () => new Set()).find(
    (t) => t.name === "browser_use_my_login",
  );
  assert.ok(login?.keepsCard);
  const total = (browser_profile: AgentRecord["browser_profile"]) => agent({ autonomy: "total", browser_profile });
  assert.equal(authorize(login, { domain: "example.com" }, total("shared"), false).kind, "confirm");
  assert.equal(login.keepsCard({ domain: "example.com" }, total("shared")), "grant");
  assert.equal(login.keepsCard({ domain: "example.com" }, total("isolated")), "card");
});

test("a release waits for the owner even in Total; a plain push too once the owner asked to be asked", () => {
  let publish: "auto" | "ask" | undefined;
  const store = { settings: { read: () => ({ about: "", timezone: "", publish }) } };
  const shell = shellTools(store as never, "/nonexistent-apx-home", () => 7440).find((t) => t.name === "shell");
  assert.ok(shell);
  const run = (command: string, a: AgentRecord) => authorize(shell, { command }, a, false).kind;
  const total = agent({ autonomy: "total" });
  // Hard: a tag, a GitHub release, a forced push (DECISIONS.md#d-208).
  for (const c of ["git push origin v2.13.4", "gh release create v2.13.4", "git push --force origin main"])
    assert.equal(run(c, total), "confirm", c);
  // Medium: publishing a branch runs on its own, in Auto and in Total.
  assert.equal(run("git push origin main", total), "allow");
  assert.equal(run("git push origin main", agent()), "allow");
  publish = "ask";
  assert.equal(run("git push origin main", total), "confirm");
  assert.equal(run("git push origin main", agent()), "confirm");
  assert.equal(run("git status", total), "allow", "only publishing asks");
});
