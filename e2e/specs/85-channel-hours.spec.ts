// A channel's attention hours: the owner turns them on in the channel's settings (days and times in their time zone);
// a contact who writes outside them is kept unanswered, and the chat is answered once the channel answers again.
import { expect, open, rpc, test, until, world } from "./kit.ts";

const buyer = { id: 8585, name: "Northwind Buyer" };
type Hours = { days: number[]; from: string; to: string };
type Channels = { channels: Array<{ id: string; type: string; hours?: Hours }> };

const hoursOf = async () => (await rpc<Channels>("channels.list")).channels.find((c) => c.type === "telegram")?.hours;

test("attention hours: set in the channel's settings, a contact waits outside them and is answered after", async ({
  page,
}) => {
  // The waiting chat is answered on the office clock's next tick, up to 15 s after the hours end.
  test.setTimeout(60_000);
  await open(page);
  await page.getByRole("button", { name: "Telegram", exact: true }).first().click();
  await page.getByRole("button", { name: "Configuración del canal" }).click();
  const hours = page.getByRole("switch", { name: "Horario de atención" });
  await expect(hours).not.toBeChecked();
  await expect(page.getByText("Les responde a los contactos a cualquier hora.")).toBeVisible();

  await hours.click();
  await until(async () => (await hoursOf())?.to === "22:00");
  expect(await hoursOf()).toEqual({ days: [1, 2, 3, 4, 5, 6, 0], from: "08:00", to: "22:00" });
  await expect(page.getByText(/A vos siempre te responde/)).toBeVisible();
  await expect(page.getByText("Días y horas")).toBeVisible();
  await page.getByRole("textbox", { name: "Hasta" }).fill("21:30");
  await until(async () => (await hoursOf())?.to === "21:30");
  await page.getByText("Dom", { exact: true }).click();
  await until(async () => !(await hoursOf())?.days.includes(0));

  // Today left out: a contact who writes now waits, with no model call.
  // Today as the owner's time zone reads it (none set: this computer's, where the test core runs).
  const zone = (await rpc<{ timezone: string }>("owner.get")).timezone || undefined;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: zone }).format(new Date());
  const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  if (today !== 0) {
    await page.getByText(["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][today] ?? "", { exact: true }).click();
    await until(async () => !(await hoursOf())?.days.includes(today));
  }
  await world.telegram(buyer, "hello");
  const code = /\b(\d{6})\b/.exec((await until(async () => (await world.sentTo(buyer.id))[0]))?.text ?? "")?.[1];
  await rpc("pairing.respond", { code, decision: "contact", name: buyer.name });
  const calls = await world.llmCalls();
  await world.telegram(buyer, "are you open today?");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Northwind Buyer/ })
    .first()
    .click();
  await expect(page.getByRole("region", { name: buyer.name }).getByText("are you open today?")).toBeVisible();
  expect((await world.sentTo(buyer.id)).length).toBe(1);
  expect(await world.llmCalls()).toBe(calls);

  // Without hours the channel answers again: the office clock answers the waiting chat on its next tick.
  await page.getByRole("button", { name: "Telegram", exact: true }).first().click();
  await page.getByRole("button", { name: "Configuración del canal" }).click();
  await page.getByRole("switch", { name: "Horario de atención" }).click();
  await until(async () => (await hoursOf()) === undefined);
  const answer = await until(
    async () => (await world.sentTo(buyer.id)).find((m) => m.text?.includes("Got it")),
    30_000,
  );
  expect(answer.text).toBeTruthy();
});
