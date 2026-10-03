// Discord and Slack, emulated: each bot is connected from Config › Channels with its token(s), the owner writes to it
// in a direct message, gets a code, links it as their own account, and from then on talks to the super-agent there.
import type { Page } from "@playwright/test";
import { expect, open, test, until, world } from "./kit.ts";

async function connect(page: Page, kind: "Discord" | "Slack", tokens: Array<[label: string, value: string]>) {
  await open(page);
  await page.getByRole("button", { name: "Agregar canal" }).click();
  await page.getByRole("menuitem", { name: new RegExp(kind) }).click();
  for (const [label, value] of tokens) await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  await page.getByRole("button", { name: "Conectar bot" }).click();
  await expect(page.getByText("@apx", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`Este es mi ${kind}`)).toBeVisible();
}

async function linkAndTalk(page: Page, channel: "dc" | "sl", owner: { id: string; name: string }) {
  await world.dm(channel, owner, "hola bot");
  const first = await until(async () =>
    (await world.dmSentTo(channel, owner.id)).find((m) => /\d{6}/.test(m.text ?? "")),
  );
  const code = /(\d{6})/.exec(first.text ?? "")?.[1] ?? "";
  await page.getByRole("textbox", { name: "Código" }).first().fill(code);
  await page.getByRole("button", { name: "Vincular" }).first().click();
  await expect(page.getByText("“hola bot”")).toBeHidden();

  await world.dm(channel, owner, "Remind me to call Northwind");
  await until(async () =>
    (await world.dmSentTo(channel, owner.id)).some((m) => m.text?.includes("Got it: Remind me to call Northwind")),
  );
}

test("Discord: the bot connects with its token, the owner links their account and talks to the super-agent", async ({
  page,
}) => {
  const { discord } = await world.info();
  await connect(page, "Discord", [["Token del bot", discord]]);
  await linkAndTalk(page, "dc", { id: "5150", name: "Owner" });
});

test("Slack: the app connects with both tokens, the owner links their account and talks to the super-agent", async ({
  page,
}) => {
  const { slack } = await world.info();
  await connect(page, "Slack", [
    ["Token del bot", slack.bot],
    ["Token de la app", slack.app],
  ]);
  await linkAndTalk(page, "sl", { id: "U5150", name: "Owner" });
});
