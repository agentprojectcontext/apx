import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consentKey,
  denialCookie,
  initializeConsent,
  measurementId,
  pageLocation,
} from "../src/components/analytics.mjs";

function fixture(choice, unavailable = false, broadcasts = new Set()) {
  const elements = Object.fromEntries(
    ["panel", "settings", "accept", "reject", "error"].map((name) => [
      name,
      {
        hidden: true,
        listeners: {},
        focus() {},
        addEventListener(event, callback) {
          this.listeners[event] = callback;
        },
        click() {
          this.listeners.click();
        },
      },
    ]),
  );
  const root = {
    dataset: { analyticsPath: "/es/" },
    querySelector(selector) {
      return elements[selector.slice(13, -1)];
    },
  };
  const scripts = [];
  const values = new Map(choice ? [[consentKey, choice]] : []);
  let reloads = 0;
  const listeners = {};
  const failures = { write: unavailable, cookies: false };
  const win = {
    BroadcastChannel: class {
      constructor() {
        broadcasts.add(this);
      }
      postMessage(data) {
        for (const peer of broadcasts) if (peer !== this) peer.onmessage?.({ data });
      }
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    location: {
      origin: "https://example.com",
      pathname: "/es/",
      hostname: "example.com",
      search: "?email=private",
      hash: "#private",
      reload() {
        reloads++;
      },
    },
    localStorage: {
      getItem(key) {
        if (unavailable) throw Error("unavailable");
        return values.get(key);
      },
      setItem(key, value) {
        if (failures.write) throw Error("unavailable");
        values.set(key, value);
      },
      removeItem(key) {
        if (failures.write) throw Error("unavailable");
        values.delete(key);
      },
    },
  };
  const cleared = [];
  const cookies = new Map([
    ["_ga", "old"],
    ["_ga_BZT6ME07J4", "old"],
    ["unrelated", "keep"],
  ]);
  const doc = {
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    body: { append() {} },
    querySelector() {
      return root;
    },
    createElement() {
      return {};
    },
    head: {
      append(script) {
        scripts.push(script);
      },
    },
    get cookie() {
      if (failures.cookies) throw Error("unavailable");
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(value) {
      if (failures.cookies) throw Error("unavailable");
      cleared.push(value);
      const [name, data] = value.split(";")[0].split("=");
      if (value.includes("Max-Age=0")) cookies.delete(name);
      else cookies.set(name, data);
    },
  };
  initializeConsent(win, doc);
  return { win, doc, root, elements, scripts, values, cleared, failures, listeners, reloads: () => reloads };
}

test("page addresses exclude queries and fragments", () => {
  assert.equal(
    pageLocation(
      { origin: "https://example.com", pathname: "/private/", search: "?secret=1", hash: "#secret" },
      "/guide/",
    ),
    "https://example.com/guide/",
  );
});

test("unknown, declined and malformed consent never load Google or queue events", () => {
  for (const choice of [undefined, "declined", "unexpected"]) {
    const f = fixture(choice);
    assert.equal(f.scripts.length, 0);
    assert.equal(f.win.dataLayer, undefined);
    assert.equal(f.win[`ga-disable-${measurementId}`], true);
    assert.equal(f.elements.panel.hidden, choice === "declined");
  }
});

test("acceptance queues a single sanitized page view and persists choice", () => {
  const f = fixture();
  f.elements.accept.click();
  assert.equal(f.values.get(consentKey), "accepted");
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${measurementId}`);
  const commands = f.win.dataLayer.map((args) => Array.from(args));
  assert.deepEqual(commands[2], [
    "event",
    "page_view",
    { page_location: "https://example.com/es/", page_referrer: "", page_title: "APX website" },
  ]);
  assert.equal(commands[1][2].send_page_view, false);
  assert.equal(commands[1][2].allow_google_signals, false);
  assert.equal(commands[1][2].allow_ad_personalization_signals, false);
  f.elements.settings.click();
  assert.equal(f.elements.panel.hidden, false);
  f.elements.accept.click();
  initializeConsent(f.win, f.doc);
  assert.equal(f.scripts.length, 1);
});

test("persisted acceptance loads once; revocation disables, clears only analytics cookies and reloads", () => {
  const f = fixture("accepted");
  assert.equal(f.scripts.length, 1);
  f.elements.settings.click();
  f.elements.reject.click();
  assert.equal(f.values.get(consentKey), "declined");
  assert.equal(f.win[`ga-disable-${measurementId}`], true);
  assert.equal(f.reloads(), 1);
  assert.ok(f.cleared.some((cookie) => cookie.startsWith("_ga=")));
  assert.ok(f.cleared.every((cookie) => !cookie.startsWith("unrelated=")));
  assert.equal(f.win.dataLayer.length, 3);
});

test("revocation stays closed when storage becomes unwritable after accepting", () => {
  const f = fixture("accepted");
  f.failures.write = true;
  f.elements.reject.click();
  assert.equal(f.reloads(), 1);
  f.root.dataset.ready = "";
  initializeConsent(f.win, f.doc);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.win[`ga-disable-${measurementId}`], true);
  assert.equal(f.elements.panel.hidden, true);
  f.failures.write = false;
  f.root.dataset.ready = "";
  initializeConsent(f.win, f.doc);
  assert.equal(f.values.get(consentKey), "accepted");
  assert.ok(f.doc.cookie.includes(`${denialCookie}=1`));
  assert.equal(f.scripts.length, 1, "denial survives storage recovery despite stale acceptance");
  f.elements.settings.click();
  f.elements.accept.click();
  assert.ok(!f.doc.cookie.includes(`${denialCookie}=1`));
});

test("revocation in another tab and clearing storage disable the loaded tag", () => {
  for (const key of [consentKey, null]) {
    const f = fixture("accepted");
    f.values.set(consentKey, "declined");
    f.listeners.storage({ key });
    assert.equal(f.win[`ga-disable-${measurementId}`], true);
    assert.equal(f.reloads(), 1);
  }
});

test("restoring a cached page reconciles a newer declined choice", () => {
  const f = fixture("accepted");
  f.values.set(consentKey, "declined");
  f.listeners.pageshow();
  assert.equal(f.win[`ga-disable-${measurementId}`], true);
  assert.equal(f.reloads(), 1);
});

test("cookie access errors do not break preferences or re-enable an unwritable acceptance", () => {
  const f = fixture("accepted");
  f.failures.cookies = true;
  f.failures.write = true;
  assert.doesNotThrow(() => f.elements.reject.click());
  f.root.dataset.ready = "";
  assert.doesNotThrow(() => initializeConsent(f.win, f.doc));
  assert.equal(f.scripts.length, 1);
  assert.equal(f.win[`ga-disable-${measurementId}`], true);
});

test("a failed decline stops all active tabs and retries after storage recovers", () => {
  const broadcasts = new Set();
  const tabs = [fixture("accepted", false, broadcasts), fixture("accepted", false, broadcasts)];
  for (const tab of tabs) {
    tab.failures.write = true;
    tab.failures.cookies = true;
  }
  tabs[0].elements.reject.click();
  for (const tab of tabs) {
    assert.equal(tab.win[`ga-disable-${measurementId}`], true);
    assert.equal(tab.elements.error.hidden, false);
    assert.equal(tab.elements.panel.hidden, false);
    assert.equal(tab.reloads(), 0, "do not reload into a stale acceptance");
    assert.equal(tab.values.get(consentKey), "accepted");
    tab.failures.write = false;
    tab.failures.cookies = false;
    tab.listeners.visibilitychange();
    assert.equal(tab.values.get(consentKey), "declined");
    assert.equal(tab.elements.error.hidden, true);
    assert.equal(tab.reloads(), 1);
    tab.root.dataset.ready = "";
    initializeConsent(tab.win, tab.doc);
    assert.equal(tab.scripts.length, 1, "recovery cannot resurrect the old acceptance");
  }
});

test("storage failure defaults to no analytics and still allows an explicit choice", () => {
  const f = fixture(undefined, true);
  assert.equal(f.scripts.length, 0);
  f.elements.reject.click();
  assert.equal(f.scripts.length, 0);
  f.elements.settings.click();
  f.elements.accept.click();
  assert.equal(f.scripts.length, 1);
});
