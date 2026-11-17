// Whatever opens a chat (a notice, the palette, a link, a row), the Inbox turns to the tab that lists it, even while
// the list is not on screen (a phone showing the chat), so going back to it finds the chat there.
import { type InboxTab, prefs, setPrefs } from "../data/prefs.ts";
import { data } from "../data/state.ts";
import { taskHomes } from "../data/tasks.ts";
import { nav } from "../shell/nav.ts";
import { listTab } from "./listTab.ts";

let shownThread = nav.get().threadId;
let shownRoutine = nav.get().routineId;
/** The chat opened last, until it is loaded and its tab known. */
let pending = shownThread;

let turning = false;

function turnTo(tab: InboxTab): void {
  if (prefs.get().inboxTab === tab) return;
  turning = true;
  try {
    setPrefs({ inboxTab: tab });
  } finally {
    turning = false;
  }
}

function settle(): void {
  const tab = listTab(data.get().threads, pending, taskHomes());
  if (!tab) return;
  pending = undefined;
  turnTo(tab);
}

nav.subscribe(() => {
  const s = nav.get();
  if (s.routineId !== shownRoutine) {
    shownRoutine = s.routineId;
    if (s.routineId) turnTo("routines");
  }
  if (s.threadId === shownThread) return;
  shownThread = s.threadId;
  pending = s.threadId;
  settle();
});

data.subscribe(() => {
  if (pending) settle();
});

// A tab the owner picks while the open chat still loads is theirs: the chat no longer turns the list when it arrives.
let pickedTab = prefs.get().inboxTab;
prefs.subscribe(() => {
  const tab = prefs.get().inboxTab;
  if (tab === pickedTab) return;
  pickedTab = tab;
  if (!turning) pending = undefined;
});

if (shownRoutine) turnTo("routines");
settle();
