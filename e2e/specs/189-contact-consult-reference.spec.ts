import type { AdapterIO, ChannelAdapter } from "../../apps/core/src/channels/types.ts";
import { callTool, say } from "../../apps/core/src/engine/testkit.ts";
import { waitFor } from "../../apps/core/src/testkit/platform.ts";
import { readingFixture } from "../../apps/core/src/tools/contact-project-reading.test-support.ts";
import { expect, test } from "./kit.ts";

const question = `Which dock can accept the delayed pallets? ${"Please check the delivery plan. ".repeat(12)}`;

async function prepare(h: Awaited<ReturnType<typeof readingFixture>>) {
  await h.env.client.call("setup.finish", {});
  h.store.settings.write("channels", [
    {
      id: "test",
      type: "telegram",
      label: "Delivery line",
      enabled: false,
      agent_id: h.agent.id,
      strangers: "ignore",
      concurrency: "queue",
      owner_thread: "home",
    },
  ]);
}

test("a historical consultation never displays private instructions while its component loads", async ({ page }) => {
  const h = await readingFixture(undefined, { port: 0 });
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    await prepare(h);
    h.store.messages.add({
      thread_id: h.thread.id,
      author: { kind: "agent", id: h.agent.id },
      parts: [
        {
          type: "subthread",
          thread_id: "missing_conversation",
          agent_id: "superagent",
          title: "Private context that must never be a loading label",
          state: "completed",
        },
      ],
    });
    await page.route("**/SubthreadPart-*.js", async (route) => {
      requested.resolve();
      await release.promise;
      await route.continue();
    });
    await page.goto(`${h.env.core.url}/#channel=test&chat=${h.thread.id}`);
    await requested.promise;
    await expect(page.locator(".chan__consult")).toBeVisible();
    await expect(page.locator(".chan__consult")).not.toContainText("Private context");
    release.resolve();
    await expect(page.locator(".chan__consult-fallback")).toContainText("Delivery → Roby");
    await expect(page.locator(".chan__consult-link")).toHaveCount(0);
  } finally {
    release.resolve();
    try {
      if (!page.isClosed()) await page.goto("about:blank");
    } finally {
      await h.close();
    }
  }
});

test("consultation references, opening and continuing never add messages to the customer's WhatsApp", async ({
  page,
}) => {
  const outbound: Array<{ conversation: string; text: string }> = [];
  let receive: AdapterIO["receive"] | undefined;
  const adapter: ChannelAdapter = {
    caps: { typing: false, buttons: false },
    async start(io) {
      receive = io.receive;
      return { account: "Acme delivery" };
    },
    async stop() {},
    async send(conversation, presentation) {
      outbound.push({ conversation, text: presentation.text });
      return { external_id: `sent-${outbound.length}` };
    },
  };
  const reply = "Your delivery is confirmed.";
  const internal = "Private review for the delivery agent only.";
  const h = await readingFixture(
    (_req, { system, afterTool, said }) => {
      if (system.includes("You are Delivery")) {
        if (!afterTool)
          return callTool("consult", "consult_super_agent", {
            question: said.includes("again") ? "Can you check the dock again?" : question,
          });
        return say(reply);
      }
      return say(internal);
    },
    { port: 0, channelAdapters: { whatsapp: () => adapter } },
  );
  try {
    await h.env.client.call("setup.finish", {});
    h.store.persons.link(h.person.id, { channel: "test", external_id: h.person.id });
    await h.env.client.call("channels.set", {
      id: "test",
      channel: {
        type: "whatsapp",
        label: "Delivery line",
        agent_id: h.agent.id,
        strangers: "ignore",
        owner_thread: "own",
      },
    });
    expect(receive).toBeDefined();
    const send = (external_id: string, text: string) =>
      receive?.({
        external_id,
        conversation: h.person.id,
        sender: { id: h.person.id, name: h.person.name },
        text,
        private: true,
      });
    const cards = () =>
      h.store.messages
        .list(h.thread.id, 50)
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "subthread");
    send("first-message", "Check the delivery dock.");
    await waitFor(
      () => outbound.length === 1 && cards().some((p) => p.state === "completed"),
      "the authorized reply reaches the customer",
    );
    expect(outbound).toEqual([{ conversation: h.person.id, text: reply }]);
    await page.goto(`${h.env.core.url}/#channel=test&chat=${h.thread.id}`);
    await page.locator(".chan__consult-link").click();
    await expect(page.locator(".sidepanel .transcript")).toContainText(internal);
    expect(outbound).toEqual([{ conversation: h.person.id, text: reply }]);
    send("second-message", "Please check again.");
    await waitFor(
      () => outbound.length === 2 && cards().length === 2 && cards().every((p) => p.state === "completed"),
      "the continued consultation and second authorized reply settle",
    );
    expect(cards()[1]?.thread_id).toBe(cards()[0]?.thread_id);
    await page.goto(`${h.env.core.url}/#channel=test&chat=${h.thread.id}`);
    const next = page.locator(".chan__consult-link").filter({ hasText: "Can you check the dock again?" });
    await expect(next).toBeVisible();
    await next.click();
    await expect(page.locator(".sidepanel .transcript")).toContainText("Can you check the dock again?");
    expect(outbound).toEqual([
      { conversation: h.person.id, text: reply },
      { conversation: h.person.id, text: reply },
    ]);
  } finally {
    try {
      if (!page.isClosed()) await page.goto("about:blank");
    } finally {
      await h.close();
    }
  }
});

