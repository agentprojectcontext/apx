import assert from "node:assert/strict";
import { test } from "node:test";
import { kitSource, withKit } from "./surface-kit.ts";

test("a widget asking for the kit also gets the answer cards' styles, after the kit's own", () => {
  const page = withKit('<script src="/_apx/kit@1.js"></script><main class="ax-page"></main>');
  const kit = page.indexOf("st.id = 'apx-kit'");
  const cards = page.indexOf("s.id='apx-kit-cards'");
  assert.ok(kit > 0 && cards > kit, "the cards' style is added after the kit's");
  assert.match(page, /\.apx-inline__card,:where\(:root\[data-ax-embed\]\) \.ax-card/);
});

test("the cards' styles ride compact and cannot close the inline script", () => {
  const source = kitSource();
  const cards = source.slice(source.indexOf("s.id='apx-kit-cards'"));
  assert.doesNotMatch(cards, /\/\*/, "no comments");
  assert.doesNotMatch(cards, /</, "no raw angle bracket");
  assert.match(cards, /:root\{--apx-card-pad-y:16px;--apx-card-pad-x:18px;/, "the card measures the phone syncs");
  assert.match(cards, /padding:var\(--apx-card-pad-y\) var\(--apx-card-pad-x\)/);
  assert.match(cards, /@media \(max-width:480px\)\{:root\{--apx-card-pad-y:14px;--apx-card-pad-x:16px;\}/);
});
