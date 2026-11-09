// An email account's settings fit mail: the owner types their own addresses instead of a code, there is no Home switch
// and no "while it works" choice, and strangers are only listed (no mail goes to them).
import { expect, open, rpc, test, until } from "./kit.ts";

type Person = { role: string; addresses: Array<{ channel: string; external_id: string }> };

test("email settings: own addresses typed, no Home or while-it-works choice, strangers only listed", async ({
  page,
}) => {
  // Its servers are not there: the account shows an error, and its settings still open.
  const { id } = await rpc<{ id: string }>("channels.add", {
    type: "email",
    label: "Northwind support",
    email: {
      address: "support@northwind.example",
      imap: { host: "127.0.0.1", port: 9, tls: "none" },
      smtp: { host: "127.0.0.1", port: 9, tls: "none" },
      mailbox: "INBOX",
      allowed: [],
      trust_unverified: false,
    },
    token: "app-password-0000",
  });
  try {
    // Straight to the account: with many accounts the sidebar folds some of them away.
    await open(page, `#channel=${id}`);
    await page.getByRole("button", { name: "Configuración del canal" }).click();
    const dialog = page.getByRole("dialog");

    const mine = dialog.getByRole("textbox", { name: "Tus direcciones" });
    await mine.fill("owner@example.org");
    await mine.press("Enter");
    await until(async () => {
      const { persons } = await rpc<{ persons: Person[] }>("contacts.list");
      return persons.find((p) => p.role === "owner")?.addresses.some((a) => a.channel === id);
    });
    await expect(dialog.getByText("owner@example.org")).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Código" })).toHaveCount(0);

    const never = dialog.getByRole("textbox", { name: "No leer nunca" });
    await never.fill("@spam.example");
    await never.press("Enter");
    await page.getByRole("button", { name: /^Guardar (⌘|Ctrl)/ }).click();
    await until(async () => {
      const { channels } = await rpc<{ channels: Array<{ id: string; email?: { blocked: string[] } }> }>(
        "channels.list",
      );
      return channels.find((c) => c.id === id)?.email?.blocked.includes("@spam.example");
    });

    await dialog.getByRole("button", { name: "Quién responde" }).click();
    await expect(dialog.getByText("Con quién hablás")).toBeVisible();
    await expect(dialog.getByText("Tus mensajes")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Comportamiento" }).click();
    await expect(dialog.getByText("Horario de atención")).toBeVisible();
    await expect(dialog.getByText("Mientras trabaja")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Aprobaciones" }).click();
    await expect(
      dialog.getByText("Queda anotado acá para que lo apruebes; no se le manda ningún correo."),
    ).toBeVisible();
  } finally {
    await rpc("channels.set", { id, channel: null });
  }
});
