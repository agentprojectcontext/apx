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
  //
  // The picker itself is shared now: the inbox carries two of these side by
  // side (channels, and the project a conversation comes from) and they differ
  // only in vocabulary. Written twice they drift apart on the first change to
  // either, so the layout has one home and each filter supplies its words.
  const picker = webSrc("components", "inbox", "OptionFilter.tsx");
  assert.match(picker, /DropdownMenuCheckboxItem/, "a menu of switches");
  // Base UI leaves a checkbox item's menu OPEN on click, which is what makes
  // this multi-select instead of one-choice-and-it-closes.
  assert.doesNotMatch(picker, /DropdownMenuCheckboxItem[\s\S]{0,300}closeOnClick=\{true\}/);
  // And the trigger says how many are on without being opened.
  assert.match(picker, /t\("filters\.n_of_m", \{ n: on, total: options\.length \}\)/);
  assert.match(picker, /onSetAll/, "one way back from a list filtered down to nothing");
  assert.match(picker, /if \(options\.length < 2\) return null;/, "nothing to choose between");

  const filter = webSrc("components", "inbox", "ChannelFilter.tsx");
  assert.match(filter, /<OptionFilter/, "the channel filter is that picker, not a second copy");
  assert.doesNotMatch(filter, /DropdownMenuCheckboxItem/, "one menu, not two");
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

// ── Provenance: WHICH PROJECT a conversation comes from ────────────────────
// The channel says where a conversation happened. On an inbox that spans every
// project at once that leaves the other half unanswered: two projects can both
// have an agent called Zoya, and "Zoya · Web" does not say whose. The list row
// carried the project as bare text and the conversation it opened dropped it
// entirely, so reading a thread meant losing track of who it belonged to.

test("the project of a row, and the default rule, have ONE home", () => {
  const lib = webSrc("lib", "provenance.ts");
  // A super-agent row carries no project at all. It must resolve to the same
  // project the surfaces OPEN it in (`project_id ?? 0`), or the filter and the
  // chat pane disagree about where a row lives.
  assert.match(lib, /export const DEFAULT_PROJECT = "0";/);
  assert.match(lib, /export function projectKeyOf/);
  assert.match(lib, /export function isDefaultProject/);
  assert.match(lib, /view: "apx\.projects\.view"|const KEY = "apx\.projects\.view"/);
  // Only EXPLICIT choices are stored, so a project registered after this was
  // written is shown rather than silently hidden.
  assert.match(lib, /explicit === undefined \? true : explicit/);
});

test("the default workspace is never badged", () => {
  // It is where the super-agent lives and where everything without a project of
  // its own lands. A badge there would mark most of the list to say "the usual
  // place", and a badge that is always on stops being read.
  const tag = webSrc("components", "inbox", "ProjectFilter.tsx");
  assert.match(tag, /if \(isDefaultProject\(projectId\)\) return null;/);
  assert.match(tag, /<OptionFilter/, "the same picker as the channel filter");
});

test("both lists filter by project through the shared predicate", () => {
  for (const [file, where] of [
    [webSrc("components", "inbox", "InboxList.tsx"), "the desktop rail"],
    [webSrc("screens", "mobile", "MobileChatList.tsx"), "the phone"],
  ]) {
    assert.match(file, /projectEnabledIn\(scope\.prefs, r\.project_id\)/, where);
    assert.match(file, /<ProjectFilter/, `${where} offers the switches`);
    // Off the UNFILTERED rows, or a project would lose the switch that brings
    // it back the moment it was used.
    assert.match(file, /projectsOf\(rows\)/, where);
  }
});

