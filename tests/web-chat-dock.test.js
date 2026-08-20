// The chat dock: the strip, the field and the thread as one surface.
//
// The composer used to be a slice of the column — a context bar on its own
// line, a border, then the field — which on a 390px phone is three separate
// floating things and two rows of prose nobody reads mid-conversation. It is
// now one card hovering over the thread. These are source contracts, like the
// rest of the web tests: the pieces that regress silently (the inset that keeps
// the last line readable, the avatar that only the phone drops, the word a
// pending turn says) stay pinned.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

test("the collapsed context strip is glyphs and numbers, never prose", () => {
  const bar = web("components", "chat", "ContextBar.tsx");
  // The summary row: an icon and a count each, and no unit words. "1500.8k tok
  // (1483.1k↑ / 17.7k↓)" wrapped the row onto a second line on a phone.
  assert.match(bar, /<Gauge size=\{12\} \/> \{fmt\(totalTok\)\}/, "tokens are the gauge and the number");
  assert.match(bar, /<Wrench size=\{12\} \/> \{toolCount\}/);
  assert.match(bar, /<Bot size=\{12\} \/> \{actors\.length\}/, "agents are counted, not named, until you ask");
  const summary = bar.slice(bar.indexOf("aria-expanded={open}"), bar.indexOf("</button>"));
  assert.doesNotMatch(summary, /↑/, "the in/out split belongs to the expanded panel");
  assert.doesNotMatch(summary, /a\.model/, "so does the model's name");

  // And every word of it survives one tap away.
  assert.match(bar, /t\("chat_ui\.ctx_tokens"\)/);
  assert.match(bar, /t\("chat_ui\.ctx_tools"\)/);
  assert.match(bar, /\{fmt\(inTok\)\}↑ \/ \{fmt\(outTok\)\}↓/);
});

test("the strip is the field's top edge, and opens away from the thumb", () => {
  const bar = web("components", "chat", "ContextBar.tsx");
  const input = web("components", "ui", "chat-input.tsx");
  const composer = web("components", "chat", "Composer.tsx");
  const tab = web("screens", "project", "ChatTab.tsx");

  // Docked, it cancels the card's own padding so there is no seam between the
  // two — that gap was the thing that read as "two floating blocks".
  assert.match(bar, /"-mx-2 -mt-2 overflow-hidden rounded-t-\[calc\(1rem-1px\)\] border-b border-border\/70 bg-muted\/40"/,
    "the docked strip is full-bleed inside the card");
  assert.match(input, /\{header\}\s*\n\s*\{above\}/, "the header sits inside the card, above the attachments");
  assert.match(composer, /header=\{context\}/);
  assert.match(tab, /<ContextBar msgs=\{msgs\} docked onOpenChange=\{setCtxOpen\} \/>/);
  // The questions ride in the same slot, right under the strip: the thing you
  // have to answer belongs in the box you would answer with.
  assert.match(tab, /<InlineAskPanel\s*\n\s*docked/);

  // The dock is pinned to the bottom of the screen, so the detail grows UP —
  // from INSIDE the card. See the covers-instead-of-shoves test for why it is
  // not a floating sheet of its own.
  assert.match(bar, /\{docked && open && detail\}/);
  assert.match(bar, /docked !== open && "rotate-180"/, "the chevron points where the panel will appear");
});

