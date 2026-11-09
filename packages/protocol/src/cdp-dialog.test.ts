import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpPage, type CdpSend, withTimeout } from "./cdp.ts";

type Dialog = { type: string; message: string; defaultPrompt?: string };

/**
 * A page with one button (e1) whose click opens `dialog`. Like Chrome, the click's mouseReleased answers only once the
 * dialog is closed, and nothing that runs in the page answers while it is open.
 */
function page(dialog: Dialog) {
  const sent: Array<{ method: string; params?: object }> = [];
  let open = false;
  let release: (() => void) | undefined;
  let answered = 0;
  const cdp: CdpPage = new CdpPage(
    (async (method: string, params?: object) => {
      sent.push({ method, ...(params ? { params } : {}) });
      if (method === "Page.handleJavaScriptDialog") {
        if (!open) throw new Error("No dialog is showing");
        open = false;
        cdp.onEvent("Page.javascriptDialogClosed", { result: (params as { accept: boolean }).accept });
        release?.();
        return {};
      }
      if (open) return new Promise(() => {});
      if (method === "Runtime.evaluate") return { result: { objectId: "doc1" } };
      if (method === "DOM.getDocument") return { root: { backendNodeId: 1, nodeName: "#document" } };
      if (method === "DOM.getContentQuads") return { quads: [[0, 0, 10, 0, 10, 10, 0, 10]] };
      if (method === "DOM.describeNode") return { node: { nodeName: "BUTTON" } };
      if (method === "Accessibility.getFullAXTree")
        return {
          nodes: [
            { nodeId: "r", role: { value: "RootWebArea" }, childIds: ["b"] },
            { nodeId: "b", parentId: "r", role: { value: "button" }, name: { value: "Delete" }, backendDOMNodeId: 2 },
          ],
        };
      if (method === "Input.dispatchMouseEvent" && (params as { type: string }).type === "mouseReleased") {
        open = true;
        setImmediate(() => cdp.onEvent("Page.javascriptDialogOpening", dialog));
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return {};
    }) as CdpSend,
    {
      selectAllModifiers: 0,
      dialogAnswered: () => {
        answered++;
      },
    },
  );
  /** The owner answers it on screen; its closing event has not reached the page's events yet. */
  const ownerAnswers = () => {
    open = false;
    release?.();
  };
  return { cdp, sent, answered: () => answered, ownerAnswers };
}

test("a click that opens a confirm returns with it instead of waiting, and the agent sees and accepts it", async () => {
  const { cdp, sent, answered } = page({ type: "confirm", message: "Delete Acme for good?" });
  await cdp.snapshot(10_000);
  assert.equal(await withTimeout(cdp.click("e1"), 1_000), "confirm");
  assert.equal(cdp.dialog, "confirm");

  const before = sent.length;
  const snap = await withTimeout(cdp.snapshot(10_000), 1_000);
  // The page behind the dialog runs nothing: the snapshot never asks it.
  assert.deepEqual(
    sent.slice(before).map((s) => s.method),
    [],
  );
  assert.equal(snap.document, "");
  assert.equal(
    snap.tree,
    [
      '- dialog confirm "Delete Acme for good?" (the page waits for an answer)',
      '  - button "OK" [dialog-ok]',
      '  - button "Cancel" [dialog-cancel]',
    ].join("\n"),
  );

  await withTimeout(cdp.click("dialog-ok"), 1_000);
  assert.deepEqual(sent.at(-1), { method: "Page.handleJavaScriptDialog", params: { accept: true } });
  assert.equal(cdp.dialog, undefined);
  assert.equal(answered(), 1);
  assert.match((await cdp.snapshot(10_000)).tree, /button "Delete" \[e1\]/);
});

test("while a dialog is open, page actions are refused at once instead of timing out", async () => {
  const { cdp, sent } = page({ type: "alert", message: "Saved" });
  await cdp.snapshot(10_000);
  await cdp.click("e1");
  const before = sent.length;
  const refused = { name: "ApxError", code: "conflict", message: /an alert dialog/ };
  await assert.rejects(withTimeout(cdp.click("e1"), 1_000), refused);
  await assert.rejects(withTimeout(cdp.type("e1", "x", false), 1_000), refused);
  await assert.rejects(async () => cdp.evaluate("1", "https://acme.example", "doc"), refused);
  await assert.rejects(withTimeout(cdp.screenshot(), 1_000), refused);
  assert.equal(sent.length, before);
  // An alert has only OK.
  assert.doesNotMatch((await cdp.snapshot(10_000)).tree, /dialog-cancel/);
  await cdp.click("dialog-cancel");
  assert.deepEqual(sent.at(-1), { method: "Page.handleJavaScriptDialog", params: { accept: false } });
});

test("a prompt is answered with the text typed into it", async () => {
  const { cdp, sent } = page({ type: "prompt", message: "Name of the copy", defaultPrompt: "Acme" });
  await cdp.snapshot(10_000);
  await cdp.click("e1");
  assert.match((await cdp.snapshot(10_000)).tree, /textbox = "Acme" \[dialog-text\]/);
  await assert.rejects(cdp.type("dialog-ok", "x", false), { code: "bad_request" });
  await cdp.type("dialog-text", "Northwind", false);
  assert.match((await cdp.snapshot(10_000)).tree, /textbox = "Northwind"/);
  await cdp.click("dialog-ok");
  assert.deepEqual(sent.at(-1), {
    method: "Page.handleJavaScriptDialog",
    params: { accept: true, promptText: "Northwind" },
  });
});

test("a dialog someone else answered first is reported as closed, and the page is usable again", async () => {
  const { cdp, sent, answered, ownerAnswers } = page({ type: "beforeunload", message: "" });
  await cdp.snapshot(10_000);
  await cdp.click("e1");
  assert.match(
    (await cdp.snapshot(10_000)).tree,
    /button "Leave" \[dialog-ok\]\n {2}- button "Stay" \[dialog-cancel\]/,
  );
  ownerAnswers();
  await assert.rejects(cdp.click("dialog-ok"), { code: "conflict", message: /already closed/ });
  assert.equal(sent.filter((s) => s.method === "Page.handleJavaScriptDialog").length, 1);
  assert.equal(cdp.dialog, undefined);
  assert.equal(answered(), 0);
  assert.match((await cdp.snapshot(10_000)).tree, /\[e1\]/);
});

test("a closing event from the page clears the dialog", async () => {
  const { cdp } = page({ type: "confirm", message: "Sure?" });
  await cdp.snapshot(10_000);
  await cdp.click("e1");
  cdp.onEvent("Page.javascriptDialogClosed", { result: false });
  assert.equal(cdp.dialog, undefined);
  await assert.rejects(cdp.click("dialog-ok"), { code: "conflict" });
});
