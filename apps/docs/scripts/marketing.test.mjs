import assert from "node:assert/strict";
import { test } from "node:test";
import { copyInstallation } from "../src/components/install-copy.mjs";
import { campaignParameters, initializeMarketing, linkEvent } from "../src/components/marketing.mjs";

const origin = "https://example.com";
test("downloads identify only official asset types, never URLs or link text", () => {
  const files = [
    ["-mac-arm64.dmg", "macos", "arm64"],
    ["-mac-x64.dmg", "macos", "x64"],
    ["-win-x64.exe", "windows", "x64"],
    ["-linux-x86_64.AppImage", "linux", "x64"],
    ["-linux-arm64.AppImage", "linux", "arm64"],
    ["-android.apk", "android", "universal"],
  ];
  for (const [file, os, architecture] of files) {
    assert.deepEqual(
      linkEvent(
        `https://github.com/agentprojectcontext/apx/releases/download/v2.0.0/apx${file}?private=1`,
        origin,
        "downloads",
      ),
      {
        name: "download_click",
        parameters: { os, architecture, placement: "downloads" },
      },
    );
  }
  assert.equal(linkEvent("https://example.net/apx-win-x64.exe", origin), undefined);
  assert.equal(linkEvent("javascript:alert(1)", origin), undefined);
  assert.equal(linkEvent("https://github.com/another/repo/releases/file.exe", origin), undefined);
  assert.equal(linkEvent("https://github.com/agentprojectcontext/apx/releases/latest", origin).name, "cta_click");
});

test("internal actions are classified without leaking destinations, fragments or user text", () => {
  assert.deepEqual(linkEvent(`${origin}/es/docs/start/install/?email=private#secret`, origin, "final"), {
    name: "cta_click",
    parameters: { action: "installation_guide", placement: "final" },
  });
  assert.deepEqual(linkEvent(`${origin}/es/compare/hermes-agent/?private=1`, origin), {
    name: "comparison_open",
    parameters: { destination: "article", placement: "content" },
  });
  assert.equal(linkEvent(`${origin}/compare/`, origin).parameters.destination, "index");
  assert.equal(linkEvent(`${origin}/#download`, origin).parameters.action, "download_section");
  assert.equal(linkEvent(`${origin}/anything/?secret=1`, origin, "footer").parameters.destination, "site");
  assert.equal(linkEvent(`${origin}/anything/`, origin), undefined);
});

test("campaigns use a finite vocabulary, not arbitrary values or query parameters", () => {
  assert.deepEqual(
    campaignParameters(
      "?utm_source=youtube&utm_medium=video&utm_campaign=launch&utm_content=user@example.com&email=private",
    ),
    {
      campaign_source: "youtube",
      campaign_medium: "video",
      campaign_name: "launch",
    },
  );
  assert.deepEqual(campaignParameters("?utm_source=user%40example.com&utm_medium=secret&utm_campaign=private"), {});
});

test("copy failures do not signal success; a successful write never puts the command into the event", async () => {
  const events = [];
  const button = { dataset: { copy: "private command" }, dispatchEvent: (event) => events.push(event) };
  const win = {
    navigator: {},
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.options = options;
      }
    },
  };
  assert.equal(await copyInstallation(win, button), false);
  win.navigator.clipboard = {
    writeText: async () => {
      throw Error("denied");
    },
  };
  assert.equal(await copyInstallation(win, button), false);
  assert.equal(events.length, 0);
  let written;
  win.navigator.clipboard.writeText = async (value) => {
    written = value;
  };
  assert.equal(await copyInstallation(win, button), true);
  assert.equal(written, "private command");
  assert.deepEqual(
    events.map((event) => ({ type: event.type, options: event.options })),
    [{ type: "apx:install-copied", options: { bubbles: true } }],
  );
});

test("delegated events and final reading stop on revocation and completion fires once", () => {
  const listeners = new Map();
  const sent = [];
  let enabled = true;
  let callback;
  let observed;
  let disconnected = 0;
  const end = {};
  const doc = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => {
      if (listeners.get(name) === fn) listeners.delete(name);
    },
    querySelector: (selector) => (selector === ".compare" ? {} : end),
  };
  const win = {
    location: { origin },
    IntersectionObserver: class {
      constructor(fn) {
        callback = fn;
      }
      observe(target) {
        observed = target;
      }
      disconnect() {
        disconnected++;
      }
    },
  };
  const dispose = initializeMarketing(
    win,
    doc,
    (name, params) => sent.push({ name, params }),
    () => enabled,
  );
  const link = { href: `${origin}/compare/`, closest: () => null };
  const event = { target: { closest: () => link }, defaultPrevented: false };
  listeners.get("click")(event);
  assert.equal(sent[0].name, "comparison_open");
  listeners.get("click")({ ...event, defaultPrevented: true });
  assert.equal(sent.length, 1);
  assert.equal(observed, end);
  callback([{ isIntersecting: true, intersectionRatio: 0.3 }]);
  assert.equal(sent.length, 1);
  callback([{ isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(sent[1], { name: "article_complete", params: { content_type: "comparison" } });
  assert.equal(disconnected, 1);
  callback([{ isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(sent.length, 2, "queued visibility notifications do not duplicate completion");
  enabled = false;
  listeners.get("click")(event);
  listeners.get("apx:install-copied")({ target: { closest: () => link } });
  assert.equal(sent.length, 2);
  dispose();
  assert.equal(listeners.size, 0);
  assert.equal(disconnected, 2);
});
