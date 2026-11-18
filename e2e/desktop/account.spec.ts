import { type ElectronApplication, expect, test } from "@playwright/test";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import { rpc, until } from "../specs/kit.ts";
import { launchDesktop } from "./app-shell.test-support.ts";

const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;

test("a native account wake-up opens settings without exchanging any credentials", async () => {
  const testInfo = test.info();
  const sandbox = tempDir("apx-account-desktop-");
  let app: ElectronApplication | undefined;
  try {
    app = await launchDesktop(sandbox.path);
    const desktop = app;
    const main = await until(async () =>
      desktop.windows().find((page) => page.url().startsWith(core) && !page.url().includes("quick=1")),
    );
    await expect(
      main.getByRole("textbox", { name: /^Escribile a|^Message/ }).or(main.getByRole("dialog")),
    ).toBeVisible();
    let finishes = 0;
    await main.route("**/rpc/account.finish", async (route) => {
      finishes++;
      await route.abort();
    });
    await app.evaluate(({ app }) => {
      app.emit("open-url", { preventDefault() {} }, "apx://account/callback?code=invalid&state=invalid");
      app.emit("open-url", { preventDefault() {} }, "apx://account/signed-in");
    });
    const account = main.getByRole("region", { name: "Cuenta en la nube" });
    await expect(account).toBeVisible();
    await expect(account.getByRole("button", { name: "Iniciar sesión con Google" })).toBeVisible();
    await expect(account.getByRole("alert")).toHaveCount(0);
    const status = await rpc<{ profile: unknown; pending: boolean }>("account.get");
    expect(status.profile).toBeNull();
    expect(status.pending).toBe(false);
    expect(finishes).toBe(0);
    await main.screenshot({ path: testInfo.outputPath("native-account-wake.png") });
  } finally {
    await app?.close();
    await sandbox.remove();
  }
});