test("the field floats over the thread, and the thread keeps its last line", () => {
  const tab = web("screens", "project", "ChatTab.tsx");
  const list = web("components", "chat", "MessageList.tsx");
  const composer = web("components", "chat", "Composer.tsx");

  assert.match(tab, /<div ref=\{dockRef\} className="absolute inset-x-0 bottom-0">/);
  assert.match(composer, /floating \? "pt-5"/, "floating, the bar drops its opaque backing");
  // No backdrop-filter in that band: it read well over the message text and
  // smeared everything else living there — the scrollbar became a grey smudge.
  assert.doesNotMatch(composer, /backdrop-blur/, "the band above the card is plain glass");

  // The inset is the dock's LIVE height. A guess goes stale the moment a draft
  // wraps to a second line or the context panel opens.
  assert.match(tab, /new ResizeObserver\(\(\[entry\]\) => setDockH\(entry\.contentRect\.height\)\)/);
  assert.match(tab, /bottomInset=\{bottomInset\}/);
  assert.match(list, /style=\{bottomInset \? \{ height: bottomInset \} : undefined\}/);

  // A callback ref, not a mount effect: ChatTab renders <Loading/> until the
  // agent list arrives, so an effect keyed on [] looks for a dock that does not
  // exist yet, finds null, and never runs again — inset 0, field parked on top
  // of the last three lines.
  assert.match(tab, /const dockRef = useCallback\(\(el: HTMLDivElement \| null\) =>/);
  assert.doesNotMatch(tab, /const dockRef = useRef<HTMLDivElement/);

  // Growing the inset carries a reader who was AT the bottom back down, and
  // leaves one who scrolled up to re-read something where they were.
  assert.match(list, /scroller\.scrollHeight - scroller\.scrollTop - scroller\.clientHeight < AT_BOTTOM_SLACK/);
  assert.match(list, /if \(pinned\.current\) el\.scrollIntoView\(\{ block: "end" \}\)/);
});

test("only the phone drops the avatar off every bubble", () => {
  const bubble = web("components", "chat", "MessageBubble.tsx");
  const list = web("components", "chat", "MessageList.tsx");
  const tab = web("screens", "project", "ChatTab.tsx");
  const phone = web("screens", "mobile", "MobileChat.tsx");

  assert.match(bubble, /\{!mine && !compact && \(face \?/, "compact turns draw no face");
  assert.match(bubble, /compact \? "max-w-\[92%\]" : "max-w-\[85%\]"/, "and the bubble takes the width back");

  // The whole chain is explicit, not a viewport guess: the desktop pane can be
  // narrow too, and there the cast IS worth naming per turn.
  assert.match(list, /compact=\{compact\}/);
  assert.match(tab, /compact=\{compact\}/);
  assert.match(phone, /bare\s*\n\s*compact/, "the phone surface is the only caller that sets it");
});

test("a turn being written says so, in the reader's language", () => {
  const bubble = web("components", "chat", "MessageBubble.tsx");
  const es = web("i18n", "es.ts");
  const en = web("i18n", "en.ts");

  // A bare "…" is the same glyph the app uses for truncation everywhere else,
  // so a turn being written read as one that had been cut off.
  assert.match(bubble, /flex w-fit items-center gap-1\.5 self-start/, "the status hugs its words");
  assert.match(es, /typing:\s+"escribiendo"/);
  assert.match(en, /typing:\s+"typing"/);

  // And it stays for the WHOLE turn, not just until the first part lands. A
  // turn that has been running shell commands for two minutes otherwise shows a
  // list of finished steps and nothing saying more is coming.
  assert.match(bubble, /!mine && msg\.pending && \(\s*\n\s*<Typing/, "pending is the only condition");
  assert.match(
    bubble,
    /msg\.parts\.length === 0 \? t\("chat_ui\.typing"\) : t\("chat_ui\.working"\)/,
    "writing and working are different words",
  );
  assert.match(es, /working:\s+"trabajando"/);
  assert.match(en, /working:\s+"working"/);
});

test("theme and language are reachable from the screen the phone lands on", () => {
  const prefs = web("components", "settings", "PanelPrefs.tsx");
  const inbox = web("screens", "mobile", "MobileChatList.tsx");
  const panel = web("components", "settings", "WebPanel.tsx");

  assert.match(inbox, /<PrefsDialog open=\{prefsOpen\} onClose=\{\(\) => setPrefsOpen\(false\)\} \/>/);
  assert.match(prefs, /export function ThemeButtons/);
  assert.match(prefs, /export function LanguageButtons/);
  assert.match(prefs, /window\.location\.reload\(\)/, "a locale swap reloads: every string resolved at render");

  // One implementation, two frames around it. Two copies is how the phone ends
  // up offering a theme the desktop panel has since renamed.
  //
  // Matched per control rather than as one literal import list: the shared set
  // grows (NotificationSwitch joined it), and pinning the list made adding a
  // control to BOTH frames — the very thing this test asks for — fail the test.
  assert.match(panel, /import \{[^}]*\bThemeButtons\b[^}]*\} from "\.\/PanelPrefs"/);
  assert.match(panel, /import \{[^}]*\bLanguageButtons\b[^}]*\} from "\.\/PanelPrefs"/);
  assert.doesNotMatch(panel, /useTheme|setLocale/, "the settings screen owns no copy of the controls");
});