for (const language of ["es", "en"] as const) {
  test(`the supervised contact chat shows the real consultation and opens it beside the contact (${language})`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      if (location.protocol !== "http:") return;
      const prefs = JSON.parse(localStorage.getItem("apx.prefs") ?? "{}");
      localStorage.setItem("apx.prefs", JSON.stringify({ ...prefs, language }));
    }, language);
    const h = await readingFixture(
      (_req, { system, afterTool }) => {
        if (system.includes("You are Delivery") && !afterTool)
          return callTool("consult", "consult_super_agent", { question });
        return say("Use the north dock.");
      },
      { port: 0 },
    );
    try {
      await prepare(h);
      await h.env.client.call("threads.send", { thread: h.thread.id, text: "Check the delivery dock." });
      const cards = () =>
        h.store.messages
          .list(h.thread.id, 50)
          .flatMap((m) => m.parts)
          .filter((p) => p.type === "subthread");
      await waitFor(() => cards().some((p) => p.state === "completed"), "consultation settles");
      const card = cards()[0];
      expect(card).toBeDefined();
      await page.goto(`${h.env.core.url}/#channel=test&chat=${h.thread.id}`);
      const reference = page.locator(".chan__consult-link");
      await expect(reference).toContainText("Delivery →");
      await expect(reference).toContainText(question);
      await expect(page.locator(".chan__note")).toHaveCount(0);
      await reference.focus();
      await page.keyboard.press("Enter");
      const side = page.locator(".sidepanel");
      await expect(side.locator(".transcript")).toContainText(question.trim());
      await expect(side.locator(".transcript")).toContainText("Use the north dock.");
      await expect(side.locator(".transcript")).not.toContainText("<contact_question");
      await expect(side.locator(".transcript")).not.toContainText("only what answers this");
      expect(new URL(page.url()).hash).toContain(`chat=${h.thread.id}`);
      await expect(page.locator(".chan__chat")).toBeVisible();
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/consult-desktop-${language}.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(side.locator(".transcript")).toBeVisible();
      await expect(page.locator(".chan__chat")).not.toBeVisible();
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/consult-phone-${language}.png` });
      await side.getByRole("button", { name: language === "es" ? "Cerrar panel" : "Close panel", exact: true }).click();
      await expect(reference).toBeVisible();
      await reference.click();
      await expect(side.locator(".transcript")).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${h.env.core.url}/#thread=${h.thread.id}`);
      await expect(reference).toBeVisible();
      await reference.click();
      await expect(page.locator(".sidepanel .transcript")).toContainText(question.trim());

      h.store.messages.add({
        thread_id: h.thread.id,
        author: { kind: "agent", id: h.agent.id },
        parts: [
          {
            type: "tool",
            call_id: "legacy",
            tool: "consult_super_agent",
            title: "Asked the super-agent",
            status: "ok",
          },
        ],
      });
      h.store.messages.add({
        thread_id: h.thread.id,
        author: { kind: "agent", id: h.agent.id },
        parts: [
          {
            type: "subthread",
            thread_id: "missing_conversation",
            agent_id: "superagent",
            title: "Private instructions are not a question",
            state: "completed",
          },
        ],
      });
      await page.goto(`${h.env.core.url}/#channel=test&chat=${h.thread.id}`);
      await expect(page.locator(".chan__note")).toContainText(["Asked the super-agent", "Delivery → Roby"]);
      await expect(page.locator(".chan__msglist")).not.toContainText("Private instructions are not a question");
      await expect(reference).toHaveCount(1);
    } finally {
      try {
        if (!page.isClosed()) await page.goto("about:blank");
      } finally {
        await h.close();
      }
    }
  });
}
