import type { EmailSignatureEntry, Params, Result } from "../../packages/protocol/src/index.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("Gmail connection editing is separate from integration preferences", async ({ page }) => {
  await rpc("setup.finish");
  const catalog = await rpc<Result<"integrations.list">>("integrations.list");
  await page.route("**/rpc/integrations.list", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        result: {
          integrations: catalog.integrations.map((i) =>
            i.id === "gmail"
              ? { ...i, connected: true, oauth: { ...i.oauth, account: "user@example.com" } }
              : { ...i, connected: false },
          ),
        },
      },
    });
  });
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Integraciones/ }).click();
  await page.getByRole("button", { name: "Configurar integración", exact: true }).click();
  const preferences = page.getByRole("dialog", { name: "Configurar integración", exact: true });
  await expect(preferences.getByLabel("Firma en texto plano", { exact: true })).toBeVisible();
  await expect(preferences.getByRole("combobox", { name: "Cuenta de email" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Editar conexión", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Firma en texto plano", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("SMTP account signatures stay isolated across mailbox selection and reload", async ({ page }) => {
  await rpc("setup.finish");
  const { agents } = await rpc<{ agents: Array<{ id: string }> }>("agents.list");
  const agent = agents[0];
  expect(agent).toBeTruthy();
  await rpc("channels.set", {
    id: "signature-mail",
    channel: {
      type: "email",
      agent_id: agent?.id,
      enabled: false,
      label: "Signature mailbox",
      email: {
        address: "user@example.com",
        imap: { host: "127.0.0.1", port: 9, tls: "none" },
        smtp: { host: "127.0.0.1", port: 9, tls: "none" },
      },
    },
  });
  const mailbox = (await rpc<Result<"channels.list">>("channels.list")).channels.find((c) => c.id === "signature-mail");
  expect(mailbox).toBeTruthy();
  await rpc("channels.set", {
    id: "signature-mail-two",
    channel: {
      type: "email",
      agent_id: agent?.id,
      email: { ...mailbox?.email, address: "other@example.com" },
      label: "Second mailbox",
      enabled: false,
    },
  });
  const other: EmailSignatureEntry = {
    transport: "smtp",
    account: "Signature-mail",
    sender: "user@example.com",
    text: "Other account signature",
    enabled: true,
  };
  const existing = (await rpc<{ signatures: EmailSignatureEntry[] }>("email.signatures_get")).signatures;
  await rpc("email.signatures_set", {
    signatures: [
      ...existing,
      other,
      { ...other, account: "signature-mail", sender: "User@example.com", text: "Existing signature" },
    ],
  });
  let addedId: string | undefined;
  try {
    await open(page);
    await openSettings(page);
    const dialog = page.getByRole("dialog", { name: "Configuración", exact: true });
    await dialog.getByRole("button", { name: "Canales", exact: true }).click();
    await dialog.getByRole("radio", { name: "Email", exact: true }).click();
    await expect(dialog.getByText("Firmas de email", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Firma en texto plano", { exact: true })).toHaveValue("Existing signature");
    await expect(dialog.getByRole("button", { name: "Quitar firma", exact: true })).toBeEnabled();
    await dialog.getByLabel("Firma en texto plano", { exact: true }).fill("Acme support");
    await dialog
      .getByLabel("Firma HTML (opcional)", { exact: true })
      .fill('<b>Acme</b><a href="https://example.com">Support</a>');
    await dialog.getByRole("button", { name: "Guardar firma", exact: true }).click();
    const read = async () => (await rpc<{ signatures: EmailSignatureEntry[] }>("email.signatures_get")).signatures;
    await expect
      .poll(async () => (await read()).find((e) => e.account === "signature-mail")?.text)
      .toBe("Acme support");
    await dialog.getByRole("combobox", { name: "Cuenta de email" }).click();
    await page.getByRole("option", { name: "Second mailbox · other@example.com" }).click();
    await expect(dialog.getByLabel("Firma en texto plano", { exact: true })).toHaveValue("");
    await dialog.getByLabel("Firma en texto plano", { exact: true }).fill("Second account signature");
    await dialog.getByRole("button", { name: "Guardar firma", exact: true }).click();
    await expect
      .poll(async () => (await read()).find((e) => e.account === "signature-mail-two")?.text)
      .toBe("Second account signature");
    await dialog.getByRole("button", { name: "Agregar cuenta de email", exact: true }).click();
    await expect(dialog.getByLabel("Dirección", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.route("**/rpc/channels.set", async (route) => {
      const params = route.request().postDataJSON() as Params<"channels.set">;
      expect(params.channel?.type).toBe("email");
      expect(params.id).not.toBe("email");
      expect(params.id).not.toBe("signature-mail");
      addedId = params.id;
      const result = await rpc("channels.set", { ...params, channel: { ...params.channel, enabled: false } });
      await route.fulfill({ json: { ok: true, result } });
    });
    await dialog.getByRole("button", { name: "Agregar cuenta de email", exact: true }).click();
    await dialog.getByLabel("Dirección", { exact: true }).fill("new@example.com");
    await dialog.getByLabel("Correo entrante (IMAP) · Servidor", { exact: true }).fill("127.0.0.1");
    await dialog.getByLabel("Correo saliente (SMTP) · Servidor", { exact: true }).fill("127.0.0.1");
    await dialog.getByLabel("Contraseña de aplicación", { exact: true }).fill("test-only-password");
    await dialog.getByRole("button", { name: "Conectar casilla", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await rpc<Result<"channels.list">>("channels.list")).channels.find((c) => c.id === addedId)?.email?.address,
      )
      .toBe("new@example.com");
    await page.unroute("**/rpc/channels.set");
    await page.reload();
    await openSettings(page);
    await dialog.getByRole("button", { name: "Canales", exact: true }).click();
    await dialog.getByRole("radio", { name: "Email", exact: true }).click();
    await expect(dialog.getByText("Firmas de email", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Firma en texto plano", { exact: true })).toHaveValue("Acme support");
    await dialog.getByLabel("Agregar la firma automáticamente").click();
    await dialog.getByRole("button", { name: "Guardar firma", exact: true }).click();
    await expect.poll(async () => (await read()).find((e) => e.account === "signature-mail")?.enabled).toBe(false);
    await dialog.getByRole("button", { name: "Quitar firma", exact: true }).click();
    await expect.poll(async () => (await read()).some((e) => e.account === "signature-mail")).toBe(false);
    expect((await read()).find((e) => e.account === other.account)).toEqual(other);
  } finally {
    const signatures = (await rpc<{ signatures: EmailSignatureEntry[] }>("email.signatures_get")).signatures;
    await rpc("email.signatures_set", {
      signatures: signatures.filter(
        (e) => e.account !== "signature-mail" && e.account !== "signature-mail-two" && e.account !== other.account,
      ),
    });
    await rpc("channels.set", { id: "signature-mail", channel: null });
    await rpc("channels.set", { id: "signature-mail-two", channel: null });
    if (addedId) await rpc("channels.set", { id: addedId, channel: null });
  }
});
