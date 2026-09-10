// Menus, buttons, lists and templates — the shapes that used to read as nothing.
//
// The bug every test in the first block fails against: `textOf` in the dispatch
// read `conversation` and `extendedTextMessage.text` and nothing else, so a
// business account answering with quick-reply buttons produced an empty body,
// the ledger row said "[empty message]", and the owner's Telegram said a bot
// had written them nothing at all.
//
// The payloads below are hand-built from the proto shapes, with invented
// content — no captured traffic, per rule 3.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-inter-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const {
  messageText,
  readInteractive,
  unwrapMessage,
  matchOption,
  replyModeFor,
  lastOfferFor,
} = await import("#core/channels/whatsapp/interactive.js");
const { appendGlobalMessage } = await import("#core/stores/messages.js");
const { CHANNELS } = await import("#core/constants/channels.js");

const BOT = "104900000000000@lid";

// --- the offers -----------------------------------------------------------

test("quick-reply buttons read as a menu, not as an empty message", () => {
  const text = messageText({
    buttonsMessage: {
      contentText: "Hola! En qué te puedo ayudar?",
      footerText: "Northwind Seguros",
      buttons: [
        { buttonId: "auto", buttonText: { displayText: "Autos" }, type: 1 },
        { buttonId: "hogar", buttonText: { displayText: "Hogar" }, type: 1 },
        { buttonId: "vida", buttonText: { displayText: "Vida" }, type: 1 },
      ],
    },
  });
  assert.equal(text, "Hola! En qué te puedo ayudar?\n[Opciones: 1. Autos | 2. Hogar | 3. Vida]");
  assert.ok(!text.includes("Northwind Seguros"), "the footer is boilerplate on every business message");
});

test("a list message keeps its sections and numbers every row once", () => {
  const decoded = readInteractive({
    listMessage: {
      title: "Mis pólizas",
      description: "Elegí una para ver el detalle",
      buttonText: "Ver opciones",
      sections: [
        { title: "Vigentes", rows: [{ rowId: "p1", title: "Auto 2019", description: "vence 12/26" }] },
        { title: "Vencidas", rows: [{ rowId: "p2", title: "Hogar" }] },
      ],
    },
  });
  assert.equal(decoded.kind, "list");
  assert.deepEqual(decoded.options.map((o) => [o.n, o.id, o.title]), [
    [1, "p1", "Auto 2019"],
    [2, "p2", "Hogar"],
  ]);
  assert.equal(decoded.options[0].description, "Vigentes — vence 12/26");
});

test("nativeFlow — the current generation — is unpacked out of its JSON strings", () => {
  const text = messageText({
    interactiveMessage: {
      header: { title: "Northwind" },
      body: { text: "Con qué seguí?" },
      footer: { text: "no respondas a este número" },
      nativeFlowMessage: {
        buttons: [
          { name: "quick_reply", buttonParamsJson: '{"display_text":"Denunciar siniestro","id":"siniestro"}' },
          { name: "cta_url", buttonParamsJson: '{"display_text":"Mi cuenta","url":"https://example.com/mi"}' },
        ],
      },
    },
  });
  assert.equal(
    text,
    "Northwind\nCon qué seguí?\n[Opciones: 1. Denunciar siniestro | 2. Mi cuenta]"
  );
});

test("a nativeFlow single_select is a whole list hiding inside one button", () => {
  const decoded = readInteractive({
    interactiveMessage: {
      body: { text: "Elegí un ramo" },
      nativeFlowMessage: {
        buttons: [
          {
            name: "single_select",
            buttonParamsJson: JSON.stringify({
              title: "Ver ramos",
              sections: [
                { title: "Personas", rows: [{ id: "vida", title: "Vida" }, { id: "salud", title: "Salud" }] },
                { title: "Bienes", rows: [{ id: "auto", title: "Automotor", description: "flota incluida" }] },
              ],
            }),
          },
        ],
      },
    },
  });
  assert.deepEqual(decoded.options.map((o) => o.title), ["Vida", "Salud", "Automotor"]);
  assert.equal(decoded.options[2].description, "Bienes — flota incluida");
});

