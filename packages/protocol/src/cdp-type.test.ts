// Typing that skipped the owner's card because the page is served by this computer: the browser checks the page and
// the field's frame itself, before focusing and again right before the text goes in (DECISIONS.md#d-212).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpPage, type CdpSend, servedHere } from "./cdp.ts";

type Node = { backendNodeId: number; nodeName: string; frameId?: string; children?: Node[]; contentDocument?: Node };

/** A page at `url()` (asked on every frame-tree read, so a test can move it) holding a text field e1 = node 2. */
function fakePage(o: { url: () => string; frame?: { id: string; url: string }; focused?: boolean }) {
  const typed: string[] = [];
  const field: Node = { backendNodeId: 2, nodeName: "INPUT" };
  const body: Node[] = o.frame
    ? [
        {
          backendNodeId: 50,
          nodeName: "IFRAME",
          frameId: o.frame.id,
          contentDocument: { backendNodeId: 51, nodeName: "#document", children: [field] },
        },
      ]
    : [field];
  const root: Node = { backendNodeId: 1, nodeName: "#document", children: body };
  const send = (async (method: string, params?: Record<string, unknown>) => {
    switch (method) {
      case "Runtime.releaseObjectGroup":
      case "DOM.scrollIntoViewIfNeeded":
      case "DOM.focus":
      case "Input.dispatchKeyEvent":
        return {};
      case "Runtime.evaluate":
        return { result: { objectId: "doc1" } };
      case "DOM.describeNode":
        return { node: { nodeName: "INPUT", attributes: ["type", "text"] } };
      case "DOM.getDocument":
        return { root };
      case "Accessibility.getFullAXTree":
        return {
          nodes: [
            { nodeId: "r", role: { value: "RootWebArea" }, childIds: ["f"] },
            { nodeId: "f", parentId: "r", role: { value: "textbox" }, name: { value: "Title" }, backendDOMNodeId: 2 },
          ],
        };
      case "Page.getFrameTree": {
        const url = o.url();
        return {
          frameTree: {
            frame: { id: "main", url, securityOrigin: new URL(url).origin },
            childFrames: o.frame
              ? [{ frame: { id: o.frame.id, url: o.frame.url, securityOrigin: new URL(o.frame.url).origin } }]
              : [],
          },
        };
      }
      case "Page.createIsolatedWorld":
        return { executionContextId: 7 };
      case "DOM.resolveNode":
        return { object: { objectId: `n${params?.backendNodeId}` } };
      case "Runtime.callFunctionOn":
        // Whether the field still has the focus, as the isolated world reads it.
        return { result: { value: o.focused ?? true } };
      case "Page.handleJavaScriptDialog":
        typed.push(String(params?.promptText));
        return {};
      case "Input.insertText":
        typed.push(String(params?.text));
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as CdpSend;
  return { page: new CdpPage(send, { selectAllModifiers: 0 }), typed };
}

const APX = new Set(["7440", "443"]);

test("a page this computer serves takes the text when typing is limited to this computer", async () => {
  const { page, typed } = fakePage({ url: () => "http://127.0.0.1:8127/notes/create" });
  await page.snapshot(10_000);
  await page.type("e1", "Buy milk", false, APX);
  assert.deepEqual(typed, ["Buy milk"]);
});

test("another site, APX itself or a frame from another site gets nothing", async () => {
  for (const url of ["https://example.com/notes/create", "http://localhost:7440/", "file:///tmp/form.html"]) {
    const { page, typed } = fakePage({ url: () => url });
    await page.snapshot(10_000);
    await assert.rejects(page.type("e1", "Buy milk", false, APX), { code: "conflict" }, url);
    assert.deepEqual(typed, [], url);
  }
  const framed = fakePage({
    url: () => "http://localhost:8127/notes/create",
    frame: { id: "ads", url: "https://ads.example/frame" },
  });
  await framed.page.snapshot(10_000);
  await assert.rejects(framed.page.type("e1", "Buy milk", false, APX), /frame from another site/);
  assert.deepEqual(framed.typed, []);
});

test("a page that leaves this computer while the field is focused gets nothing", async () => {
  // The first check sees the local page; focusing the field sends it elsewhere before the text goes in.
  let reads = 0;
  const { page, typed } = fakePage({
    url: () => (reads++ < 1 ? "http://localhost:8127/notes/create" : "https://collector.example.net/"),
  });
  await page.snapshot(10_000);
  await assert.rejects(page.type("e1", "Buy milk", false, APX), /no longer on a page this computer serves/);
  assert.deepEqual(typed, []);
});

test("a field that lost the focus before the text goes in gets nothing", async () => {
  // A frame of another site on the page took the focus: the text would land there.
  const { page, typed } = fakePage({ url: () => "http://localhost:8127/notes/create", focused: false });
  await page.snapshot(10_000);
  await assert.rejects(page.type("e1", "Buy milk", false, APX), /lost the focus/);
  assert.deepEqual(typed, []);
});

test("a prompt box takes the answer only when the page that opened it is served here", async () => {
  for (const [opener, takes] of [
    ["http://localhost:8127/notes", true],
    ["https://collector.example.net/", false],
  ] as const) {
    const { page, typed } = fakePage({ url: () => "http://localhost:8127/notes" });
    page.onEvent("Page.javascriptDialogOpening", { type: "prompt", message: "Name?", defaultPrompt: "", url: opener });
    const answer = page.type("dialog-text", "Northwind", true, APX);
    if (takes) await answer;
    else await assert.rejects(answer, /dialog comes from a page this computer does not serve/);
    assert.deepEqual(typed, takes ? ["Northwind"] : [], opener);
  }
});

test("without the limit a page anywhere takes the text, as when the owner approved it", async () => {
  const { page, typed } = fakePage({ url: () => "https://example.com/notes/create" });
  await page.snapshot(10_000);
  await page.type("e1", "Buy milk", false);
  assert.deepEqual(typed, ["Buy milk"]);
});

test("only loopback http(s) addresses other than APX's own ports count as served here", () => {
  const here = [
    "http://localhost:8127/a",
    "http://127.0.0.1:3000/",
    "http://127.1.2.3:3000/",
    "http://[::1]:5173/",
    "https://app.localhost:3443/",
    "https://localhost:8443/",
    "http://api.app.localhost:8080/",
  ];
  const elsewhere = [
    "http://localhost:7440/",
    "https://localhost/",
    "https://example.com/",
    "http://localhost.example.com/",
    "http://127.0.0.1.nip.io/",
    "http://0.0.0.0:8000/",
    "http://192.168.1.10/",
    "file:///etc/hosts",
    "about:blank",
    "not a url",
  ];
  for (const url of here) assert.equal(servedHere(url, APX), true, url);
  for (const url of elsewhere) assert.equal(servedHere(url, APX), false, url);
});
