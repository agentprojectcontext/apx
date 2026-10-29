// A flow that acts outside APX: an incoming webhook calls another service and tells the owner on their chat app.
// The service is the sandbox's own on this computer (the only one a test core may call) and the chat app is the
// emulated Telegram the owner linked in the setup; nothing real is called or written to.
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, until, world } from "./kit.ts";

const OWNER_TG = 4242;
const L = {
  en: {
    newFlow: "New flow",
    name: "Flow name",
    addHook: "Add Incoming webhook",
    addCall: "Add Outgoing webhook",
    addNotify: "Add Notify",
    channel: "Channel",
    to: "To",
    you: "You",
    message: "Message",
    outgoing: "Outgoing webhook",
    save: "Save",
    saved: "Saved. Turn it on to run it as drawn.",
    close: "Exit the editor",
    toggle: (n: string) => `Turn ${n} on or off`,
    allowTitle: "Let this flow act for you?",
    sendYou: "Send you a message on Telegram",
    call: /Call 127\.0\.0\.1:\d+ with POST/,
    allow: "Allow",
    answered: "Answered 201",
    sent: "Sent to you on Telegram.",
  },
  es: {
    newFlow: "Nuevo flow",
    name: "Nombre del flow",
    addHook: "Sumar Webhook entrante",
    addCall: "Sumar Webhook saliente",
    addNotify: "Sumar Avisar",
    channel: "Canal",
    to: "Para",
    you: "Vos",
    message: "Mensaje",
    outgoing: "Webhook saliente",
    save: "Guardar",
    saved: "Guardado. Prendelo para que corra como está dibujado.",
    close: "Salir del editor",
    toggle: (n: string) => `Encender o apagar ${n}`,
    allowTitle: "¿Dejás que este flow actúe por vos?",
    sendYou: "Mandarte un mensaje por Telegram",
    call: /Llamar a 127\.0\.0\.1:\d+ con POST/,
    allow: "Permitir",
    answered: "Respondió 201",
    sent: "Te llegó por Telegram.",
  },
};

for (const lang of ["en", "es"] as const) {
  test(`webhook → outgoing webhook → notify runs once allowed, and its detail shows what was asked and sent (${lang})`, async ({
    page,
  }) => {
    const l = L[lang];
    await rpc("setup.finish");
    const { service } = await world.info();
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Outward ${lang}` })).project.id;
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    const name = `Acme leads ${lang}`;
    const email = `lu-${lang}@northwind.example`;
    await open(page, `#view=flows&scope=${project}`);
    await page.getByRole("button", { name: l.newFlow }).first().click();
    const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: l.addHook }) });
    await editor.getByRole("textbox", { name: l.name }).fill(name);

    // Each step is added after the one chosen: webhook → outgoing webhook → notify.
    await editor.getByRole("button", { name: l.addHook }).click();
    await editor.getByRole("button", { name: l.addCall }).click();
    await editor.getByRole("textbox", { name: "URL" }).fill(`${service}/v1/enroll`);
    await editor.getByRole("textbox", { name: "Headers" }).fill("X-Lead: $trigger.email");
    await editor
      .getByRole("textbox", { name: "Body" })
      .fill('{ "email": "$trigger.email", "seats": "$trigger.seats" }');
    await editor.getByRole("button", { name: l.addNotify }).click();
    // The destination is picked from the owner's own channels and people, never typed.
    const telegram = editor.getByRole("radio", { name: "Telegram" });
    if (await telegram.count()) await telegram.click();
    else {
      await editor.getByRole("combobox", { name: l.channel }).click();
      await page.getByRole("option", { name: "Telegram" }).click();
    }
    await editor.getByRole("combobox", { name: l.to }).click();
    await page.getByRole("option", { name: l.you, exact: true }).click();
    await editor.getByRole("textbox", { name: l.message }).fill("Lead $trigger.email:");
    // The result of the call goes in with one click, named by its step.
    await editor.getByRole("button", { name: l.outgoing, exact: true }).click();
    await expect(editor.getByRole("textbox", { name: l.message })).toHaveValue(
      "Lead $trigger.email: $steps.http-1.json",
    );
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText(l.saved);
    // Saved is saved: closing right away doesn't ask to leave without saving.
    await editor.getByRole("button", { name: l.close }).click();

    // Turning it on asks first: where it sends as the owner and what it calls.
    await page.getByRole("switch", { name: l.toggle(name) }).click();
    const ask = page.getByRole("dialog", { name: l.allowTitle });
    await expect(ask).toContainText(l.sendYou);
    await expect(ask).toContainText(l.call);
    await ask.getByRole("button", { name: l.allow }).click();
    await expect(page.getByRole("switch", { name: l.toggle(name) })).toBeChecked();
    const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.id ?? "";
    const graph = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
    expect(graph.published?.nodes.map((n) => n.kind)).toEqual(["webhook", "http", "notify"]);

    // An event comes in through the flow's address.
    const credential = await rpc<Result<"public_routes.rotate">>("public_routes.rotate", { path: `/flows/${flow}` });
    const { value: token } = await rpc<Result<"secrets.reveal">>("secrets.reveal", {
      name: credential.secret_ref.slice(9),
    });
    const { port } = await rpc<Result<"webhooks.get">>("webhooks.get", {});
    const posted = await fetch(`http://127.0.0.1:${port}/flows/${flow}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: `lead-${lang}`, data: { email, seats: 3, to: "someone-else" } }),
    });
    expect(posted.status).toBe(202);
    await expect
      .poll(async () => (await rpc<Result<"flows.events">>("flows.events", { flow })).events[0]?.state)
      .toBe("succeeded");

    // The service got one request with the bound values; the owner got the message, whatever the event said.
    const call = (await world.serviceCalls()).find((c) => c.headers["x-lead"] === email);
    expect(call?.method).toBe("POST");
    expect(JSON.parse(call?.body ?? "null")).toEqual({ email, seats: 3 });
    const message = await until(async () =>
      (await world.sentTo(OWNER_TG)).find((m) => m.text?.startsWith(`Lead ${email}:`)),
    );
    expect(message.text).toBe(`Lead ${email}: {"enrolled":true,"list":"nurture-web"}`);

    // The detail shows both steps: what was asked and answered, and where the message went.
    await page.reload();
    await page.locator('.react-flow__node[data-id="http-1"]').click();
    await expect(page.getByText(l.answered)).toBeVisible();
    await expect(page.getByText(`POST ${service}/v1/enroll`)).toBeVisible();
    await page.locator('.react-flow__node[data-id="notify-1"]').click();
    await expect(page.getByText(l.sent)).toBeVisible();
  });
}
