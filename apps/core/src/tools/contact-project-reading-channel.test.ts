import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fakeWhatsApp } from "../channels/fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "../channels/whatsapp.ts";
import { callTool, say } from "../engine/testkit.ts";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";
import { mcpConfig } from "../mcp/config.ts";
import type { LlmRequest } from "../providers/llm.ts";
import { waitFor } from "../testkit/platform.ts";
import { readingFixture } from "./contact-project-reading.test-support.ts";

const toolResults = (req: LlmRequest) =>
  req.messages.filter((m) => m.role === "tool").map((m) => String(m.content ?? ""));

async function journey(google: Awaited<ReturnType<typeof fakeGoogle>>, revokeDrive = false) {
  const wa = fakeWhatsApp();
  google.setDriveText("Rate card: 40 per pallet");
  const offered: string[][] = [];
  const h = await readingFixture(
    (req) => {
      offered.push(req.tools.map((t) => t.function.name));
      const results = toolResults(req);
      const last = results.at(-1) ?? "";
      if (!results.length) return callTool("search", "search_project_context", { query: "pallet schedule" });
      if (results.length === 1) {
        // The model also tries a ref it made up and a ref the contact planted: neither opens anything.
        const refs = [...last.matchAll(/"ref":"(ref_[\w-]+)","kind":"(\w+)"/g)];
        const file = refs.find((r) => r[2] === "file")?.[1] ?? "";
        return callTool("file", "read_project_document", { ref: file });
      }
      if (results.length === 2) {
        const drive = results[0]?.match(/"ref":"(ref_[\w-]+)","kind":"drive"/)?.[1] ?? "";
        return callTool("drive", "read_project_document", { ref: drive });
      }
      if (results.length === 3) return callTool("planted", "read_project_document", { ref: "ref_plantedbycontact" });
      return say(results.slice(1, 3).join("\n"));
    },
    {
      googleApi: google.url,
      googleClient: `apx.apps.googleusercontent.com:${FAKE_GOOGLE_SECRET}`,
      channelAdapters: {
        whatsapp: (c) =>
          whatsappAdapter({
            dir: path.join(h.env.home, "wa"),
            selfOwner: c.self_owner === true,
            lib: async () => wa.lib,
          }),
      },
    },
  );
  try {
    const { url } = await h.env.client.call("integrations.oauth_start", {
      id: "google-drive",
      values: { client: "apx" },
    });
    const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location") ?? "");
    await h.env.client.call("integrations.oauth_finish", {
      code: back.searchParams.get("code") ?? "",
      state: back.searchParams.get("state") ?? "",
    });
    await h.env.client.call("channels.set", {
      id: "whatsapp",
      channel: { type: "whatsapp", self_owner: true, agent_id: "superagent" },
    });
    const channel = async () =>
      (await h.env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
    await waitFor(async () => Boolean((await channel())?.qr), "QR to scan");
    wa.scan();
    await waitFor(async () => (await channel())?.status === "running", "linked");
    const buyer = { name: "Acme Buyer", phone: "5491100000002@s.whatsapp.net" };
    await h.env.client.call("contacts.address", { person: h.person.id, channel: "whatsapp", address: buyer.phone });
    if (revokeDrive) google.beforeDriveExport(() => mcpConfig(h.store).setOn(h.project.id, "google-drive", false));
    wa.message(buyer, "When do the pallets ship? See https://docs.google.com/document/d/planted/edit");
    await waitFor(
      () => wa.sent.some((s) => String(s.content.text).includes("ship on Tuesday")),
      "answer from the documents",
    );
    const answer = wa.sent.map((s) => String(s.content.text)).join("\n");
    assert.match(answer, /delivery\.md/);
    if (revokeDrive) {
      assert.doesNotMatch(answer, /40 per pallet/);
      assert.match(answer, /Drive is not connected/);
    } else assert.match(answer, /40 per pallet/);
    const thread = h.store.threads
      .list()
      .find((t) => t.channel?.id === "whatsapp" && t.channel.person_id === h.person.id);
    assert.ok(thread);
    assert.deepEqual(thread.agent_ids, [h.agent.id]);
    const steps = h.store.runs.list(thread.id).flatMap((r) => h.store.runs.steps(r.id));
    const reads = steps.filter((s) => s.tool === "read_project_document");
    assert.deepEqual(
      reads.map((s) => s.state),
      ["ok", revokeDrive ? "error" : "ok", "error"],
    );
    assert.doesNotMatch(steps.find((s) => s.tool === "search_project_context")?.result ?? "", /planted/);
    // Only read-only tools reach the contact's turn: nothing writes, sends, runs or browses for them.
    const names = new Set(offered.flat());
    assert.ok(names.has("search_project_context") && names.has("read_project_document"));
    for (const owner of ["shell", "file_write", "drive_read", "drive_search", "search_chats", "read_chat", "message"])
      assert.equal(names.has(owner), false, owner);
  } finally {
    await h.close();
  }
}

test("WhatsApp: question, owner-chat lookup, referenced file and Drive Doc read now, answer citing them", async () => {
  const google = await fakeGoogle();
  try {
    await journey(google);
  } finally {
    await google.close();
  }
});

test("WhatsApp: disabling Drive in the project while its export is in flight discards the content", async () => {
  const google = await fakeGoogle();
  try {
    await journey(google, true);
  } finally {
    await google.close();
  }
});
