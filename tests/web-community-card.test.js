// The Discord invitation: the one thing in the panel that points outside it.
//
// APX installs from a repo, so nothing tells a new user that other people are
// running it too. This card is that, and everything about it is a promise that
// breaks quietly: an invite that stops being mounted, a link that goes stale, a
// dismissal that does not stick and turns an invitation into an advert.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

test("the Discord invitation is offered on both surfaces and closes for good", () => {
  const card = webSrc("components", "common", "CommunityCard.tsx");
  const constants = webSrc("constants", "index.ts");
  const app = webSrc("App.tsx");
  const list = webSrc("screens", "mobile", "MobileChatList.tsx");

  // The invite itself lives in constants, not inlined in the JSX: it is the
  // kind of value that gets rotated, and hunting for it in a component is how
  // a dead link survives.
  assert.match(constants, /discord: "https:\/\/discord\.gg\/\w+"/);
  assert.match(card, /href=\{LINKS\.discord\}/);
  // A link out of the panel opens in its own tab, and never hands the opener
  // to the destination.
  assert.match(card, /rel="noopener noreferrer"/);

  // Shown once per device. Dismissal reads at mount and writes on close; both
  // halves are wrapped, because localStorage throws outright in private mode
  // and an invitation must not be what takes the panel down.
  assert.match(constants, /discordDismissed: "apx\.discord\.dismissed"/);
  assert.match(card, /localStorage\.getItem\(STORAGE\.discordDismissed\) === "1"/);
  assert.match(card, /localStorage\.setItem\(STORAGE\.discordDismissed, "1"\)/);
  assert.match(card, /if \(hidden\) return null;/);

  // Both surfaces. The desktop corner, and the top of the phone's list, beside
  // the two offers that were already there — at the FOOT it measured 8275px
  // into an 8304px scroller, which is not a quiet invitation but an absent one.
  assert.match(app, /<CornerCards \/>/);
  assert.match(webSrc("components", "common", "CornerCards.tsx"), /<CommunityCard \/>/);
  assert.match(list, /<CommunityCard variant="inline" \/>/);
  const offers = list.indexOf("<CommunityCard variant=\"inline\" />");
  const rowsBegin = list.indexOf("shownRows.map");
  assert.ok(offers > 0 && offers < rowsBegin, "the invitation must sit above the list, not after it");
});

test("the corner says one thing at a time, in a deliberate order", () => {
  const stack = webSrc("components", "common", "CornerCards.tsx");
  const app = webSrc("App.tsx");

  // One mount point, not four components each claiming bottom-right.
  assert.match(app, /<CornerCards \/>/);
  assert.doesNotMatch(app, /<UpdateBanner \/>/, "the update notice belongs to the queue now, not to the top of the panel");

  // The queue IS the DOM order. The one in front is in flow so the corner keeps
  // its size; the rest are absolute against its TOP edge — anchored at the
  // bottom the peek depended on the cards' relative heights, and the tallest
  // was in front, so the deck was there and invisible.
  assert.match(stack, /\[&>\*:first-child\]:relative/);
  assert.match(stack, /\[&>\*:not\(:first-child\)\]:top-0/);
  assert.match(stack, /\[&>\*:not\(:first-child\)\]:pointer-events-none/);
  // Deep enough to hint, not deep enough to be a pile.
  assert.match(stack, /\[&>\*:nth-child\(n\+4\)\]:hidden/);
  const order = ["NotifyNudge", "CommunityCard", "UpdateBanner", "StarCard"]
    .map((c) => stack.indexOf(`<${c}`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the cards must stay in priority order");
  assert.ok(order.every((i) => i > 0), "every card must be in the queue");

  // The permission ask is first because it is the only one that silently stops
  // working when ignored — no notification ever arrives.
  assert.ok(order[0] === Math.min(...order));

  // The ask-for-something card is last, and never comes back once closed.
  assert.match(stack, /localStorage\.setItem\(STORAGE\.starDismissed, "1"\)/);
  assert.match(stack, /rel="noopener noreferrer"/);
});

test("the phone offers the app through the agent, and only where that makes sense", () => {
  const list = webSrc("screens", "mobile", "MobileChatList.tsx");

  // An APK cannot be installed from a web page. The one party that can is the
  // agent on the machine holding the cable, so the row hands the job over
  // instead of pretending the browser can do it.
  assert.match(list, /function AskToInstallRow/);
  assert.match(list, /chatPath\(pidOf\(superAgent\), superAgent\.agent_slug, keyFor\(superAgent\)\)/);
  assert.match(list, /\?draft=\$\{encodeURIComponent\(t\("android_ask\.draft"\)\)\}/);

  // Three gates, and each one is a different way the offer would be a lie:
  // inside the app it is already installed, on an iPhone there is no APK, and
  // dismissal has to stick.
  assert.match(list, /isNativeShell\(\)/);
  assert.match(list, /\/Android\/i\.test\(navigator\.userAgent\)/);
  assert.match(list, /localStorage\.setItem\(ASK_DISMISSED, "1"\)/);

  // It names the super-agent rather than saying "the agent": whoever reads it
  // has their own name for Roby.
  assert.match(list, /superAgent\.agent_name \|\| superAgent\.agent_slug/);
  // Both ways out, because they need different things: the download works from
  // the phone alone, asking the agent needs a cable and a computer.
  assert.match(list, /data-testid="android-download-apk"/);

  // And the PWA offer is gated the same way, for a sharper reason: inside the
  // app it offered to install what you are already running, and over http it
  // pointed at a Tailscale section "below" that only exists on the desktop.
  const installRow = list.slice(list.indexOf("function InstallRow"));
  assert.match(installRow, /if \(isNativeShell\(\)\) return null;/);
  assert.match(list, /href=\{LINKS\.androidApk\}/);
  // …and every string that carries {name} is actually GIVEN one. The button
  // shipped reading "Pedirle a {name}" because one call lacked the argument.
  for (const key of ["android_ask.cta"]) {
    const call = new RegExp(`t\\("${key.replace(".", "\\.")}", \\{ name \\}\\)`);
    assert.match(list, call, `${key} is interpolated without passing name`);
  }
});
