// Which channels a DEVICE wants to see.
//
// The inbox shows every place a conversation can happen — which is what made a
// WhatsApp thread visible at all — and that is also more than anyone wants on a
// phone that already has Telegram installed on it. So the list is filterable
// per device, and the phone starts with Telegram off.
//
// These are source-level assertions because none of it runs in the backend
// suite: the panel is a separate pnpm project and its behaviour is exercised by
// the Playwright specs. What is pinned here is the contract that is easy to
// break from the outside — the filter reading the shared module rather than
// growing a second copy of the rules, and the list never lying about WHY it is
// empty.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webSrc = (...p) =>
  fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

test("the channel list, its labels and the two axes have ONE home", () => {
  const channels = webSrc("lib", "channels.ts");
  assert.match(channels, /export type ChannelAxis = "view" \| "notify";/,
    "seeing a channel and being told about it are different questions");
  assert.match(channels, /view: "apx\.channels\.view"/);
  assert.match(channels, /notify: "apx\.channels\.notify"/);
  assert.match(channels, /export function channelLabel/);

  // The label map used to live inside InboxList, where the phone could not
  // reach it — and the phone is the surface that needs the label most, since it
  // has no channel headings to group under.
  const list = webSrc("components", "inbox", "InboxList.tsx");
  assert.doesNotMatch(list, /const CHANNEL_LABELS/, "one home for the labels");
  assert.match(list, /from "\.\.\/\.\.\/lib\/channels"/);
});

test("both lists filter through the shared predicate, not their own copy", () => {
  for (const [file, where] of [
    [webSrc("components", "inbox", "InboxList.tsx"), "the desktop rail"],
    [webSrc("screens", "mobile", "MobileChatList.tsx"), "the phone"],
  ]) {
    assert.match(file, /channelEnabledIn\(view\.prefs, "view", r\.channel\)/, where);
    assert.match(file, /<ChannelFilter/, `${where} offers the switches`);
  }
});

test("the filter is a picker, not a strip that runs off the edge", () => {
  // It shipped as one chip per channel. A real install has eleven, the inbox
  // rail is 288px and the phone is narrower still, so the row scrolled out of
  // sight and the filters could not be found at all.
  const filter = webSrc("components", "inbox", "ChannelFilter.tsx");
  assert.match(filter, /DropdownMenuCheckboxItem/, "a menu of switches");
  // Base UI leaves a checkbox item's menu OPEN on click, which is what makes
  // this multi-select instead of one-choice-and-it-closes.
  assert.doesNotMatch(filter, /DropdownMenuCheckboxItem[\s\S]{0,300}closeOnClick=\{true\}/);
  // And the trigger says how many are on without being opened.
  assert.match(filter, /t\("channels\.n_of_m", \{ n: on, total: channels\.length \}\)/);
  assert.match(filter, /onSetAll/, "one way back from a list filtered down to nothing");
});

test("a channel switched off keeps the chip that brings it back", () => {
  // Both lists build the chip row from the UNFILTERED rows. Deriving it from
  // what is on screen would delete the switch the moment it was used.
  for (const file of [
    webSrc("components", "inbox", "InboxList.tsx"),
    webSrc("screens", "mobile", "MobileChatList.tsx"),
  ]) {
    assert.match(file, /channelsOf\(rows\)/);
  }
  const chips = webSrc("components", "inbox", "ChannelFilter.tsx");
  assert.match(chips, /aria-pressed=\{on\}/, "a switch, not a link");
  assert.match(chips, /if \(channels\.length < 2\) return null;/, "nothing to choose between");
});

test("an empty list says WHICH kind of empty it is", () => {
  // Three silences that look identical and mean different things: nothing
  // matched the search, every channel is off, or there is genuinely nothing.
  // Saying the wrong one sends someone hunting for a bug that is a filter.
  const list = webSrc("components", "inbox", "InboxList.tsx");
  assert.match(list, /q \? t\("inbox\.no_match"\) : rows\.length \? t\("channels\.all_hidden"\) : t\("inbox\.empty"\)/);
  const phone = webSrc("screens", "mobile", "MobileChatList.tsx");
  assert.match(phone, /rows\.length && !q \? t\("channels\.all_hidden"\) : t\("mobile\.empty"\)/);
});

test("the phone tags every row with its channel; the desktop rail does not repeat its heading", () => {
  const row = webSrc("components", "inbox", "InboxRowItem.tsx");
  assert.match(row, /touch \? <ChannelTag channel=\{row\.channel\} \/> : null/);
  // The raw storage value used to be printed as "· whatsapp". A channel is a
  // label on screen, so it wears its name (AGENTS.md rule 11a).
  assert.doesNotMatch(row, /· \{row\.channel\}/);
  const chips = webSrc("components", "inbox", "ChannelFilter.tsx");
  assert.match(chips, /export function ChannelTag/);
  assert.match(chips, /channelLabel\(channel\)/);
});

test("both locales carry every channel string", () => {
  const en = webSrc("i18n", "en.ts");
  const es = webSrc("i18n", "es.ts");
  for (const key of ["filter", "a2a", "group", "other", "all_hidden", "n_of_m", "select_all"]) {
    assert.match(en, new RegExp(`\\b${key}:`), `en is missing channels.${key}`);
    assert.match(es, new RegExp(`\\b${key}:`), `es is missing channels.${key}`);
  }
});
