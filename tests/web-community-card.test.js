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
  assert.match(app, /<CommunityCard \/>/);
  assert.match(list, /<CommunityCard variant="inline" \/>/);
  const offers = list.indexOf("<CommunityCard variant=\"inline\" />");
  const rowsBegin = list.indexOf("shownRows.map");
  assert.ok(offers > 0 && offers < rowsBegin, "the invitation must sit above the list, not after it");
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
  assert.match(list, /href=\{LINKS\.androidApk\}/);
  // …and every string that carries {name} is actually GIVEN one. The button
  // shipped reading "Pedirle a {name}" because one call lacked the argument.
  for (const key of ["android_ask.cta"]) {
    const call = new RegExp(`t\\("${key.replace(".", "\\.")}", \\{ name \\}\\)`);
    assert.match(list, call, `${key} is interpolated without passing name`);
  }
});
