import assert from "node:assert/strict";
import { test } from "node:test";
import { browserMethods } from "./browser.ts";
import type { CdpSend } from "./cdp.ts";
import { PageEdits, selectorOf, styleOf } from "./cdp-edit.ts";

type Node = {
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  backendNodeId: number;
  attributes?: string[];
  children?: Node[];
};

/** A page of a few nodes over fake CDP: answers what edit mode asks and keeps the DOM changes it makes. */
function fakePage(nodes: Node[], at: number) {
  const byId = new Map<number, Node>();
  const index = (n: Node) => {
    byId.set(n.backendNodeId, n);
    for (const c of n.children ?? []) index(c);
  };
  for (const n of nodes) index(n);
  const calls: string[] = [];
  const attr = (n: Node, name: string) => {
    const a = n.attributes ?? [];
    const i = a.findIndex((v, k) => k % 2 === 0 && v === name);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const send = (async (method: string, params: Record<string, unknown> = {}) => {
    calls.push(method);
    switch (method) {
      case "Page.getLayoutMetrics":
        return { cssVisualViewport: { clientWidth: 1000, clientHeight: 500 } };
      case "DOM.getDocument":
      case "CSS.enable":
        return {};
      case "DOM.getNodeForLocation":
        return { backendNodeId: at };
      case "DOM.describeNode": {
        const n = byId.get(params.backendNodeId as number);
        if (!n) throw new Error("no node");
        return { node: n };
      }
      case "DOM.pushNodesByBackendIdsToFrontend":
        // The fake's node ids are the backend ids.
        return { nodeIds: (params.backendNodeIds as number[]).filter((id) => byId.has(id)) };
      case "Accessibility.getPartialAXTree":
        return { nodes: [{ role: { value: "button" }, name: { value: "Book a demo" } }] };
      case "DOM.getBoxModel":
        return { model: { border: [100, 50, 300, 50, 300, 100, 100, 100] } };
      case "CSS.getComputedStyleForNode":
        return {
          computedStyle: [
            { name: "color", value: "rgb(255, 255, 255)" },
            { name: "font-size", value: "15px" },
            { name: "padding-top", value: "12.5px" },
          ],
        };
      case "DOM.setAttributeValue": {
        const n = byId.get(params.nodeId as number) as Node;
        const a = (n.attributes ?? []).slice();
        const i = a.findIndex((v, k) => k % 2 === 0 && v === params.name);
        if (i >= 0) a[i + 1] = params.value as string;
        else a.push(params.name as string, params.value as string);
        n.attributes = a;
        return {};
      }
      case "DOM.removeAttribute": {
        const n = byId.get(params.nodeId as number) as Node;
        const a = n.attributes ?? [];
        const i = a.findIndex((v, k) => k % 2 === 0 && v === params.name);
        if (i >= 0) a.splice(i, 2);
        return {};
      }
      case "DOM.setNodeValue":
        (byId.get(params.nodeId as number) as Node).nodeValue = params.value as string;
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as CdpSend;
  return { send, byId, calls, attr };
}

const button = (): Node => ({
  nodeType: 1,
  nodeName: "A",
  localName: "a",
  backendNodeId: 7,
  attributes: ["class", "cta big", "href", "#"],
  children: [{ nodeType: 3, nodeName: "#text", nodeValue: "Book a demo", backendNodeId: 8 }],
});

test("inspect names the element under a point, with its text, place and look", async () => {
  const page = fakePage([button()], 7);
  const el = await new PageEdits(page.send).inspect(0.2, 0.15);
  assert.deepEqual(el, {
    node: 7,
    tag: "a",
    role: "button",
    name: "Book a demo",
    selector: "a.cta.big",
    text: "Book a demo",
    sensitive: false,
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    style: { color: "rgb(255, 255, 255)", background: undefined, font_size: 15, padding: 13 },
  });
  // Edit mode runs no script in the page: only DOM, CSS and accessibility reads.
  assert.ok(!page.calls.some((m) => m.startsWith("Runtime.")));
});

test("inspect never reads a password field and offers nothing over the page body", async () => {
  const field: Node = {
    nodeType: 1,
    nodeName: "INPUT",
    localName: "input",
    backendNodeId: 3,
    attributes: ["type", "password", "id", "pw"],
  };
  const pw = await new PageEdits(fakePage([field], 3).send).inspect(0.5, 0.5);
  assert.equal(pw?.sensitive, true);
  assert.equal(pw?.text, null);
  assert.equal(pw?.name, "");
  assert.equal(pw?.selector, "input#pw");
  const body: Node = { nodeType: 1, nodeName: "BODY", localName: "body", backendNodeId: 1 };
  assert.equal(await new PageEdits(fakePage([body], 1).send).inspect(0.5, 0.5), null);
});

test("shown edits replace the earlier ones and an empty list puts the page back", async () => {
  const page = fakePage([button()], 7);
  const edits = new PageEdits(page.send);
  const a = page.byId.get(7) as Node;
  const text = page.byId.get(8) as Node;
  assert.deepEqual(await edits.show([{ node: 7, text: "Get your demo", style: { color: "#3b6cff", font_size: 17 } }]), {
    shown: 1,
  });
  assert.equal(text.nodeValue, "Get your demo");
  assert.equal(page.attr(a, "style"), "color: #3b6cff !important; font-size: 17px !important");
  // A second set starts from the original page, not from the first edit.
  await edits.show([{ node: 7, style: { padding: 4 } }]);
  assert.equal(text.nodeValue, "Book a demo");
  assert.equal(page.attr(a, "style"), "padding: 4px !important");
  await edits.show([]);
  assert.equal(page.attr(a, "style"), undefined);
  assert.equal(edits.count, 0);
});

test("edits only take values that cannot leave their CSS declaration", () => {
  const params = browserMethods["browser.preview_edits"].params;
  assert.equal(
    params.safeParse({ tab: "t", edits: [{ node: 1, style: { color: "red; background:url(x)" } }] }).success,
    false,
  );
  assert.equal(params.safeParse({ tab: "t", edits: [{ node: 1, style: { font_size: 2000 } }] }).success, false);
  assert.equal(params.safeParse({ tab: "t", edits: [{ node: 1, style: { color: "#abc" } }] }).success, true);
  assert.equal(
    styleOf({ background: "#000000", padding: 0 }),
    "background-color: #000000 !important; padding: 0px !important",
  );
  assert.equal(
    selectorOf(
      "h1",
      new Map([
        ["id", "1bad"],
        ["class", "hero  x:y"],
      ]),
    ),
    "h1.hero",
  );
});
