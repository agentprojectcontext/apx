import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const widget = (connect?: string[]) => ({
  name: "btc-live",
  title: "BTC live",
  html: "<div id=p></div><script>fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')</script>",
  ...(connect ? { connect } : {}),
});
const calls: Record<string, object> = {
  "live widget": widget(["https://api.binance.com", "wss://stream.binance.com:9443"]),
  "same widget": widget(),
  "no network": widget([]),
  "bad origin": widget(["http://api.binance.com/v3"]),
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content)}`);
  const c = calls[said];
  return c ? callTool("w1", "show_widget", c) : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const said = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  await env.settle(thread);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
};

test("a widget reaches only the origins it declares for live data, in the chat and once published", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "widgets" });
  assert.match(await said(t.id, "live widget"), /connecting to https:\/\/api\.binance\.com, wss:\/\/stream/);
  const { surfaces } = await env.client.call("surfaces.list", {});
  const id = surfaces.find((s) => s.name === "btc-live")?.id ?? "";
  assert.deepEqual((await env.client.call("surfaces.get", { surface: id })).connect, [
    "https://api.binance.com",
    "wss://stream.binance.com:9443",
  ]);

  // Published, its page lets those origins through and nothing else.
  const shared = await env.client.call("surfaces.share", { surface: id, shared: true });
  const page = await fetch(new URL(shared.share_path ?? "", env.core.url));
  assert.match(
    page.headers.get("content-security-policy") ?? "",
    /connect-src https:\/\/api\.binance\.com wss:\/\/stream\.binance\.com:9443;/,
  );
  await env.client.call("surfaces.share", { surface: id, shared: false });

  // Updated without connect it keeps them; [] takes them away.
  await said(t.id, "same widget");
  assert.equal((await env.client.call("surfaces.get", { surface: id })).connect?.length, 2);
  await said(t.id, "no network");
  assert.equal((await env.client.call("surfaces.get", { surface: id })).connect, undefined);

  // Only a bare https or wss origin: no plain http, no path.
  assert.match(await said(t.id, "bad origin"), /invalid arguments for show_widget: connect\.0/);
});
