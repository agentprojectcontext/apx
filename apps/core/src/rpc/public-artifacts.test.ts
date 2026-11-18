import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { nativeApproval } from "../domain/approvals.ts";
import { callTool, pendingInput, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { publicationTransport } from "../public-artifacts/test-cloud.ts";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";

async function fixture(llm = scriptedLlm(() => say("ok")), cloud = publicationTransport()) {
  const env = await startCore({
    llm,
    accountClient: JSON.stringify({ project: "demo-apx-artifacts", apiKey: "public-test-key" }),
    publicArtifactFetch: cloud.fetch,
  });
  env.core.secrets.set(
    APX_ACCOUNT_SESSION,
    JSON.stringify({
      uid: "person",
      idToken: "private-identity-token",
      refreshToken: "private-refresh-token",
      expires: Number.MAX_SAFE_INTEGER,
      profile: { id: "abcd1234", name: "Acme", photo: "", handle: "" },
    }),
  );
  return { ...env, cloud };
}

const PAGE = '<script src="/_apx/kit@1.js"></script><h1>Orders</h1>';

test("public copies travel through the core contract: exact preview, chosen state, update, list and source-free revocation", async () => {
  const env = await fixture();
  try {
    const source = await env.client.call("surfaces.show", { name: "orders", title: "Orders", html: PAGE, app: true });
    await env.client.call("surfaces.set_state", {
      surface: source.id,
      patch: { chosen: [1, 2], private: "secret://private" },
    });
    const bare = await env.client.call("surfaces.public_prepare", { action: "publish", surface: source.id });
    assert.equal((await env.client.call("surfaces.public_preview", { draft: bare.draft })).bundle?.state, undefined);
    assert.equal(env.cloud.commits(), 0);
    const draft = await env.client.call("surfaces.public_prepare", {
      action: "publish",
      surface: source.id,
      state_keys: ["chosen"],
    });
    const preview = await env.client.call("surfaces.public_preview", { draft: draft.draft });
    assert.deepEqual(preview.bundle?.state, { chosen: [1, 2] });
    assert.equal(preview.account?.name, "Acme");
    assert.equal(Object.hasOwn(draft, "account"), false);
    assert.equal(preview.bundle?.store, undefined);
    assert.equal(preview.bundle?.db, undefined);
    assert.match(preview.bundle?.html ?? "", /apx-kit-cards/);
    assert.equal(env.core.store.surfaces.get(source.id)?.html, PAGE);
    assert.doesNotMatch(JSON.stringify(preview), /identity-token|refresh-token|secret:\/\/|"person"/);
    await assert.rejects(
      env.client.call("surfaces.public_commit", { draft: bare.draft }),
      /public_artifact_preview_expired/,
    );
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    for (const method of ["surfaces.public_preview", "surfaces.public_commit", "surfaces.public_discard"] as const)
      await assert.rejects(agent.call(method, { draft: draft.draft }), /reserved to the owner/);
    await assert.rejects(agent.call("surfaces.public_list", {}), /public_artifact_access_denied/);
    assert.equal(env.cloud.commits(), 0);
    const receipt = await env.client.call("surfaces.public_commit", { draft: draft.draft });
    assert.deepEqual(await env.client.call("surfaces.public_commit", { draft: draft.draft }), receipt);
    assert.equal(env.cloud.commits(), 1);
    assert.deepEqual(await env.client.call("surfaces.public_read", { code: receipt.code }), preview.bundle);
    await assert.rejects(agent.call("surfaces.public_read", { code: receipt.code }), /reserved to the owner/);
    assert.equal((await env.client.call("surfaces.public_list", {})).items[0]?.code, receipt.code);

    const replacement = await env.client.call("surfaces.show", {
      name: "invoices",
      title: "Invoices",
      html: "<h1>Invoices</h1>",
      app: true,
    });
    const update = await env.client.call("surfaces.public_prepare", {
      action: "update",
      code: receipt.code,
      surface: replacement.id,
    });
    assert.equal((await env.client.call("surfaces.public_preview", { draft: update.draft })).bundle?.state, undefined);
    await env.client.call("surfaces.public_commit", { draft: update.draft });
    const list = await env.client.call("surfaces.public_list", {});
    assert.equal(list.count, 1);
    assert.equal(list.items[0]?.code, receipt.code);
    assert.equal(list.items[0]?.title, "Invoices");
    await env.client.call("surfaces.remove", { surface: source.id });
    await env.client.call("surfaces.remove", { surface: replacement.id });
    assert.equal((await env.client.call("surfaces.public_list", {})).count, 1);
    const revoke = await env.client.call("surfaces.public_prepare", { action: "revoke", code: receipt.code });
    assert.equal((await env.client.call("surfaces.public_preview", { draft: revoke.draft })).bundle, undefined);
    await env.client.call("surfaces.public_commit", { draft: revoke.draft });
    assert.equal((await env.client.call("surfaces.public_list", {})).count, 0);
    assert.equal(env.cloud.commits(), 3);
    assert.equal(
      [...env.cloud.documents.keys()].some((name) => name.includes("/publicArtifacts/")),
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("Total still waits for a target-bound owner card before a publication can run", async () => {
  let draft = "";
  const env = await fixture(
    scriptedLlm((_req, { afterTool }) =>
      afterTool
        ? say("done")
        : callTool("publish", "apx_settings", { method: "surfaces.public_commit", params: { draft } }),
    ),
  );
  try {
    const source = await env.client.call("surfaces.show", { name: "orders", title: "Orders", html: "<h1>Orders</h1>" });
    draft = (await env.client.call("surfaces.public_prepare", { action: "publish", surface: source.id })).draft;
    await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: thread.id, text: "Publish the reviewed copy of Orders." });
    const input = await pendingInput(env.client, thread.id);
    assert.equal(input.tool, "apx_settings");
    assert.equal(input.artifact_draft, draft);
    const message = await env.client.call("threads.get", { thread: thread.id });
    const part = message.messages
      .flatMap((item) => item.parts)
      .find((item) => item.type === "input" && item.input_id === input.id);
    assert.ok(part?.type === "input");
    assert.equal(part.artifact_draft, draft);
    assert.match(input.detail ?? "", /Publish a copy of.*Orders/);
    assert.match(input.detail ?? "", /artifact\.apxagent\.app/);
    assert.deepEqual(input.approval_scopes ?? [], []);
    assert.equal(env.cloud.commits(), 0);
    const existing = env.core.store.inputs.get(input.id);
    assert.ok(existing);
    const target = nativeApproval("apx_settings");
    const legacy = env.core.store.inputs.create({
      run_id: existing.run_id,
      thread_id: thread.id,
      agent_id: "superagent",
      call_id: "legacy-public-copy",
      kind: "confirm",
      prompt: "Review this copy",
      tool: existing.tool,
      args: existing.args,
      approval: target,
      app_only: true,
      waitMs: 60_000,
    });
    env.core.store.approvals.grant(target, "always", thread.id, "superagent");
    assert.equal(env.core.store.inputs.get(input.id)?.state, "pending");
    assert.equal(env.core.store.inputs.get(legacy.id)?.state, "pending");
    assert.equal(env.cloud.commits(), 0);
    env.core.store.inputs.settle(legacy.id, "denied");
    await assert.rejects(
      env.client.call("runs.respond", { input: input.id, decision: "approve" }),
      /public_artifact_review_required/,
    );
    await assert.rejects(
      env.client.call("runs.respond", {
        input: input.id,
        decision: "approve",
        artifact_review: "00000000-0000-4000-8000-000000000000",
      }),
      /public_artifact_review_required/,
    );
    const other = await env.client.call("surfaces.show", {
      name: "invoices",
      title: "Invoices",
      html: "<h1>Invoices</h1>",
    });
    const unrelated = await env.client.call("surfaces.public_prepare", { action: "publish", surface: other.id });
    const unrelatedReview = await env.client.call("surfaces.public_preview", { draft: unrelated.draft });
    await assert.rejects(
      env.client.call("runs.respond", {
        input: input.id,
        decision: "approve",
        artifact_review: unrelatedReview.review_token,
      }),
      /public_artifact_review_required/,
    );
    const review = await env.client.call("surfaces.public_preview", { draft });
    assert.equal(env.cloud.commits(), 0);
    assert.equal(env.core.store.inputs.get(input.id)?.state, "pending");
    await env.client.call("runs.respond", {
      input: input.id,
      decision: "approve",
      artifact_review: review.review_token,
    });
    await env.settle(thread.id);
    assert.equal(env.cloud.commits(), 1);
    assert.equal((await env.client.call("surfaces.public_list", {})).count, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("project-scoped agent preparation cannot read another project's source or manage the account-wide list", async () => {
  let request: { method: string; params: Record<string, unknown> } = { method: "surfaces.public_list", params: {} };
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("prepare", "apx_settings", request),
  );
  const env = await fixture(llm);
  try {
    env.core.store.projects.upsert({ id: "acme", name: "Acme" });
    env.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
    const own = env.core.store.surfaces.upsert({
      name: "orders",
      title: "Orders",
      html: "<h1>Orders</h1>",
      project_id: "acme",
      created_by: "owner",
    });
    const other = env.core.store.surfaces.upsert({
      name: "journal",
      title: "Private journal",
      html: "<h1>Private</h1>",
      project_id: "northwind",
      created_by: "owner",
    });
    const global = env.core.store.surfaces.upsert({
      name: "global-page",
      title: "Global page",
      html: "<h1>Global</h1>",
      created_by: "owner",
    });
    for (const [params, expected] of [
      [{ action: "publish", surface: global.id }, /public_artifact_missing/],
      [{ action: "publish", surface: other.id }, /public_artifact_missing/],
      [{ action: "publish", surface: "missing" }, /public_artifact_missing/],
      [{ action: "publish", surface: own.id }, /"draft":"[0-9a-f-]{36}"/],
      [{ action: "revoke", code: "abcd1234" }, /public_artifact_access_denied/],
    ] as const) {
      request = { method: "surfaces.public_prepare", params };
      const thread = await env.client.call("threads.create", {
        kind: "loose",
        agent_id: "superagent",
        project_id: "acme",
      });
      await env.client.call("threads.send", { thread: thread.id, text: "Prepare the requested artifact operation." });
      await env.settle(thread.id);
      const result = String(llm.calls.at(-1)?.messages.findLast((message) => message.role === "tool")?.content);
      assert.match(result, expected);
      assert.doesNotMatch(result, /Private journal/);
      assert.equal((await env.client.call("runs.pending", { thread: thread.id })).inputs.length, 0);
    }
    request = { method: "surfaces.public_list", params: {} };
    const thread = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      project_id: "acme",
    });
    await env.client.call("threads.send", { thread: thread.id, text: "List published copies." });
    await env.settle(thread.id);
    assert.match(
      String(llm.calls.at(-1)?.messages.findLast((message) => message.role === "tool")?.content),
      /public_artifact_access_denied/,
    );
    assert.equal(env.cloud.commits(), 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

for (const outcome of ["denied", "signed out"] as const) {
  test(`a ${outcome} publication approval cannot write, even on Total`, async () => {
    let draft = "";
    const env = await fixture(
      scriptedLlm((_req, { afterTool }) =>
        afterTool
          ? say("done")
          : callTool("publish", "apx_settings", { method: "surfaces.public_commit", params: { draft } }),
      ),
    );
    try {
      const source = await env.client.call("surfaces.show", {
        name: "orders",
        title: "Orders",
        html: "<h1>Orders</h1>",
      });
      draft = (await env.client.call("surfaces.public_prepare", { action: "publish", surface: source.id })).draft;
      await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
      await env.client.call("threads.send", { thread: thread.id, text: "Publish the reviewed copy of Orders." });
      const input = await pendingInput(env.client, thread.id);
      assert.equal(input.artifact_draft, draft);
      assert.equal(env.core.store.inputs.get(input.id)?.app_only, true);
      assert.equal(env.cloud.commits(), 0);
      if (outcome === "signed out") {
        const review = await env.client.call("surfaces.public_preview", { draft });
        await env.client.call("account.logout", {});
        await assert.rejects(
          env.client.call("runs.respond", {
            input: input.id,
            decision: "approve",
            artifact_review: review.review_token,
          }),
        );
      }
      await env.client.call("runs.respond", { input: input.id, decision: "deny" });
      await env.settle(thread.id);
      assert.equal(env.cloud.commits(), 0);
      assert.equal(env.cloud.documents.size, 0);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("changed sources, discarded reviews and provider failures cannot bypass the reviewed copy or leak credentials", async () => {
  const cloud = publicationTransport();
  const transport = cloud.fetch;
  cloud.fetch = async (input, init) => {
    if (init?.method === "POST") throw new Error("Bearer private-identity-token");
    return transport(input, init);
  };
  const env = await fixture(undefined, cloud);
  try {
    const source = await env.client.call("surfaces.show", { name: "orders", title: "Orders", html: "<h1>Orders</h1>" });
    const discarded = await env.client.call("surfaces.public_prepare", { action: "publish", surface: source.id });
    assert.deepEqual(await env.client.call("surfaces.public_discard", { draft: discarded.draft }), { ok: true });
    await assert.rejects(
      env.client.call("surfaces.public_commit", { draft: discarded.draft }),
      /public_artifact_preview_expired/,
    );
    const changed = await env.client.call("surfaces.public_prepare", { action: "publish", surface: source.id });
    await env.client.call("surfaces.show", { name: "orders", title: "Orders", html: "<h1>Changed</h1>" });
    await assert.rejects(
      env.client.call("surfaces.public_commit", { draft: changed.draft }),
      /public_artifact_source_changed/,
    );
    const ready = await env.client.call("surfaces.public_prepare", { action: "publish", surface: source.id });
    await assert.rejects(env.client.call("surfaces.public_commit", { draft: ready.draft }), {
      message: "public_artifact_unavailable",
    });
    assert.equal(cloud.commits(), 0);
    await env.client.call("account.logout", {});
    await assert.rejects(env.client.call("surfaces.public_list", {}), /sign_in_required/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
