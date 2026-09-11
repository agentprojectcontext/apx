// `call_mcp` is graded by the tool it is about to call.
//
// It is ONE tool that reaches EVERY tool of every MCP a project has, which
// makes an agent's tool list a much weaker statement than it looks: the council
// agents declare a read-only set — no create_task, no write_file, no run_shell
// — and `call_mcp` sat in that same list able to reach `appsi_send_campaign`,
// `appsi_update_tenant` and `appsi_delete_campaign`. On the live project the
// CFO never did (33 calls, all reads), but nothing stopped it: the guarantee
// was good behaviour, not construction.
//
// Marking it dangerous WHOLESALE — what it did before — fails the other way:
// under `automatico` every MCP read asks for confirmation too, and a routine
// has nobody to ask, so the run loses the sources it needed. Blocking the reads
// to stop the writes is how a safety feature gets switched off.
import { test } from "node:test";
import assert from "node:assert/strict";

const { mcpToolRisk } = await import("#core/mcp/tool-risk.js");

const gated = (name, descriptor) => mcpToolRisk(name, descriptor).dangerous;

// --- the server's own word wins -------------------------------------------

test("a declared readOnlyHint beats anything the name suggests", () => {
  // Part of the MCP spec. Neither server this was written against sends one,
  // which is exactly why the fallback below has to be good — but when a server
  // does tell us what its own tool does, guessing from the name is worse.
  assert.equal(gated("appsi_delete_campaign", { annotations: { readOnlyHint: true } }), false);
  assert.equal(gated("knot_tasks", { annotations: { readOnlyHint: false } }), true);
});

test("a descriptor without annotations falls through to the name", () => {
  assert.equal(gated("appsi_list_apps", { name: "appsi_list_apps", inputSchema: {} }), false);
  assert.equal(gated("appsi_delete_campaign", { name: "appsi_delete_campaign" }), true);
});

// --- the verb is a token, not a prefix -------------------------------------

test("the verb is found wherever the server put it", () => {
  // Real names from the live project. A prefix rule gets every one of these
  // wrong, which is why there isn't one.
  for (const name of [
    "knot_memory_write", "knot_channel_post", "knot_task_accept", "knot_task_claim",
    "knot_task_comment", "knot_task_tag", "appsi_add_ticket_message",
    "knot_review_answer", "knot_review_request", "appsi_mark_ticket_reported",
  ]) {
    assert.equal(gated(name), true, `${name} changes something and must be gated`);
  }
});

test("camelCase is split too, not treated as one word", () => {
  assert.equal(gated("createCampaign"), true);
  assert.equal(gated("listCampaigns"), false);
});

// --- reads flow ------------------------------------------------------------

test("the reads the council actually makes are not gated", () => {
  // Verbatim from the CFO's first real council run. If any of these needed a
  // confirmation the weekly note would come back with its sources missing,
  // because a routine has nobody to answer.
  for (const name of [
    "appsi_list_tickets", "appsi_list_apps", "appsi_list_leads", "appsi_list_incidents",
    "appsi_list_plans", "appsi_get_tenant", "appsi_get_app_stats",
    "knot_search", "knot_tasks", "knot_channels", "knot_channel_read",
    "knot_memory", "knot_whoami", "knot_inbox",
  ]) {
    assert.equal(gated(name), false, `${name} only reads and must flow`);
  }
});

test("a bare plural noun reads — a lot of servers name a getter after its collection", () => {
  assert.equal(gated("knot_tasks"), false);
  assert.equal(gated("knot_channels"), false);
  assert.equal(gated("knot_reviews"), false);
});

// --- writes are gated ------------------------------------------------------

test("the calls that would touch production are gated", () => {
  for (const name of [
    "appsi_send_campaign", "appsi_update_tenant", "appsi_delete_campaign",
    "appsi_create_plan", "appsi_update_plan", "appsi_import_leads",
    "appsi_verify_user_email", "appsi_resend_user_verification",
  ]) {
    assert.equal(gated(name), true, `${name} must ask first`);
  }
});

test("a write token anywhere beats a read token anywhere", () => {
  // `knot_memory_write` holds both "memory" (read) and "write". The tie has to
  // go to the write or the rule is decorative.
  assert.equal(gated("knot_memory_write"), true);
  assert.equal(gated("list_and_delete_everything"), true);
});

// --- the tie ---------------------------------------------------------------

test("a name that says neither stays closed", () => {
  // A read wrongly gated is a source that reports itself unavailable — visible,
  // recoverable, and it says so in the note. A write wrongly let through is a
  // campaign that went out. The costs are not symmetric, so the tie does not go
  // to convenience.
  for (const name of ["knot_task_status", "appsi_test_agent", "frobnicate", ""]) {
    assert.equal(gated(name), true, `${name} is ambiguous and must stay closed`);
  }
});

test("it answers with a reason, so a blocked call can explain itself", () => {
  assert.match(mcpToolRisk("appsi_send_campaign").reason, /send/);
  assert.match(mcpToolRisk("appsi_list_apps").reason, /list/);
  assert.match(mcpToolRisk("frobnicate").reason, /neither/);
  assert.match(mcpToolRisk("x", { annotations: { readOnlyHint: true } }).reason, /declares/);
});

test("junk input does not throw", () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.doesNotThrow(() => mcpToolRisk(bad));
    assert.equal(mcpToolRisk(bad).dangerous, true, "and stays closed");
  }
});
