import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountProfile } from "@apx/protocol";
import { createAccountProfiles } from "./profile.ts";

test("profile names truncate by code points and remain valid protocol results", async () => {
  const profiles = createAccountProfiles({
    project: "demo-account",
    origin: "https://example.com",
    fetch: async (_url, init) => (init?.method === "POST" ? Response.json({}) : Response.json({}, { status: 404 })),
  });
  const profile = await profiles.ensure("person", "token", `${"a".repeat(99)}😀extra`, "");
  assert.equal(profile.name, "a".repeat(99));
  assert.equal(profile.name.isWellFormed(), true);
  assert.equal(AccountProfile.safeParse(profile).success, true);
});

for (const status of [403, 409, 503]) {
  test(`rename response ${status} reports a conflict only for a conflict`, async () => {
    const profiles = createAccountProfiles({
      project: "demo-account",
      origin: "https://example.com",
      fetch: async (_url, init) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { writes: { delete?: string; currentDocument?: unknown }[] };
          const deletion = body.writes.find((write) => write.delete);
          assert.ok(deletion);
          assert.equal(deletion.currentDocument, undefined);
          return Response.json({}, { status });
        }
        return Response.json({
          fields: Object.fromEntries(
            Object.entries({ id: "0123abcd", name: "Acme", photo: "", handle: "old" }).map(([key, value]) => [
              key,
              { stringValue: value },
            ]),
          ),
          updateTime: "2026-01-01T00:00:00Z",
        });
      },
    });
    await assert.rejects(profiles.rename("person", "token", "new"), {
      message: status === 409 ? "handle_unavailable" : status === 403 ? "account_access_denied" : "account_unavailable",
    });
  });
}
