import assert from "node:assert/strict";
import { test } from "node:test";
import { menuText, readMenu, readPick } from "./whatsapp-menus.ts";

test("quick-reply buttons read as a numbered menu, the footer left out", () => {
  const text = menuText({
    buttonsMessage: {
      contentText: "Hi! How can we help?",
      footerText: "Northwind Insurance",
      buttons: [
        { buttonId: "car", buttonText: { displayText: "Car" }, type: 1 },
        { buttonId: "home", buttonText: { displayText: "Home" }, type: 1 },
        { buttonId: "car2", buttonText: { displayText: "car" }, type: 1 },
      ],
    },
  });
  assert.equal(text, "Hi! How can we help?\n[Options: 1. Car | 2. Home]");
});

test("a list keeps its sections on each row, numbered once", () => {
  const menu = readMenu({
    listMessage: {
      title: "My policies",
      description: "Pick one",
      buttonText: "See options",
      sections: [
        { title: "Active", rows: [{ rowId: "p1", title: "Car 2019", description: "ends 12/26" }] },
        { title: "Expired", rows: [{ rowId: "p2", title: "Home" }] },
      ],
    },
  });
  assert.equal(menu?.kind, "list");
  assert.deepEqual(
    menu?.options.map((o) => [o.n, o.id, o.title, o.description]),
    [
      [1, "p1", "Car 2019", "Active — ends 12/26"],
      [2, "p2", "Home", "Expired"],
    ],
  );
});

test("nativeFlow buttons are unpacked out of their JSON strings, a single_select as a whole list", () => {
  assert.equal(
    menuText({
      interactiveMessage: {
        header: { title: "Northwind" },
        body: { text: "What next?" },
        footer: { text: "do not reply to this number" },
        nativeFlowMessage: {
          buttons: [
            { name: "quick_reply", buttonParamsJson: '{"display_text":"Report a claim","id":"claim"}' },
            { name: "cta_url", buttonParamsJson: '{"display_text":"My account","url":"https://example.com/me"}' },
            { name: "broken", buttonParamsJson: "{not json" },
          ],
        },
      },
    }),
    "Northwind\nWhat next?\n[Options: 1. Report a claim | 2. My account]",
  );
  const list = readMenu({
    interactiveMessage: {
      nativeFlowMessage: {
        buttons: [
          {
            name: "single_select",
            buttonParamsJson: JSON.stringify({
              title: "See lines",
              sections: [
                {
                  title: "People",
                  rows: [
                    { id: "life", title: "Life" },
                    { id: "health", title: "Health" },
                  ],
                },
              ],
            }),
          },
        ],
      },
    },
  });
  assert.deepEqual(
    list?.options.map((o) => o.title),
    ["Life", "Health"],
  );
  assert.equal(menuText({ interactiveMessage: { nativeFlowMessage: {} } }), undefined, "an empty menu is nothing");
});

test("templates read through their live spellings; a carousel and a poll are menus too", () => {
  assert.equal(
    menuText({
      templateMessage: {
        hydratedTemplate: {
          hydratedTitleText: "Your appointment",
          hydratedContentText: "Thursday 10:30, confirm?",
          hydratedButtons: [
            { index: 0, quickReplyButton: { displayText: "Yes", id: "yes" } },
            { index: 1, urlButton: { displayText: "Change", url: "https://example.com/c" } },
          ],
        },
      },
    }),
    "Your appointment\nThursday 10:30, confirm?\n[Options: 1. Yes | 2. Change]",
  );
  const four = readMenu({
    templateMessage: {
      fourRowTemplate: {
        content: { text: "Confirm?" },
        buttons: [{ quickReplyButton: { displayText: { text: "Yes" }, id: "yes" } }],
      },
    },
  });
  assert.deepEqual([four?.text, four?.options[0]?.title], ["Confirm?", "Yes"]);
  const card = (t: string) => ({
    nativeFlowMessage: { buttons: [{ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: t }) }] },
  });
  const carousel = readMenu({ interactiveMessage: { carouselMessage: { cards: [card("Basic"), card("Full")] } } });
  assert.deepEqual(
    carousel?.options.map((o) => o.title),
    ["Basic", "Full"],
  );
  assert.equal(
    menuText({
      pollCreationMessageV3: { name: "Which day?", options: [{ optionName: "Mon" }, { optionName: "Tue" }] },
    }),
    "Which day?\n[Options: 1. Mon | 2. Tue]",
  );
});

test("a tap on a menu reads as the choice, with its id", () => {
  assert.equal(
    menuText({ buttonsResponseMessage: { selectedButtonId: "car", selectedDisplayText: "Car" } }),
    "[chose: Car]",
  );
  assert.equal(
    menuText({ templateButtonReplyMessage: { selectedId: "yes", selectedDisplayText: "Yes" } }),
    "[chose: Yes]",
  );
  assert.equal(
    menuText({ listResponseMessage: { title: "Car 2019", singleSelectReply: { selectedRowId: "p1" } } }),
    "[chose: Car 2019]",
  );
  assert.deepEqual(
    readPick({
      interactiveResponseMessage: {
        body: { text: "Report a claim" },
        nativeFlowResponseMessage: { name: "quick_reply", paramsJson: '{"id":"claim"}' },
      },
    }),
    { kind: "interactive", id: "claim", title: "Report a claim" },
  );
  assert.equal(menuText({ conversation: "plain" }), undefined, "plain text is not a menu");
});
