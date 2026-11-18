import assert from "node:assert/strict";
import { test } from "node:test";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createAccount } from "./session.ts";

for (const failure of [
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
  "INVALID_REFRESH_TOKEN",
  "INVALID_GRANT",
  "network",
  "quota",
]) {
  test(`refresh failure ${failure} clears only a rejected session`, async () => {
    const dir = tempDir("apx-account-refresh-");
    try {
      const secrets = createSecrets(dir.path, "file", {});
      const session = JSON.stringify({
        uid: "person",
        idToken: "expired",
        refreshToken: "private-refresh",
        expires: 0,
        profile: { id: "0123abcd", name: "Acme", photo: "", handle: "" },
      });
      secrets.set(APX_ACCOUNT_SESSION, session);
      const account = createAccount({
        secrets,
        client: { project: "demo-account", apiKey: "public-key" },
        origin: () => "http://127.0.0.1:7449",
        fetch: async () => {
          if (failure === "network") throw new Error("private-provider-detail");
          return Response.json({ error: { message: failure } }, { status: failure === "quota" ? 429 : 400 });
        },
      });
      const transient = failure === "network" || failure === "quota";
      await assert.rejects(account.rename("acme"), { message: transient ? "account_unavailable" : "sign_in_required" });
      assert.equal(secrets.resolve(`secret://${APX_ACCOUNT_SESSION}`), transient ? session : undefined);
      assert.equal(account.status().profile === null, !transient);
    } finally {
      await dir.remove();
    }
  });
}
