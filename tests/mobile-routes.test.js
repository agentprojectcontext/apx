// The phone surface's URLs.
//
// Every screen under /mobile is a URL, and that is not a nicety: a phone
// discards background tabs constantly, so "where you were" has to survive a
// reload. It used to live in `useState`, which meant coming back from another
// app dropped you on the list with the thread you were reading gone.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobile = (f) =>
  fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", "screens", "mobile", f), "utf8");

test("the projectless super-agent gets a sentinel that cannot collide", () => {
  const routes = mobile("routes.ts");
  // Roby's inbox row carries project_id: null. Rendered as "" the path became
  // /mobile/chat//super_agent — an empty segment matches no route, so opening
  // Roby bounced straight back to the list.
  assert.match(routes, /const NO_PROJECT = "-"/);
  // And NOT "0": zero is a real project id in this daemon, so a sentinel of 0
  // would break for whoever owns that project.
  assert.doesNotMatch(routes, /const NO_PROJECT = "0"/);
  assert.match(routes, /export function pidOf/);
  assert.match(routes, /export function projectOf/);
  // The lookup and the link must agree on the spelling, or a deep link finds
  // nothing and silently renders the placeholder.
  assert.match(routes, /rows\.find\(\(r\) => pidOf\(r\) === pid/);
});

test("a session is part of the path, not component state", () => {
  const routes = mobile("routes.ts");
  assert.match(routes, /export function sessionParam/);
  assert.match(routes, /export function selectionFromParam/);
  // `~` is RFC 3986 unreserved, so a channel~thread pair needs no escaping and
  // the path stays readable.
  assert.match(routes, /`\$\{key\.channel\}~\$\{key\.threadId\}`/);

  const chat = mobile("MobileChat.tsx");
  assert.match(chat, /const selection = selectionFromParam\(sessionParamValue, row\)/);
  assert.doesNotMatch(chat, /useState<ChatKey>/, "the URL is the state; a second copy would drift from it");

  const screen = mobile("MobileScreen.tsx");
  assert.match(screen, /path="chat\/:pid\/:slug\/:session"/);
  assert.match(screen, /chatPath\(pid, slug, key\), \{ replace: true \}/,
    "switching sessions replaces, so Back leaves the chat instead of walking every session");
});

test("a deep link to an agent the inbox does not list still opens", () => {
  const routes = mobile("routes.ts");
  // The inbox only carries agents that have been talked to, and it is paged.
  // Bouncing to the list is worse than a missing avatar.
  assert.match(routes, /export function placeholderRow/);
  assert.match(routes, /return hit \|\| placeholderRow\(pid, slug, rows\)/);
});

test("the phone surface is reachable from the desktop panel", () => {
  const app = fs.readFileSync(
    path.join(__dirname, "..", "src", "interfaces", "web", "src", "App.tsx"),
    "utf8",
  );
  // The manifest's start_url points at /mobile, but that only applies once the
  // app is INSTALLED. Opening the URL in a phone browser lands on `/` — the
  // desktop shell at 375px — which is where the phone surface is least
  // discoverable and where the install banner (inside /mobile) never appears.
  assert.match(app, /<MobileHint \/>/);
  assert.match(app, /<MobileLinkDialog/);
  assert.match(app, /data-testid="mobile-link"/);

  const hint = fs.readFileSync(
    path.join(__dirname, "..", "src", "interfaces", "web", "src", "components", "MobileHint.tsx"),
    "utf8",
  );
  // A card you can dismiss, not a redirect: someone may want the full panel on
  // a tablet, and being moved without asking is worse.
  assert.match(hint, /localStorage\.setItem\(DISMISSED/);
  assert.doesNotMatch(hint, /<Navigate/);

  const dialog = fs.readFileSync(
    path.join(__dirname, "..", "src", "interfaces", "web", "src", "components", "MobileLinkDialog.tsx"),
    "utf8",
  );
  // Loopback is the one address a phone can never reach, and the nonce belongs
  // in the fragment — never sent to a server, never in a Referer or a log.
  assert.match(dialog, /e\.kind !== "loopback"/);
  assert.match(dialog, /`\$\{link\}#pair=\$\{pairingId\}`/);
});
