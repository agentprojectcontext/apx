// In a chat with several speakers each one's face sits over their words, initials in the middle of the circle; the
// owner's own words, typed here or come in on a channel, stay on their side without a face.
import type { Message, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a room's letter faces keep their initials centred", async ({ page }) => {
  await rpc("setup.finish");
  const thread = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "superagent", title: "Room faces" });
  const at = new Date(0).toISOString();
  const messages: Message[] = [
    {
      id: "f1",
      thread_id: thread.id,
      seq: 1,
      author: { kind: "user" },
      parts: [{ type: "text", text: "Hola" }],
      created_at: at,
    },
    {
      id: "f2",
      thread_id: thread.id,
      seq: 2,
      author: { kind: "person", id: "telegram:6262", name: "Northwind Ops", channel: "telegram" },
      parts: [{ type: "text", text: "Buenas" }],
      created_at: at,
    },
    {
      id: "f3",
      thread_id: thread.id,
      seq: 3,
      author: { kind: "person", id: "owner", name: "Acme Owner", channel: "discord" },
      parts: [{ type: "text", text: "Sigo por acá" }],
      created_at: at,
    },
  ];
  await page.route("**/rpc/threads.get", async (route) => {
    if (route.request().postDataJSON().thread !== thread.id) return route.continue();
    await route.fulfill({ json: { ok: true, result: { thread: { ...thread, kind: "group" }, messages, runs: [] } } });
  });
  await open(page, `#thread=${thread.id}`);
  const faces = page.locator(".transcript__face");
  await expect(faces).toHaveCount(1);
  await expect(page.locator(".apx-msg--user")).toHaveCount(2);
  for (const face of await faces.all()) {
    const offset = await face.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const text = (el.firstElementChild as HTMLElement).getBoundingClientRect();
      return Math.max(
        Math.abs(box.left + box.width / 2 - (text.left + text.width / 2)),
        Math.abs(box.top + box.height / 2 - (text.top + text.height / 2)),
      );
    });
    expect(offset).toBeLessThanOrEqual(1.5);
  }
  await expect(faces.first()).toHaveText("NO");
  await page.unrouteAll({ behavior: "wait" });
  await rpc("threads.delete", { thread: thread.id });
});