test("the row wears provenance and channel as two separate badges", () => {
  const row = webSrc("components", "inbox", "InboxRowItem.tsx");
  assert.match(row, /<ProjectTag projectId=\{row\.project_id\} name=\{row\.project_name\} \/>/);
  assert.match(row, /<ChannelTag channel=\{row\.channel\} \/>/);
  // The project used to be bare text beside the channel's tag, which read as a
  // caption on it rather than a fact of its own.
  assert.doesNotMatch(row, /\{row\.project_name \? <span/);
});

test("the open conversation keeps its project — except inside that project", () => {
  const chat = webSrc("screens", "project", "ChatTab.tsx");
  assert.match(chat, /showProject\?: boolean;/, "a flag, not a second header");
  assert.match(chat, /showProject = false/, "off unless a surface asks for it");
  assert.match(chat, /showProject && \(\s*<ProjectTag/);
  // The name comes from the project list, not from whoever opened the chat: a
  // deep link has no inbox row behind it (see `placeholderRow`), so a prop
  // would be there when you tapped in and missing when you followed a link.
  assert.match(chat, /const \{ project \} = useProject\(pid\);/);

  // The screens that span every project ask for it; the project's own tab does
  // not — there the answer is the screen you are standing on.
  assert.match(webSrc("screens", "InboxScreen.tsx"), /\n\s*showProject\n/);
  assert.match(webSrc("screens", "mobile", "MobileChat.tsx"), /\n\s*showProject\n/);
  const project = webSrc("screens", "ProjectScreen.tsx");
  assert.doesNotMatch(project, /showProject/, "a project's own chat must not repeat it");
});

// ── One row per (agent, CHANNEL) ───────────────────────────────────────────
// The super-agent has a row per channel and they all share a day id, so a key
// without the channel collides three ways. React reuses one DOM node per key:
// rows appeared twice, rows that had been filtered out stayed on screen, and
// turning a channel off read as "the filter did not apply".

test("the phone keys rows by channel too, like the desktop rail", () => {
  const phone = webSrc("screens", "mobile", "MobileChatList.tsx");
  assert.match(phone, /key=\{rowKey\(row\)\}/, "the shared, channel-aware key");
  assert.doesNotMatch(phone, /key=\{`\$\{row\.project_id\}:/, "not a hand-rolled one without the channel");

  const list = webSrc("components", "inbox", "InboxList.tsx");
  assert.match(list, /export function rowKey/);
  assert.match(list, /row\.channel \?\? ""/, "the channel is part of a row's identity");
  // And so is the PERSON. On a channel that talks to several of them every row
  // is the super-agent's on the same channel, so without this Manu, Magui and
  // Carlos shared one key: all three lit up as selected at once, and clicking
  // any of them opened whichever the list happened to find first.
  assert.match(list, /row\.contact_person \?\? ""/, "the person is part of it too");
  // The person, not the conversation id — the id is a day of the ledger and
  // rolls at midnight, which is the move `threadMoved` exists to follow.
  assert.doesNotMatch(
    list.slice(list.indexOf("export function rowKey")),
    /^\s*return `\$\{row\.project_id[^`]*conversation_id/m,
  );
});

test("tapping a row opens THAT thread, not the agent's newest one", () => {
  // /mobile/chat/-/super_agent with no session opens whatever the inbox thinks
  // is latest — so the row labelled WhatsApp opened Telegram.
  const screen = webSrc("screens", "mobile", "MobileScreen.tsx");
  assert.match(screen, /chatPath\(pidOf\(row\), row\.agent_slug, keyFor\(row\)\)/);
});

test("an empty list says WHICH kind of empty it is", () => {
  // Silences that look identical and mean different things: nothing matched the
  // search, every channel is off, every PROJECT is off, or there is genuinely
  // nothing. Saying the wrong one sends someone hunting for a bug that is a
  // filter — and with two filters there are two ways to be wrong.
  for (const [file, where] of [
    [webSrc("components", "inbox", "InboxList.tsx"), "the desktop rail"],
    [webSrc("screens", "mobile", "MobileChatList.tsx"), "the phone"],
  ]) {
    assert.match(file, /!channels\.some\(view\.enabled\)\s*\?\s*t\("channels\.all_hidden"\)/, where);
    assert.match(
      file,
      /!projects\.some\(\(p\) => scope\.enabled\(p\.id\)\)\s*\?\s*t\("provenance\.all_hidden"\)/,
      where,
    );
  }
  assert.match(webSrc("components", "inbox", "InboxList.tsx"), /t\("inbox\.empty"\)/);
  assert.match(webSrc("screens", "mobile", "MobileChatList.tsx"), /t\("mobile\.empty"\)/);
});

test("every row carries its channel, on both surfaces, and nothing groups by it", () => {
  const row = webSrc("components", "inbox", "InboxRowItem.tsx");
  // Unconditional. It used to be phone-only, because the desktop rail grouped
  // under sticky channel headings — and that grouping was the enemy of the
  // sort: an inbox answers "what happened last", and channel buckets meant the
  // newest thing on screen depended on which bucket it fell into. Both lists
  // are now flat and sorted by recency, so the row is the only thing left
  // telling a WhatsApp from a contact apart from a web chat with the same agent.
  assert.match(row, /<ChannelTag channel=\{row\.channel\} \/>/);
  assert.doesNotMatch(row, /touch \? <ChannelTag/);
  // The raw storage value used to be printed as "· whatsapp". A channel is a
  // label on screen, so it wears its name (AGENTS.md rule 11a).
  assert.doesNotMatch(row, /· \{row\.channel\}/);

  const list = webSrc("components", "inbox", "InboxList.tsx");
  assert.doesNotMatch(list, /inbox-group-/, "the desktop rail must not group by channel");

  const chips = webSrc("components", "inbox", "ChannelFilter.tsx");
  assert.match(chips, /export function ChannelTag/);
  assert.match(chips, /channelLabel\(channel\)/);
});

test("both locales carry every filter string, in the block that owns it", () => {
  // Pinned per BLOCK rather than per bare key: the words the two pickers share
  // ("All", "3 of 11") moved to `filters` when the menu became one component,
  // and a file-wide grep for `n_of_m:` would have gone on passing while
  // `channels.n_of_m` no longer existed.
  const blocks = { channels: ["filter", "a2a", "group", "other", "all_hidden"],
    provenance: ["filter", "from", "all_hidden"],
    filters: ["all", "n_of_m", "select_all", "none"] };
  for (const locale of ["en", "es"]) {
    const src = webSrc("i18n", `${locale}.ts`);
    for (const [block, keys] of Object.entries(blocks)) {
      const body = src.slice(src.indexOf(`\n  ${block}: {`));
      const inner = body.slice(0, body.indexOf("\n  },"));
      assert.ok(inner.length, `${locale} is missing the ${block} block`);
      for (const key of keys) {
        assert.match(inner, new RegExp(`\\b${key}:`), `${locale} is missing ${block}.${key}`);
      }
    }
  }
});