test("a hydrated template reads through all three spellings that are still live", () => {
  const hydrated = readInteractive({
    templateMessage: {
      hydratedTemplate: {
        hydratedTitleText: "Tu turno",
        hydratedContentText: "Confirmás el jueves 10:30?",
        hydratedFooterText: "Northwind",
        hydratedButtons: [
          { index: 0, quickReplyButton: { displayText: "Sí", id: "si" } },
          { index: 1, quickReplyButton: { displayText: "Cambiar", id: "cambiar" } },
        ],
      },
    },
  });
  assert.equal(hydrated.kind, "template");
  assert.deepEqual(hydrated.options.map((o) => o.title), ["Sí", "Cambiar"]);

  const four = readInteractive({
    templateMessage: {
      fourRowTemplate: {
        content: { text: "Confirmás?" },
        buttons: [{ quickReplyButton: { displayText: { text: "Sí" }, id: "si" } }],
      },
    },
  });
  assert.equal(four.options[0].title, "Sí", "fourRowTemplate nests displayText one level deeper");
});

test("a carousel is flattened — from this side it is still one list of choices", () => {
  const decoded = readInteractive({
    interactiveMessage: {
      body: { text: "Planes" },
      carouselMessage: {
        cards: [
          { nativeFlowMessage: { buttons: [{ name: "quick_reply", buttonParamsJson: '{"display_text":"Básico","id":"b"}' }] } },
          { nativeFlowMessage: { buttons: [{ name: "quick_reply", buttonParamsJson: '{"display_text":"Full","id":"f"}' }] } },
        ],
      },
    },
  });
  assert.deepEqual(decoded.options.map((o) => o.title), ["Básico", "Full"]);
});

test("a poll is a menu too", () => {
  assert.equal(
    messageText({ pollCreationMessageV3: { name: "Qué día?", options: [{ optionName: "Lunes" }, { optionName: "Martes" }] } }),
    "Qué día?\n[Opciones: 1. Lunes | 2. Martes]"
  );
});

// --- the replies ----------------------------------------------------------

test("the tap on a button reads as the choice it was", () => {
  assert.equal(
    messageText({ buttonsResponseMessage: { selectedButtonId: "auto", selectedDisplayText: "Autos" } }),
    "[eligió: Autos]"
  );
  assert.equal(
    messageText({ templateButtonReplyMessage: { selectedId: "si", selectedDisplayText: "Sí", selectedIndex: 0 } }),
    "[eligió: Sí]"
  );
  assert.equal(
    messageText({ listResponseMessage: { title: "Auto 2019", singleSelectReply: { selectedRowId: "p1" } } }),
    "[eligió: Auto 2019]"
  );
  assert.equal(
    messageText({
      interactiveResponseMessage: {
        body: { text: "Denunciar siniestro" },
        nativeFlowResponseMessage: { name: "quick_reply", paramsJson: '{"id":"siniestro"}' },
      },
    }),
    "[eligió: Denunciar siniestro]"
  );
});

test("a selection carries the machine id as well as the label", () => {
  const decoded = readInteractive({
    interactiveResponseMessage: {
      body: { text: "Autos" },
      nativeFlowResponseMessage: { name: "quick_reply", paramsJson: '{"id":"ramo_auto"}' },
    },
  });
  assert.equal(decoded.selection.id, "ramo_auto");
  assert.equal(decoded.options.length, 0, "a reply offers nothing");
});

// --- the wrappers ---------------------------------------------------------

test("containers are peeled — a menu inside viewOnce is still a menu", () => {
  const inner = { buttonsMessage: { contentText: "Hola", buttons: [{ buttonId: "a", buttonText: { displayText: "Sí" } }] } };
  assert.equal(messageText({ viewOnceMessage: { message: inner } }), "Hola\n[Opciones: 1. Sí]");
  assert.equal(messageText({ ephemeralMessage: { message: { viewOnceMessageV2: { message: inner } } } }), "Hola\n[Opciones: 1. Sí]");
  assert.equal(unwrapMessage({ ephemeralMessage: { message: { conversation: "hola" } } }).conversation, "hola");
});