test("when and what it cost sit beside who answered, not under it", () => {
  const bubble = web("components", "chat", "MessageBubble.tsx");

  // One row: agent and model on the left, the meta pushed to the far side.
  assert.match(bubble, /"flex w-full items-center gap-x-2 gap-y-1 text-\[10px\]"/);
  assert.match(bubble, /"ml-auto flex shrink-0 items-center gap-2 text-muted-foreground"/);

  // And on a phone it may NOT wrap, or the meta lands back under the bubble
  // where it started — "zen:deepseek-v4-flash-free" alone fills 390px. The
  // model is the field that gives up the room; it is spelled out in full in
  // the context panel either way.
  assert.match(bubble, /compact \? "flex-nowrap" : "flex-wrap"/);
  assert.match(bubble, /min-w-0 truncate rounded bg-surface-soft\/50/, "the model truncates, the meta does not");

  // Nothing at all while the turn is still running: a lone timestamp under
  // "escribiendo…" is a receipt for a message that has not arrived.
  assert.match(bubble, /\{!\(!mine && msg\.pending\) && <div/);

  // A phone has no hover, so hover-gating the row there hid it forever.
  // Hover-gated only where a pointer exists. Other conditions may join the
  // guard; `!compact` leading it is the part that must not go.
  assert.match(
    bubble,
    /!compact &&[^\n]*"opacity-0 transition-opacity group-hover:opacity-100"/,
    "always on where there is no pointer",
  );
  // Seven raw digits are what pushed that row onto a second line at 390px.
  assert.match(bubble, /fmtTok\(\(msg\.usage\.input_tokens \|\| 0\) \+ \(msg\.usage\.output_tokens \|\| 0\)\)/);
  assert.match(bubble, /n >= 1_000_000\) return `\$\{\(n \/ 1_000_000\)\.toFixed\(1\)\}M`/);
  assert.match(bubble, /\.\.\.\(compact \? \{\} : \{ second: "2-digit" \}\)/, "seconds are a desktop luxury");
});

