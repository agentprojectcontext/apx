// Filling a sign-in field from a stored secret, against a page answered over a fake CDP: the site, the frame and the
// field are checked before the value goes in, and nothing the agent reads afterwards carries it (DECISIONS.md#d-193).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpPage, type CdpSend } from "./cdp.ts";
import { fieldKind, scrubDeep } from "./cdp-fill.ts";

const SECRET = "hunter2-correct-horse";

type Node = {
  backendNodeId: number;
  nodeName: string;
  attributes?: string[];
  frameId?: string;
  children?: Node[];
  contentDocument?: Node;
};

const input = (id: number, ...attributes: string[]): Node => ({ backendNodeId: id, nodeName: "INPUT", attributes });
const form = (...children: Node[]): Node => ({ backendNodeId: 900, nodeName: "FORM", children });

/** A page at `url` whose document is `body`; frames other than the main one sit in `frames` with their origins. */
function fakePage(o: {
  url: string;
  body: Node[];
  frames?: Array<{ id: string; url: string }>;
  leaks?: number;
  /** The field does not take the value (gone, or the page's own setter refuses it). */
  refuses?: boolean;
  /** The document as DOM.getDocument shows it, when it differs (a frame in another process is not in it). */
  dom?: Node[];
}) {
  const typed: string[] = [];
  const shots: Array<{ masked: boolean }> = [];
  let masked = 0;
  const root: Node = { backendNodeId: 1, nodeName: "#document", children: o.body };
  const fields: Node[] = [];
  const collect = (n: Node) => {
    if (n.nodeName === "INPUT") fields.push(n);
    for (const c of n.children ?? []) collect(c);
    if (n.contentDocument) collect(n.contentDocument);
  };
  collect(root);
  const send = (async (method: string, params?: Record<string, unknown>) => {
    switch (method) {
      case "Runtime.releaseObjectGroup":
      case "DOM.scrollIntoViewIfNeeded":
      case "DOM.focus":
      case "Input.dispatchKeyEvent":
        return {};
      case "Runtime.evaluate":
        return { result: { objectId: "doc1" } };
      case "DOM.getDocument":
        return { root: o.dom ? { ...root, children: o.dom } : root };
      case "Accessibility.getFullAXTree":
        return {
          nodes: [
            { nodeId: "r", role: { value: "RootWebArea" }, childIds: fields.map((f) => `a${f.backendNodeId}`) },
            ...fields.map((f) => ({
              nodeId: `a${f.backendNodeId}`,
              parentId: "r",
              role: { value: "textbox" },
              name: { value: `Field ${f.backendNodeId}` },
              // What Chromium reports for a field showing its text: the value itself.
              value: { value: typed.length ? SECRET : "" },
              backendDOMNodeId: f.backendNodeId,
            })),
          ],
        };
      case "Page.getFrameTree":
        return {
          frameTree: {
            frame: { id: "main", url: o.url, securityOrigin: new URL(o.url).origin },
            childFrames: (o.frames ?? []).map((f) => ({
              frame: { id: f.id, url: f.url, securityOrigin: new URL(f.url).origin },
            })),
          },
        };
      case "Page.createIsolatedWorld":
        return { executionContextId: 7 };
      case "DOM.resolveNode":
        return { object: { objectId: `n${params?.backendNodeId}` } };
      case "Input.insertText":
        typed.push(String(params?.text));
        return {};
      case "Runtime.callFunctionOn": {
        const fn = String(params?.functionDeclaration);
        const args = (params?.arguments as Array<{ value: unknown }> | undefined) ?? [];
        if (fn.includes("getOwnPropertyDescriptor")) {
          if (o.refuses) return { result: { value: false } };
          typed.push(String(args[0]?.value));
          return { result: { value: true } };
        }
        if (fn.includes("createTreeWalker")) return { result: { value: o.leaks ?? 0 } };
        if (fn.includes("__apxMask")) {
          masked += args[0]?.value ? 1 : -1;
          return { result: {} };
        }
        return { result: { value: "1" } };
      }
      case "Page.getLayoutMetrics":
        throw new Error("not supported");
      case "Page.captureScreenshot":
        shots.push({ masked: masked > 0 });
        return { data: "AAAA" };
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as CdpSend;
  return { page: new CdpPage(send, { selectAllModifiers: 0 }), typed, shots, masked: () => masked };
}

const LOGIN = [form(input(2, "type", "email", "autocomplete", "username"), input(3, "type", "password"))];
const req = (kind: "password" | "username" | "otp", origins = ["https://app.acme.com"]) => ({
  kind,
  origins,
  value: SECRET,
});

test("a marked site's password field is filled, and nothing the agent reads of the page carries the value", async () => {
  const { page, typed, shots, masked } = fakePage({ url: "https://app.acme.com/login", body: LOGIN });
  await page.snapshot(10_000);
  const r = await page.fillSecret("e2", req("password"));
  assert.deepEqual(r, { outcome: "filled", origin: "https://app.acme.com" });
  assert.ok(!JSON.stringify(r).includes(SECRET));
  assert.deepEqual(typed, [SECRET]);
  const snap = await page.snapshot(10_000);
  assert.ok(!snap.tree.includes(SECRET), snap.tree);
  assert.match(snap.tree, /Field 3" \[e2\] \(filled by APX\)/);
  assert.equal(page.scrub(`welcome ${SECRET}!`), "welcome [secret]!");
  await page.screenshot();
  assert.deepEqual(shots, [{ masked: true }]);
  assert.equal(masked(), 0, "the field shows as before once the picture is taken");
  assert.throws(() => page.evaluate("1", "https://app.acme.com", "doc1"), /secret was filled/);
  await assert.rejects(page.approvalContext("https://app.acme.com", "doc1"), /secret was filled/);
  page.forget(true);
  assert.equal(page.holdsSecret, true, "another address in the same document keeps the field protected");
  page.forget();
  assert.equal(page.holdsSecret, false);
  await page.screenshot();
  assert.deepEqual(shots.at(-1), { masked: false });
  // The next page may carry the value on (a form sent by GET, going back): it stays out of what the agent reads, and
  // no page JavaScript runs in this tab again.
  assert.equal(page.scrub(`https://app.acme.com/?pw=${SECRET}`), "https://app.acme.com/?pw=[secret]");
  assert.throws(() => page.evaluate("1", "https://app.acme.com", "doc1"), /secret was filled in this tab/);
});

test("every string of a tab's answer is scrubbed, nested or not", () => {
  const out = scrubDeep({ url: `/?p=${SECRET}`, tabs: [{ title: SECRET }], n: 1 }, (t) => t.split(SECRET).join("*"));
  assert.deepEqual(out, { url: "/?p=*", tabs: [{ title: "*" }], n: 1 });
});

test("another site, a frame from another site, or a field outside this page is refused before anything is typed", async () => {
  const other = fakePage({ url: "https://acme.example.net/login", body: LOGIN });
  await other.page.snapshot(10_000);
  const r = await other.page.fillSecret("e2", req("password"));
  assert.equal(r.outcome, "refused");
  assert.match(r.reason ?? "", /acme\.example\.net/);

  const framed = fakePage({
    url: "https://app.acme.com/login",
    frames: [{ id: "ads", url: "https://ads.example/frame" }],
    body: [
      {
        backendNodeId: 50,
        nodeName: "IFRAME",
        frameId: "ads",
        contentDocument: { backendNodeId: 51, nodeName: "#document", children: [form(input(52, "type", "password"))] },
      },
    ],
  });
  await framed.page.snapshot(10_000);
  const f = await framed.page.fillSecret("e1", req("password"));
  assert.equal(f.outcome, "refused");
  assert.match(f.reason ?? "", /frame from another site/);

  // A frame in another process is not in this page's document at all.
  const apart = fakePage({ url: "https://app.acme.com/login", body: LOGIN, dom: [] });
  await apart.page.snapshot(10_000);
  const a = await apart.page.fillSecret("e2", req("password"));
  assert.match(a.reason ?? "", /not in this page/);

  for (const p of [other, framed, apart]) assert.deepEqual(p.typed, []);
});

test("only a sign-in field of the secret's kind takes it: never card data, a plain text box or another kind", async () => {
  const body = [
    form(input(2, "type", "text", "name", "search")),
    form(input(3, "autocomplete", "cc-number")),
    form(input(4, "type", "email", "autocomplete", "username"), input(5, "type", "password")),
  ];
  const { page, typed } = fakePage({ url: "https://app.acme.com/", body });
  await page.snapshot(10_000);
  const plain = await page.fillSecret("e1", req("username"));
  assert.match(plain.reason ?? "", /something other than a sign-in value/);
  const card = await page.fillSecret("e2", req("password"));
  assert.match(card.reason ?? "", /card data/);
  const wrong = await page.fillSecret("e3", req("password"));
  assert.match(wrong.reason ?? "", /takes a username, and the secret is for a password/);
  assert.deepEqual(typed, []);
});

test("a page that copies the value elsewhere gets it cleared and is kept from the agent until it is left", async () => {
  const { page } = fakePage({ url: "https://app.acme.com/login", body: LOGIN, leaks: 2 });
  await page.snapshot(10_000);
  const r = await page.fillSecret("e2", req("password"));
  assert.deepEqual(r, {
    outcome: "refused",
    origin: "https://app.acme.com",
    reason: "the page copied the value elsewhere; it was cleared",
    leaked: true,
  });
  await assert.rejects(page.snapshot(10_000), /copied a secret's value/);
  await assert.rejects(page.screenshot(), /copied a secret's value/);
  assert.throws(() => page.assertReadable(), /copied a secret's value/);
  page.forget();
  await page.snapshot(10_000);
});

test("a field that does not take the value is refused and not protected", async () => {
  const { page, typed } = fakePage({ url: "https://app.acme.com/login", body: LOGIN, refuses: true });
  await page.snapshot(10_000);
  const r = await page.fillSecret("e2", req("password"));
  assert.match(r.reason ?? "", /did not take the value/);
  assert.deepEqual(typed, []);
  assert.equal(page.holdsSecret, false);
});

test("every site (*) means https, or http only on this computer", async () => {
  for (const [url, outcome] of [
    ["https://any.example/login", "filled"],
    ["http://127.0.0.1:7601/login", "filled"],
    ["http://intranet.example/login", "refused"],
  ] as const) {
    const { page } = fakePage({ url, body: LOGIN });
    await page.snapshot(10_000);
    assert.equal((await page.fillSecret("e2", req("password", ["*"]))).outcome, outcome, url);
  }
});

test("a field's kind comes from what the page declares", () => {
  const k = (n: Node, beside = false) => fieldKind(n as Parameters<typeof fieldKind>[0], beside);
  assert.equal(k(input(1, "type", "password")), "password");
  assert.equal(k(input(1, "autocomplete", "current-password")), "password");
  assert.equal(k(input(1, "autocomplete", "one-time-code")), "otp");
  assert.equal(k(input(1, "autocomplete", "cc-number")), "card");
  assert.equal(k(input(1, "type", "email")), "username");
  assert.equal(k(input(1, "type", "text")), "other");
  assert.equal(k(input(1, "type", "text"), true), "username");
  assert.equal(k(input(1, "type", "password", "disabled", "")), "other");
  assert.equal(k(input(1, "type", "checkbox"), true), "other");
  assert.equal(k({ backendNodeId: 1, nodeName: "TEXTAREA" }), "other");
});
