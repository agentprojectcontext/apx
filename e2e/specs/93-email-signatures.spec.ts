import type { EmailSignatureEntry } from "../../packages/protocol/src/index.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("email signatures are editable in Account without contacting a mail server", async ({ page }) => {
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
  try {
    await open(page);
    await openSettings(page);
    const dialog = page.getByRole("dialog", { name: "Configuración", exact: true });
    await expect(dialog.getByText("Firmas de email", { exact: true })).toBeVisible();
    await dialog.getByRole("combobox", { name: "Cuenta de email" }).click();
    await page.getByRole("option", { name: "Signature mailbox · user@example.com" }).click();
    await expect(dialog.getByLabel("Firma en texto plano", { exact: true })).toHaveValue("Existing signature");
    await expect(dialog.getByRole("button", { name: "Quitar firma", exact: true })).toBeEnabled();
    await dialog.getByLabel("Firma en texto plano", { exact: true }).fill("Acme support");
    await dialog
      .getByLabel("Firma HTML (opcional)", { exact: true })
      .fill('<b>Acme</b><a href="https://example.com">Support</a>');
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    const read = async () => (await rpc<{ signatures: EmailSignatureEntry[] }>("email.signatures_get")).signatures;
    await expect
      .poll(async () => (await read()).find((e) => e.account === "signature-mail")?.text)
      .toBe("Acme support");
    await page.reload();
    await openSettings(page);
    await expect(dialog.getByText("Firmas de email", { exact: true })).toBeVisible();
    await dialog.getByRole("combobox", { name: "Cuenta de email" }).click();
    await page.getByRole("option", { name: "Signature mailbox · user@example.com" }).click();
    await expect(dialog.getByLabel("Firma en texto plano", { exact: true })).toHaveValue("Acme support");
    await dialog.getByLabel("Agregar la firma automáticamente").click();
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect.poll(async () => (await read()).find((e) => e.account === "signature-mail")?.enabled).toBe(false);
    await dialog.getByRole("button", { name: "Quitar firma", exact: true }).click();
    await expect.poll(async () => (await read()).some((e) => e.account === "signature-mail")).toBe(false);
    expect((await read()).find((e) => e.account === other.account)).toEqual(other);
  } finally {
    const signatures = (await rpc<{ signatures: EmailSignatureEntry[] }>("email.signatures_get")).signatures;
    await rpc("email.signatures_set", {
      signatures: signatures.filter((e) => e.account !== "signature-mail" && e.account !== other.account),
    });
    await rpc("channels.set", { id: "signature-mail", channel: null });
  }
});