test("one set of chat actions, dressed for the room it is in", () => {
  const tab = web("screens", "project", "ChatTab.tsx");

  // Described once, rendered twice. Two lists would be two lists to forget to
  // update — which is how the phone ended up with none of them.
  assert.match(tab, /const menuActions = \[/);
  assert.match(tab, /onClick: \(\) => setConfirmNew\(true\)/, "new session confirms");
  assert.match(tab, /onClick: \(\) => setConfirmDelete\(true\)/, "delete confirms");
  assert.match(tab, /open=\{confirmNew\}/);
  assert.match(tab, /t\("project\.chat\.new_session_confirm_title"\)/);

  // Width no longer decides the header's shape: the labels used to appear above
  // `lg`, so how much room the agent's name had depended on the window.
  assert.doesNotMatch(tab, /hidden lg:inline/);
  // The one that only navigates says so in words. Everything that EDITS the
  // session folds behind one ⋯ — with the session it acts on named at the top,
  // the way the project's right-click menu does, or the menu is four verbs with
  // no subject.
  assert.match(tab, /\{t\("inbox\.open_in_project"\)\} <ArrowUpRight/);
  assert.match(tab, /<MoreVertical size=\{compact \? 20 : 16\} \/>/);
  assert.match(tab, /<DropdownMenuLabel[\s\S]{0,140}\{convLabel \|\| t\("mobile\.live_session"\)\}/);
  // Destroying is below a line, on its own: it is the one that cannot be undone.
  assert.match(tab, /<DropdownMenuSeparator \/>[\s\S]{0,200}deleteAction\.onClick/);
});

test("a session can be named, and put away without being destroyed", () => {
  const tab = web("screens", "project", "ChatTab.tsx");
  const picker = web("components", "chat", "SessionPicker.tsx");
  const api = web("lib", "api", "conversations.ts");

  // Both kinds of session, one menu: an agent's `.md` carries the name in its
  // own frontmatter, a channel thread has no file of its own so it goes to the
  // index beside the ledger. The client does not care which.
  assert.match(api, /update: \(pid: string, slug: string, id: string, patch: \{ title\?: string; archived\?: boolean \}\)/);
  assert.match(api, /updateThread: \(pid: string, channel: string, id: string/);
  assert.match(tab, /const doRename = async \(title: string\)/);
  assert.match(tab, /const doArchive = async \(archived: boolean\)/);

  // Archiving is the smaller decision, so it does not ask — but it does take
  // this thread out of the list you are reading it from, so it lands you on the
  // neighbour rather than on a thread that is no longer offered.
  assert.match(tab, /if \(archived\) await openNeighbour\(\);/);
  // …and the way back is the picker, which is the one list that asks for them.
  assert.match(picker, /Conversations\.threads\(pid, true\)/);
  assert.match(picker, /Conversations\.list\(pid, agentSlug, true\)/);
  assert.match(picker, /t\("project\.chat\.archived_group"\)/);
});

test("which thread you are in is also the way to the others", () => {
  const picker = web("components", "chat", "SessionPicker.tsx");
  const tab = web("screens", "project", "ChatTab.tsx");
  const phone = web("screens", "mobile", "MobileChat.tsx");

  // One header for both surfaces. The phone used to draw a second one beside
  // ChatTab's, which is how it ended up with a session switcher the desktop did
  // not have and none of the actions the desktop did.
  assert.match(tab, /<SessionPicker/);
  assert.doesNotMatch(phone, /<header/, "the phone screen draws no header of its own");
  assert.match(phone, /onBack=\{onBack\}/);

  // The list is fetched when someone reaches for it, not on every chat opened.
  assert.match(picker, /useSessionRows\(pid, agentSlug, isSuper, armed\)/);
  assert.match(picker, /onPointerEnter=\{\(\) => setArmed\(true\)\}/);

  // The phone's session lives in the PATH, so picking one has to navigate —
  // ChatTab's own `?conv=` would not be read back on reload.
  assert.match(tab, /if \(onSelectionChange\) \{\s*\n\s*onSelectionChange\(key\);\s*\n\s*return;/);
  assert.match(phone, /onSelectionChange=\{onPickSession\}/);
});

test("the questions reach you, and they reach you where you answer", () => {
  const panel = web("components", "chat", "InlineAskPanel.tsx");
  const list = web("components", "chat", "MessageList.tsx");
  const bubble = web("components", "chat", "MessageBubble.tsx");
  const tab = web("screens", "project", "ChatTab.tsx");

  // "Unanswered", not "in the very last message". The agent routinely says a
  // line alongside its questions, and that trailing turn hid the panel for
  // good — the questions then rendered as already received, with nothing to
  // pick from.
  assert.match(panel, /export function pendingAskIndex/);
  assert.match(panel, /if \(m\.role === "user"\) return -1;/);
  assert.match(panel, /p\.kind === "tool" && p\.tool === "ask_questions"\)\) return i;/);
  assert.doesNotMatch(panel, /const last = msgs\[msgs\.length - 1\];/);

  // A turn cannot tell on its own whether it was answered; the list can.
  assert.match(list, /const askAt = pendingAskIndex\(msgs\)/);
  assert.match(list, /askPending=\{i === askAt\}/);
  assert.match(bubble, /pending=\{!!askPending\}/);
  assert.doesNotMatch(bubble, /isLast/, "the last message is not the question that is open");

  // And it is rendered inside the composer card, under the token strip.
  assert.match(tab, /<InlineAskPanel\s*\n\s*docked/);
  assert.match(panel, /\? "-mx-2 border-b border-border\/70 bg-card"/);
});

test("nothing we invented is sent to the model", () => {
  const panel = web("components", "chat", "InlineAskPanel.tsx");
  const card = web("components", "chat", "AskAnswersCard.tsx");

  // compileAnswers becomes a USER MESSAGE. Every word invented here is a word
  // in whatever language this panel happens to be in, wrapped around questions
  // the agent may have asked in another — "(omitido)", "(sin respuesta)" and
  // "(Otro: …)" were Spanish scaffolding handed to a French conversation.
  const compiled = panel
    .slice(panel.indexOf("function compileAnswers"), panel.indexOf("export { NO_ANSWER }"))
    .replace(/^\s*\/\/.*$/gm, "");   // the prose explaining it is not the payload
  // Every literal that ends up in the message is punctuation — separators and
  // escapes. A word here would be a word in ONE language, glued to questions
  // the agent may have asked in another.
  const literals = [...compiled.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
    .map((m) => (m[1] ?? m[2] ?? "").replace(/\\./g, "").replace(/\$\{[^}]*\}/g, ""));
  assert.deepEqual(
    literals.filter((l) => /[a-zA-Z]/.test(l)),
    [],
    "no literal word is written into the message",
  );
  assert.match(panel, /const NO_ANSWER = "—";/);
  assert.match(panel, /if \(text\) parts\.push\(text\);/, "free text goes in as itself");
  // And the card reads back the same token rather than its own copy of it.
  assert.match(card, /current\.skipped = a === NO_ANSWER;/);
});

test("deleting a chat lands you on the one next to it", () => {
  const tab = web("screens", "project", "ChatTab.tsx");

  // "Deleted" answered with an empty new session is the app telling you that
  // you are now nowhere. Land on the most recent thread still standing.
  assert.match(tab, /await openNeighbour\(\)/);
  assert.match(tab, /const rest = \(await Conversations\.list\(pid, slug\)\)\.filter\(\(c\) => c\.id !== gone\)/);
  assert.match(tab, /if \(next\) return selectChat\(\{ kind: "conv"/);
  assert.match(tab, /if \(next\) return selectChat\(\{ kind: "thread"/);
  // Empty list, or a list we cannot fetch, still has to leave you somewhere.
  assert.match(tab, /\n    newSession\(\);\n  \};/, "a fresh session is the floor, not the default");
});

test("the inbox moving does not remount the chat you are inside", () => {
  const phone = web("screens", "mobile", "MobileChat.tsx");
  const attachment = web("components", "chat", "Attachment.tsx");

  // With no `:session` in the URL the selection falls back to the row's own
  // default — the INBOX's idea of this agent's latest thread. The inbox polls
  // every 15s and revalidates on any message anywhere, so recomputing that on
  // every render meant an answer arriving on another channel flipped
  // `row.channel`, changed the key on <ChatTab>, and remounted the whole chat:
  // the thread swapped for one you never opened, the draft went, and a voice
  // note playing at that moment could no longer be stopped.
  assert.match(phone, /const selection = useResolvedSelection\(sessionParamValue, row\)/);
  assert.doesNotMatch(
    phone,
    /const selection = selectionFromParam\(/,
    "resolved once per URL, not once per render",
  );
  // Keyed on the chat's identity too: React reuses this instance across agents,
  // and a cache keyed on the (absent) session alone would hand the next chat
  // the previous one's thread.
  assert.match(phone, /const id = `\$\{row\.project_id \?\? ""\}\/\$\{row\.agent_slug\}\/\$\{param \?\? ""\}`/);

  // Seatbelt for the remounts that are legitimate (switching sessions, leaving
  // the chat): a detached <audio> goes on playing in Chrome with no control on
  // screen wired to it.
  assert.match(attachment, /const el = ref\.current;\s*\n\s*return \(\) => el\?\.pause\(\);/);
  assert.match(attachment, /<audio ref=\{ref\} src=\{url\} controls/);
});

test("leaving the end is a decision, and there is a way back from it", () => {
  const list = web("components", "chat", "MessageList.tsx");
  const tab = web("screens", "project", "ChatTab.tsx");

  // An arriving turn used to scroll everyone to the bottom, full stop: you went
  // up to re-read something, one more word landed, and you were thrown back
  // mid-sentence. Now it follows only a reader who was already following it.
  assert.match(list, /if \(!pinned\.current\) return;\s*\n\s*bottomRef\.current\?\.scrollIntoView\(\{ behavior: "smooth"/);
  // …except the very first time, which is not a preference to infer from a
  // scroll position that does not exist yet: a thread opens at its latest.
  assert.match(list, /if \(!landed\.current\) \{/);
  // And the mount measurement is deliberately absent — at mount the honest
  // answer is "miles from the bottom", which would have cancelled that landing.
  assert.doesNotMatch(list, /\n\s*measure\(\);\n/);

  // The host is told, and told the FIRST time too: comparing only against the
  // live value swallowed the initial report whenever it agreed with the guess,
  // leaving a host showing "you are away" for a list sitting at the end.
  assert.match(list, /if \(at === reported\.current\) return;/);

  // The way back: over the field, not part of it — inside the dock it would
  // grow the space the thread reserves and the conversation would jump every
  // time this appeared.
  assert.match(tab, /\{!atBottom && msgs\.length > 0 && \(/);
  assert.match(tab, /style=\{\{ bottom: dockH \+ 8 \}\}/);
  assert.match(tab, /el\.scrollTo\(\{ top: el\.scrollHeight, behavior: "smooth" \}\)/);
  // Nothing scrolls on its own any more, so the count is the only way to know
  // something arrived while you were reading further up.
  assert.match(tab, /setMissed\(Math\.max\(0, msgs\.length - seenCount\.current\)\)/);
});

test("the context detail covers the thread instead of shoving it", () => {
  const bar = web("components", "chat", "ContextBar.tsx");
  const tab = web("screens", "project", "ChatTab.tsx");

  // Back INSIDE the card. Floating it as its own sheet lined the edges up
  // perfectly and still read as a second box glued on top — a panel that
  // belongs to the field has to live inside the field's border.
  assert.match(bar, /\{docked && open && detail\}/);
  assert.doesNotMatch(bar, /absolute -left-px -right-px bottom-/);

  // What it must not do is move the conversation, so the host freezes the space
  // the thread reserves while it is open.
  assert.match(tab, /const bottomInset = ctxOpen \? restingDock\.current : dockH;/);
  assert.match(bar, /onOpenChange\?\.\(next\);/);
  // Told OUTSIDE the updater: a state updater runs during render, and calling
  // the host's setState from in there is React updating one component while
  // rendering another — it refuses mid-render and takes the rest of the commit
  // with it, which is what left the dock measuring zero.
  assert.doesNotMatch(bar, /setOpen\(\(v\) => \{[\s\S]{0,80}onOpenChange/);
});

test("the header leads with the session, and says who under it", () => {
  const tab = web("screens", "project", "ChatTab.tsx");
  const chat = web("hooks", "useChat.ts");

  // Name on top — and it is the picker, since the session is the thing you
  // switch. The header used to lead with the agent (whose face is already
  // sitting right there) and put a bare DATE where the name should be.
  assert.match(tab, /label=\{convLabel \|\| t\("mobile\.live_session"\)\}/);
  assert.doesNotMatch(tab, /const headerSubtitle/, "no more one-string subtitle");
  // Who · where · when, one line, truncated as a whole so a long agent name
  // cannot push the channel and the date onto a second row.
  assert.match(tab, /<span className="truncate">\{agentLabel\}<\/span>/);
  assert.match(tab, /<span className="shrink-0">· \{shownChannel\}<\/span>/);
  assert.match(tab, /createdIso && <span className="shrink-0">· \{formatDate\(createdIso\)\}/);

  // The loaded session's OWN name wins: the list row is only what happened to
  // be carried in from wherever you clicked, and a deep link carries nothing —
  // which is how a date ended up standing in for the name.
  assert.match(tab, /conversationMeta\?\.title \|\|\s*\n\s*selectedMeta\?\.title/);
  assert.match(chat, /setConversationMeta\(\{ channel: detail\.channel, title: detail\.title \}\)/);
});

test("answering the questions gets past question one", () => {
  const panel = web("components", "chat", "InlineAskPanel.tsx");

  // The reset is keyed on the batch's identity and NEVER on the questions
  // array. That array is rebuilt on every render of the host — it is derived
  // from the message list, which changes on every stream event and every live
  // refresh — so an effect watching it re-ran constantly and put the index back
  // to zero: you answered question 2, pressed Next, and landed on question 1
  // again with no way past it.
  assert.match(panel, /const \[batch, setBatch\] = useState\(turnKey\);/);
  assert.match(panel, /if \(batch !== turnKey\) \{\s*\n\s*setBatch\(turnKey\);\s*\n\s*setIdx\(0\);/);
  assert.doesNotMatch(panel, /\}, \[turnKey, questions\]\)/, "the array must not key the reset");

  // The chips get a row of their own. Sharing one line with "1/3" and a header
  // like "Opción múltiple", the question was squeezed into a third of a phone's
  // width and broke across five lines — and the question is the part you read.
  assert.match(panel, /<p className="mt-1\.5 text-sm font-semibold leading-snug">\{current\.question\}<\/p>/);
  assert.doesNotMatch(panel, /min-w-0 flex-1 text-sm font-semibold leading-snug/);
});
