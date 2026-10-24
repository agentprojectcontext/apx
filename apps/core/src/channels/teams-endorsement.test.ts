// The Bot Framework's signing key names the channels it may sign for: an activity that names none is not one of them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { fakeTeams } from "./fake-teams.test-support.ts";
import { teamsAdapter } from "./teams.ts";
import type { AdapterIO } from "./types.ts";

test("an activity without a channel id is refused under a key endorsed for Teams, and nothing is received", async () => {
  const tm = await fakeTeams();
  const dir = tempDir("apx-teams-endorse-").path;
  const adapter = teamsAdapter({ id: "tm", type: "teams" } as never, tm.secret, {
    dir,
    openid: `${tm.base}/openid`,
    login: tm.base,
  });
  const got: string[] = [];
  const ac = new AbortController();
  const io: AdapterIO = { receive: (m) => got.push(m.text), action() {}, status() {}, signal: ac.signal };
  try {
    await adapter.start(io);
    const { channelId: _, ...unnamed } = tm.message("owner", "forged words") as { channelId: string };
    assert.equal((await adapter.webhook?.(tm.request(unnamed)))?.status, 401);
    const other = { ...tm.message("owner", "forged words"), channelId: "webchat" };
    assert.equal((await adapter.webhook?.(tm.request(other)))?.status, 401);
    assert.equal((await adapter.webhook?.(tm.request(tm.message("owner", "real words"))))?.status, 200);
    assert.deepEqual(got, ["real words"]);
  } finally {
    ac.abort();
    await adapter.stop();
    await tm.close();
    await removeDir(dir);
  }
});
