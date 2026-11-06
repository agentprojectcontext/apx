// APX's extension: the side panel, and the tabs of Chrome's "APX" group lent to APX through `apx chrome-host` (native
// messaging). A tab outside that group is never read or driven; the owner shares one by moving it into the group.
const HOST = "dev.apx.chrome";
// The local APX this build shows: a tab on it holds the owner's controls and is never driven.
const PANEL = "http://127.0.0.1:7440";
const GROUP = "APX";
// What APX's tab driver sends; anything else (cookies, storage, downloads…) never reaches a tab.
const METHODS = new Set([
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "CSS.enable",
  "CSS.getComputedStyleForNode",
  "DOM.describeNode",
  "DOM.enable",
  "DOM.focus",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.getDocument",
  "DOM.getNodeForLocation",
  "DOM.pushNodesByBackendIdsToFrontend",
  "DOM.removeAttribute",
  "DOM.resolveNode",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.setAttributeValue",
  "DOM.setNodeValue",
  "Fetch.continueRequest",
  "Fetch.enable",
  "Fetch.failRequest",
  "Input.dispatchKeyEvent",
  "Input.dispatchMouseEvent",
  "Input.insertText",
  "Page.captureScreenshot",
  "Page.createIsolatedWorld",
  "Page.enable",
  "Page.getFrameTree",
  "Page.getLayoutMetrics",
  "Page.getNavigationHistory",
  "Page.navigate",
  "Page.navigateToHistoryEntry",
  "Page.reload",
  "Runtime.callFunctionOn",
  "Runtime.evaluate",
  "Runtime.releaseObjectGroup",
]);
// The events APX's tab driver listens to; the rest stay in Chrome.
const EVENTS = new Set([
  "Page.loadEventFired",
  "Page.frameNavigated",
  "Page.navigatedWithinDocument",
  "Fetch.requestPaused",
]);
const FIRST_WAIT_MS = 2000;
const attached = new Set();
let port;
let retry;
let wait = FIRST_WAIT_MS;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

function connect() {
  if (port) return;
  clearTimeout(retry);
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    port = undefined;
    later();
    return;
  }
  port.onMessage.addListener((message) => {
    wait = FIRST_WAIT_MS;
    void answer(message);
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    port = undefined;
    later();
  });
}

// APX not installed or not started yet: try again, less often each time; opening the panel tries at once.
function later() {
  retry = setTimeout(connect, wait);
  wait = Math.min(wait * 2, 5 * 60_000);
}

function post(message) {
  try {
    port?.postMessage(message);
  } catch {}
}

async function answer(message) {
  if (!message || typeof message.id !== "string") return;
  try {
    post({ t: "res", id: message.id, ok: true, result: (await run(message)) ?? null });
  } catch (error) {
    post({ t: "res", id: message.id, ok: false, error: String(error?.message ?? error).slice(0, 500) });
  }
}

async function groupsOf(windowId) {
  return chrome.tabGroups.query(windowId === undefined ? { title: GROUP } : { title: GROUP, windowId });
}

async function inGroup(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const group = tab.groupId >= 0 ? await chrome.tabGroups.get(tab.groupId) : undefined;
  if (group?.title !== GROUP) throw new Error("that tab is not in Chrome's APX group");
  if (tab.url === PANEL || tab.url?.startsWith(`${PANEL}/`)) throw new Error("that tab shows APX itself");
  return tab;
}

async function attach(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    // After the worker restarts it no longer remembers a tab it attached to.
    if (!String(error?.message ?? error).includes("already attached")) throw error;
  }
  attached.add(tabId);
}

async function run(message) {
  switch (message.t) {
    case "list": {
      const ids = new Set((await groupsOf()).map((g) => g.id));
      const tabs = await chrome.tabs.query({});
      return tabs
        .filter((t) => t.id !== undefined && ids.has(t.groupId))
        .map((t) => ({ tab: t.id, url: t.url ?? "", title: t.title ?? "" }));
    }
    case "open": {
      const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      const tab = await chrome.tabs.create({ url: "about:blank", active: true, windowId: win.id });
      const [group] = await groupsOf(tab.windowId);
      const groupId = await chrome.tabs.group(
        group
          ? { tabIds: [tab.id], groupId: group.id }
          : { tabIds: [tab.id], createProperties: { windowId: tab.windowId } },
      );
      if (!group) await chrome.tabGroups.update(groupId, { title: GROUP, color: "orange" });
      return { tab: tab.id };
    }
    case "close":
      await inGroup(message.tab);
      await chrome.tabs.remove(message.tab);
      return null;
    case "show":
      await inGroup(message.tab);
      await chrome.tabs.update(message.tab, { active: true });
      return null;
    case "cdp": {
      if (!METHODS.has(message.method)) throw new Error(`${message.method} is not sent to tabs`);
      await inGroup(message.tab);
      await attach(message.tab);
      const send = () => chrome.debugger.sendCommand({ tabId: message.tab }, message.method, message.params ?? {});
      try {
        return await send();
      } catch (error) {
        // Chrome let go of the tab without telling (a crash, a reload of the extension): attach again, once.
        if (!String(error?.message ?? error).includes("not attached")) throw error;
        attached.delete(message.tab);
        await attach(message.tab);
        return send();
      }
    }
    default:
      throw new Error("unknown request");
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== undefined && EVENTS.has(method)) post({ t: "event", tab: source.tabId, method, params });
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === undefined) return;
  attached.delete(source.tabId);
  post({ t: "detached", tab: source.tabId, reason });
});

// A tab moved out of the group is no longer APX's: its debugger leaves with it.
// Detaching from here fires no onDetach, so the host is told the same way.
function release(tabId, reason) {
  attached.delete(tabId);
  void chrome.debugger.detach({ tabId }).catch(() => {});
  post({ t: "detached", tab: tabId, reason });
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.groupId === undefined && change.url === undefined) return;
  if (change.groupId !== undefined) post({ t: "tabs" });
  if (attached.has(tabId)) void inGroup(tabId).catch(() => release(tabId, "left_group"));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  post({ t: "tabs" });
});
chrome.tabGroups.onUpdated.addListener(() => post({ t: "tabs" }));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.t === "connect") connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
