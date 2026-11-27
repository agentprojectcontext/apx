import fs from "node:fs";
import path from "node:path";
import { connectExtension } from "../../apps/web/src/marketplace/connecting.ts";
import type { ExtensionInfo } from "../../packages/protocol/src/extensions.ts";
import { expect, rpc, test, world } from "./kit.ts";

type Enabled = { id: string; enabled: boolean; activation_token?: string };

test("connection activation receipts cannot roll back another attempt or a later owner change", async () => {
  const { dir } = await world.info();
  const root = path.join(dir, "activation-package");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "apx-extension.json"),
    JSON.stringify({ id: "acme-activation", name: "Acme activation", version: "1.0.0" }),
  );
  const seen = await rpc<{ hash: string }>("extensions.inspect", { path: root });
  const added = await rpc<Enabled>("extensions.install", { path: root, hash: seen.hash });
  expect(added.enabled).toBe(false);
  const claim = () => rpc<Enabled>("extensions.enable", { id: added.id, enabled: true, only_if_disabled: true });
  const attempts = await Promise.allSettled([claim(), claim()]);
  const completed = attempts.filter((result) => result.status === "fulfilled");
  expect(completed).toHaveLength(1);
  expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
  const first = completed[0];
  if (first?.status !== "fulfilled") throw new Error("No activation completed");
  expect(first.value.activation_token).toBeTruthy();
  const undo = (token: string | undefined) =>
    rpc<Enabled>("extensions.enable", { id: added.id, enabled: false, rollback_token: token });
  expect((await undo(first.value.activation_token)).enabled).toBe(false);
  const next = await claim();
  await rpc("extensions.enable", { id: added.id, enabled: false });
  await rpc("extensions.enable", { id: added.id, enabled: true });
  expect((await undo(next.activation_token)).enabled).toBe(true);
  const listed = await rpc<{ extensions: Enabled[] }>("extensions.list");
  expect(listed.extensions.find((extension) => extension.id === added.id)?.enabled).toBe(true);
});

test("a real server startup failure rolls back only its first activation and publishes the off state", async () => {
  const { dir } = await world.info();
  const root = path.join(dir, "failing-package");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "apx-extension.json"),
    JSON.stringify({
      id: "acme-failing",
      name: "Acme failing",
      version: "1.0.0",
      mcp: { main: { command: "node", args: ["./server.mjs"] } },
    }),
  );
  fs.writeFileSync(path.join(root, "server.mjs"), 'throw new Error("Cannot start");');
  const seen = await rpc<{ hash: string }>("extensions.inspect", { path: root });
  const added = await rpc<ExtensionInfo>("extensions.install", { path: root, hash: seen.hash });
  const published: boolean[] = [];
  let startupError: string | undefined;
  await expect(
    connectExtension(added, {
      enable: (id, enabled, options) =>
        rpc<ExtensionInfo & { activation_token?: string }>("extensions.enable", { id, enabled, ...options }),
      start: async (servers) => {
        const answer = await rpc<{ error?: string }>("mcp.tools", { scope: "global", server: servers[0] });
        startupError = answer.error;
        if (answer.error) throw new Error(answer.error);
        return [];
      },
      changed: (updated) => {
        published.push(updated.enabled);
      },
    }),
  ).rejects.toThrow();
  const listed = await rpc<{ extensions: Enabled[] }>("extensions.list");
  expect(listed.extensions.find((extension) => extension.id === added.id)?.enabled).toBe(false);
  expect(startupError).toBeTruthy();
  expect(published).toEqual([false]);
});
