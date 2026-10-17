// An agent on total autonomy works in any folder, from a chat with no project too (DECISIONS.md#d-102).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

type Thread = {
  runs: Array<{ ended_at?: string }>;
  messages: Array<{ parts: Array<{ type: string; tool?: string; status?: string }> }>;
};

test("an agent on total autonomy writes in another folder from a chat with no project, with no card", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const northwind = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-anywhere-")));
  const note = path.join(northwind, "note.txt");
  await rpc("agents.create", { slug: "ondina", name: "Ondina" });
  await rpc("agents.update", { agent: "ondina", autonomy: "total" });
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "ondina", title: "Afuera" });
  try {
    await open(page, `#thread=${chat.id}`);
    await page.getByRole("textbox", { name: /Escribile/ }).fill(`write a note at ${note}`);
    await page.keyboard.press("Enter");

    const thread = () => rpc<Thread>("threads.get", { thread: chat.id });
    await expect.poll(async () => (await thread()).runs.every((r) => r.ended_at)).toBe(true);
    await expect(page.locator(".inputcard.is-pending")).toHaveCount(0);
    expect(fs.readFileSync(note, "utf8")).toBe("note\n");
    const parts = (await thread()).messages.flatMap((m) => m.parts);
    expect(parts.some((p) => p.type === "tool" && p.tool === "shell" && p.status === "ok")).toBe(true);
  } finally {
    await rpc("agents.update", { agent: "ondina", autonomy: "standard" });
    fs.rmSync(northwind, { recursive: true, force: true });
  }
});