test("plain text still wins, and captions are left to the media reader", () => {
  assert.equal(messageText({ conversation: "hola" }), "hola");
  assert.equal(messageText({ extendedTextMessage: { text: "hola de nuevo" } }), "hola de nuevo");
  // resolveInboundMedia already folds the caption in next to its marker;
  // reading it here too would print every photo's caption twice.
  assert.equal(messageText({ imageMessage: { caption: "mirá esto" } }), "");
});

test("nothing decodable is an empty string, not a throw", () => {
  assert.equal(messageText(undefined), "");
  assert.equal(messageText({}), "");
  assert.equal(messageText({ protocolMessage: { type: 0 } }), "");
  assert.equal(readInteractive({ buttonsMessage: { buttons: [] } }), null, "an empty menu decodes to nothing");
  // Malformed JSON off somebody else's server must not take the channel down.
  assert.doesNotThrow(() =>
    messageText({ interactiveMessage: { body: { text: "hola" }, nativeFlowMessage: { buttons: [{ name: "quick_reply", buttonParamsJson: "{not json" }] } } })
  );
});

// --- answering one --------------------------------------------------------

const MENU = [
  { n: 1, id: "auto", title: "Autos" },
  { n: 2, id: "hogar", title: "Hogar" },
  { n: 3, id: "vida", title: "Seguro de vida" },
];

test("an option is found by number, id, exact title or an unambiguous fragment", () => {
  assert.equal(matchOption(MENU, "2").id, "hogar");
  assert.equal(matchOption(MENU, "vida").id, "vida");
  assert.equal(matchOption(MENU, "AUTOS").id, "auto", "case does not matter");
  assert.equal(matchOption(MENU, "seguro de vida").id, "vida");
  assert.equal(matchOption(MENU, "Autós").id, "auto", "nor do accents");
  assert.equal(matchOption(MENU, "de vida").id, "vida", "one match, so the fragment is enough");
});

test("an ambiguous or absent option matches nothing rather than guessing", () => {
  const seguros = [
    { n: 1, id: "a", title: "Seguro de auto" },
    { n: 2, id: "b", title: "Seguro de hogar" },
  ];
  assert.equal(matchOption(seguros, "seguro"), null, "tapping a button on a guess is not acceptable");
  assert.equal(matchOption(MENU, "9"), null);
  assert.equal(matchOption(MENU, ""), null);
  assert.equal(matchOption([], "1"), null);
});

test("only the generations Baileys can encode a reply for are tapped natively", () => {
  assert.equal(replyModeFor("buttons"), "native");
  assert.equal(replyModeFor("template"), "native");
  assert.equal(replyModeFor("list"), "native");
  // No builder exists for interactiveResponseMessage, so these are answered in
  // words — which is what a person does when the button will not open.
  assert.equal(replyModeFor("interactive"), "text");
  assert.equal(replyModeFor("poll"), "text");
});

test("the last menu in a chat is read back off the ledger, not held in memory", () => {
  appendGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    direction: "in",
    type: "user",
    actor_id: BOT,
    body: "Elegí\n[Opciones: 1. Autos | 2. Hogar]",
    external_id: "WAMSG1",
    meta: { chat_jid: BOT, sender_jid: BOT, interactive_kind: "buttons", interactive_options: MENU.slice(0, 2) },
  });
  // Something said afterwards must not hide the menu — the owner answers these
  // an hour later, from Telegram, after the bot has said something else.
  appendGlobalMessage({
    channel: CHANNELS.WHATSAPP,
    direction: "in",
    type: "user",
    actor_id: BOT,
    body: "seguís ahí?",
    meta: { chat_jid: BOT, sender_jid: BOT },
  });

  const offer = lastOfferFor(BOT);
  assert.equal(offer.kind, "buttons");
  assert.equal(offer.message_id, "WAMSG1");
  assert.deepEqual(offer.options.map((o) => o.title), ["Autos", "Hogar"]);
  assert.equal(lastOfferFor("5491155550000@s.whatsapp.net"), null, "menus do not cross chats");
});
