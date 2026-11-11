// What agents did with JavaScript and the browser now does itself, with APX's own fixed steps: read where a link goes,
// type in a rich text editor, pick an option of a list, attach a file (DECISIONS.md#d-210).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpPage, type CdpSend } from "./cdp.ts";

type Described = { nodeName: string; attributes?: string[] };

/** A page whose accessibility tree is `nodes`, whose DOM nodes are `dom`, and that records what it was sent. */
function fakePage(nodes: object[], dom: Record<number, Described>, chosen = true) {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const send = (async (method: string, params?: Record<string, unknown>) => {
    sent.push({ method, ...(params ? { params } : {}) });
    switch (method) {
      case "Runtime.evaluate":
        return { result: { objectId: "doc1" } };
      case "Accessibility.getFullAXTree":
        return { nodes };
      case "DOM.describeNode":
        return { node: dom[Number(params?.backendNodeId)] ?? { nodeName: "INPUT", attributes: ["type", "text"] } };
      case "DOM.resolveNode":
        return { object: { objectId: `n${params?.backendNodeId}` } };
      case "Runtime.callFunctionOn":
        return { result: { value: chosen } };
      default:
        return {};
    }
  }) as CdpSend;
  return { page: new CdpPage(send, { selectAllModifiers: 4 }), sent };
}

const root = (children: string[]) => ({ nodeId: "r", role: { value: "RootWebArea" }, childIds: children });

test("a link shows where it goes, and a rich text editor is a field with a ref", async () => {
  const { page } = fakePage(
    [
      root(["a", "ed"]),
      {
        nodeId: "a",
        parentId: "r",
        role: { value: "link" },
        name: { value: "Download video" },
        backendDOMNodeId: 3,
        properties: [{ name: "url", value: { value: "https://example.com/v.mp4" } }],
      },
      {
        nodeId: "ed",
        parentId: "r",
        role: { value: "generic" },
        backendDOMNodeId: 4,
        properties: [{ name: "editable", value: { value: "richtext" } }],
        childIds: ["p"],
      },
      {
        nodeId: "p",
        parentId: "ed",
        role: { value: "generic" },
        backendDOMNodeId: 5,
        properties: [{ name: "editable", value: { value: "richtext" } }],
      },
    ],
    {},
  );
  const { tree, refs } = await page.snapshot(10_000);
  assert.match(tree, /- link "Download video" <https:\/\/example\.com\/v\.mp4> \[e1\]/);
  assert.match(tree, /- textbox \[e2\]/);
  assert.equal(refs, 2, "the editor's own inner parts get no ref of their own");
});

const fields = [
  root(["s", "f"]),
  { nodeId: "s", parentId: "r", role: { value: "combobox" }, name: { value: "License" }, backendDOMNodeId: 7 },
  { nodeId: "f", parentId: "r", role: { value: "button" }, name: { value: "Logo" }, backendDOMNodeId: 8 },
];
const dom = { 7: { nodeName: "SELECT" }, 8: { nodeName: "INPUT", attributes: ["type", "file", "accept", "image/*"] } };

test("typing in a list picks the option with that text through APX's own step, not keystrokes", async () => {
  const { page, sent } = fakePage(fields, dom);
  await page.snapshot(10_000);
  await page.type("e1", "MIT License", false);
  const call = sent.find((s) => s.method === "Runtime.callFunctionOn");
  assert.deepEqual(call?.params?.arguments, [{ value: "MIT License" }]);
  assert.match(String(call?.params?.functionDeclaration), /this\.value = o\.value/);
  assert.ok(!sent.some((s) => s.method === "Input.insertText"), "no keystrokes into a list");
});

test("a list without that option says so instead of typing into it", async () => {
  const { page, sent } = fakePage(fields, dom, false);
  await page.snapshot(10_000);
  await assert.rejects(page.type("e1", "Proprietary", false), /no option with that text/);
  assert.ok(!sent.some((s) => s.method === "Input.insertText"));
});

test("a file field attaches a file the core checked, and asks for one otherwise", async () => {
  const { page, sent } = fakePage(fields, dom);
  await page.snapshot(10_000);
  await assert.rejects(page.type("e2", "logo please", false), /this is a file field: type the full path/);
  await page.type("e2", "/work/acme/logo.png", false, undefined, true);
  const attach = sent.find((s) => s.method === "DOM.setFileInputFiles");
  assert.deepEqual(attach?.params, { files: ["/work/acme/logo.png"], backendNodeId: 8 });
});
