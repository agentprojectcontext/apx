var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cli/http.js
var http_exports = {};
__export(http_exports, {
  ensureDaemon: () => ensureDaemon,
  http: () => http
});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
function readToken() {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim();
  } catch {
    return "";
  }
}
function baseUrl() {
  return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
}
async function ping(timeoutMs = 400) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${baseUrl()}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
function findDaemonEntry() {
  const candidates = [
    path.resolve(__dirname, "..", "daemon", "index.js"),
    path.resolve(__dirname, "..", "node_modules", "apx-daemon", "src", "index.js")
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}
async function autoStart({ silent = false } = {}) {
  const entry = findDaemonEntry();
  if (!entry) {
    throw new Error(
      "apx daemon not installed and not found at ../daemon/src/index.js. Install with `npm i -g apx-daemon` or run from the apc monorepo."
    );
  }
  const logPath = path.join(os.homedir(), ".apx", "daemon.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env }
  });
  child.unref();
  if (!silent) process.stderr.write("apx: starting daemon...\n");
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await ping(200)) return true;
  }
  throw new Error("apx daemon failed to start within 4s \u2014 check ~/.apx/daemon.log");
}
async function ensureDaemon(opts = {}) {
  if (await ping()) return;
  await autoStart(opts);
}
async function request(method, path2, body, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!await ping()) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }
  const token = readToken();
  const res = await fetch(`${baseUrl()}${path2}`, {
    method,
    headers: {
      ...body ? { "content-type": "application/json" } : {},
      ...token ? { "authorization": `Bearer ${token}` } : {}
    },
    body: body ? JSON.stringify(body) : void 0,
    signal: opts.signal
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new Error(`${method} ${path2} \u2192 ${res.status}: ${text}`);
    return text;
  }
  if (!res.ok) {
    const msg = json?.error || `${method} ${path2} \u2192 ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
async function streamRequest(method, path2, body, onEvent, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!await ping()) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }
  const token = readToken();
  const res = await fetch(`${baseUrl()}${path2}`, {
    method,
    headers: {
      ...body ? { "content-type": "application/json" } : {},
      ...token ? { "authorization": `Bearer ${token}` } : {}
    },
    body: body ? JSON.stringify(body) : void 0,
    signal: opts.signal
  });
  if (!res.ok) {
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
    }
    const err = new Error(json?.error || `${method} ${path2} \u2192 ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (!res.body?.getReader) {
    throw new Error("streaming response is not supported by this Node.js runtime");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => reader.cancel().catch(() => {
    }), { once: true });
  }
  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      break;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "final") finalResult = event.result;
      if (event.type === "error") throw new Error(event.error || "stream error");
      await onEvent?.(event);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer);
      if (event.type === "final") finalResult = event.result;
      if (event.type === "error") throw new Error(event.error || "stream error");
      await onEvent?.(event);
    } catch {
    }
  }
  return finalResult;
}
var __filename, __dirname, DEFAULT_PORT, DEFAULT_HOST, TOKEN_PATH, http;
var init_http = __esm({
  "src/cli/http.js"() {
    __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
    DEFAULT_PORT = parseInt(process.env.APX_PORT || "7430", 10);
    DEFAULT_HOST = process.env.APX_HOST || "127.0.0.1";
    TOKEN_PATH = path.join(os.homedir(), ".apx", "daemon.token");
    http = {
      get: (p, opts) => request("GET", p, void 0, opts),
      post: (p, body, opts) => request("POST", p, body, opts),
      streamPost: (p, body, onEvent, opts) => streamRequest("POST", p, body, onEvent, opts),
      put: (p, body, opts) => request("PUT", p, body, opts),
      patch: (p, body, opts) => request("PATCH", p, body, opts),
      delete: (p, opts) => request("DELETE", p, void 0, opts),
      baseUrl,
      ping,
      /** Create a fresh AbortController for cancelling in-flight requests. */
      createAbortController: () => new AbortController()
    };
  }
});

// src/tui/launch.ts
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";

// src/tui/app.tsx
import { template as _$template } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { For, Show, createMemo, onMount, onCleanup, batch } from "solid-js";
import { useTerminalDimensions, useKeyboard } from "@opentui/solid";

// src/tui/theme.ts
var theme = {
  // backgrounds
  bg: [18, 18, 18],
  bgAlt: [28, 28, 28],
  bgHeader: [22, 22, 35],
  bgInput: [24, 24, 24],
  bgUser: [30, 35, 50],
  bgBot: [20, 28, 20],
  bgError: [40, 18, 18],
  bgPalette: [30, 30, 42],
  bgSel: [60, 80, 120],
  // text
  text: [220, 220, 220],
  textDim: [120, 120, 120],
  textMute: [80, 80, 80],
  accent: [100, 150, 255],
  accentGr: [80, 200, 120],
  error: [255, 100, 100],
  warning: [255, 200, 80],
  // borders
  border: [50, 50, 60],
  borderFocus: [100, 120, 200]
};

// src/tui/store.ts
import { createStore, produce } from "solid-js/store";
var [state, setState] = createStore({
  messages: [],
  input: "",
  cursorPos: 0,
  isStreaming: false,
  agent: "super-agent",
  model: "claude-3-5-sonnet",
  projectName: "",
  paletteOpen: false,
  paletteMode: "main",
  paletteItems: [],
  paletteIndex: 0
});
function addUserMessage(text) {
  const id = `u-${Date.now()}`;
  setState("messages", (msgs) => [...msgs, { id, role: "user", text }]);
  return id;
}
function startAssistantMessage() {
  const id = `a-${Date.now()}`;
  setState("messages", (msgs) => [
    ...msgs,
    { id, role: "assistant", text: "", streaming: true }
  ]);
  setState("isStreaming", true);
  return id;
}
function appendChunk(id, chunk) {
  setState(
    "messages",
    (m) => m.id === id,
    produce((m) => {
      m.text += chunk;
    })
  );
}
function finalizeAssistantMessage(id) {
  setState(
    "messages",
    (m) => m.id === id,
    produce((m) => {
      m.streaming = false;
    })
  );
  setState("isStreaming", false);
}
function markError(id, msg) {
  setState(
    "messages",
    (m) => m.id === id,
    produce((m) => {
      m.text = msg;
      m.streaming = false;
      m.error = true;
    })
  );
  setState("isStreaming", false);
}

// src/tui/app.tsx
var _tmpl$ = /* @__PURE__ */ _$template(`<svg><text> \u2502 </svg>`, false, true, false);
var _tmpl$2 = /* @__PURE__ */ _$template(`<svg><text></svg>`, false, true, false);
var _tmpl$3 = /* @__PURE__ */ _$template(`<box height=1 flexdirection=row alignitems=center paddingleft=1 paddingright=1><text bold>APX</text><text> \u2502 </text><text>agent: </text><text></text><text> \u2502 </text><text>model: </text><text>`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<box flexdirection=column margintop=1 marginbottom=0 paddingleft=2 paddingright=2><text bold>You</text><box paddingleft=1 paddingright=1 paddingtop=0 paddingbottom=0 borderradius=1><text wrap>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<svg><text> \u25B8</svg>`, false, true, false);
var _tmpl$6 = /* @__PURE__ */ _$template(`<markdown wrap>`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<box flexdirection=column margintop=1 marginbottom=0 paddingleft=2 paddingright=2><box flexdirection=row alignitems=center><text bold></text></box><box paddingleft=1 paddingright=1 paddingtop=0 paddingbottom=0>`);
var _tmpl$8 = /* @__PURE__ */ _$template(`<svg><text italic>\u2026</svg>`, false, true, false);
var _tmpl$9 = /* @__PURE__ */ _$template(`<scrollbox flexgrow=1 stickyscroll stickystart=bottom><box flexdirection=column><box height=1>`);
var _tmpl$0 = /* @__PURE__ */ _$template(`<box paddingleft=2 paddingtop=2><text italic>Type a message and press Enter to start chatting. Ctrl+K for commands.`);
var _tmpl$1 = /* @__PURE__ */ _$template(`<svg><text> \u23F3</svg>`, false, true, false);
var _tmpl$10 = /* @__PURE__ */ _$template(`<svg><text> </svg>`, false, true, false);
var _tmpl$11 = /* @__PURE__ */ _$template(`<svg><text>Ctrl+X</svg>`, false, true, false);
var _tmpl$12 = /* @__PURE__ */ _$template(`<svg><text> abort</svg>`, false, true, false);
var _tmpl$13 = /* @__PURE__ */ _$template(`<box height=2 flexdirection=column bordertop=1><box height=1 flexdirection=row alignitems=center paddingleft=1><text>\u203A </text><input flexgrow=1 placeholder=Message...></box><box height=1 paddingleft=1 flexdirection=row><text>Ctrl+K</text><text> commands </text><text>Ctrl+C</text><text> exit`);
var _tmpl$14 = /* @__PURE__ */ _$template(`<box position=absolute top=2 left=4 width=40 flexdirection=column border=1 zindex=10 paddingtop=0 paddingbottom=0><box paddingleft=1 paddingright=1 height=1><text bold>Command Palette</text></box><box height=1 paddingleft=1><text>\u2191\u2193 navigate Enter select Esc close`);
var _tmpl$15 = /* @__PURE__ */ _$template(`<box height=1 paddingleft=2><text>`);
var _tmpl$16 = /* @__PURE__ */ _$template(`<box flexdirection=column flexgrow=1>`);
function rgb(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function Header() {
  const dims = useTerminalDimensions();
  return (() => {
    var _el$ = _tmpl$3(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.nextSibling, _el$5 = _el$4.nextSibling, _el$6 = _el$5.nextSibling, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling;
    _$insert(_el$5, () => state.agent);
    _$insert(_el$8, () => state.model);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return state.projectName;
      },
      get children() {
        return [(() => {
          var _el$9 = _tmpl$();
          _$effect(() => _$setAttribute(_el$9, "color", rgb(theme.textDim)));
          return _el$9;
        })(), (() => {
          var _el$0 = _tmpl$2();
          _$insert(_el$0, () => state.projectName);
          _$effect(() => _$setAttribute(_el$0, "color", rgb(theme.textMute)));
          return _el$0;
        })()];
      }
    }), null);
    _$effect((_p$) => {
      var _v$ = dims().width, _v$2 = rgb(theme.bgHeader), _v$3 = rgb(theme.accent), _v$4 = rgb(theme.textDim), _v$5 = rgb(theme.text), _v$6 = rgb(theme.accentGr), _v$7 = rgb(theme.textDim), _v$8 = rgb(theme.text), _v$9 = rgb(theme.textDim);
      _v$ !== _p$.e && _$setAttribute(_el$, "width", _p$.e = _v$);
      _v$2 !== _p$.t && _$setAttribute(_el$, "backgroundcolor", _p$.t = _v$2);
      _v$3 !== _p$.a && _$setAttribute(_el$2, "color", _p$.a = _v$3);
      _v$4 !== _p$.o && _$setAttribute(_el$3, "color", _p$.o = _v$4);
      _v$5 !== _p$.i && _$setAttribute(_el$4, "color", _p$.i = _v$5);
      _v$6 !== _p$.n && _$setAttribute(_el$5, "color", _p$.n = _v$6);
      _v$7 !== _p$.s && _$setAttribute(_el$6, "color", _p$.s = _v$7);
      _v$8 !== _p$.h && _$setAttribute(_el$7, "color", _p$.h = _v$8);
      _v$9 !== _p$.r && _$setAttribute(_el$8, "color", _p$.r = _v$9);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0,
      r: void 0
    });
    return _el$;
  })();
}
function UserMessage(props) {
  return (() => {
    var _el$1 = _tmpl$4(), _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$11.firstChild;
    _$insert(_el$12, () => props.text);
    _$effect((_p$) => {
      var _v$0 = rgb(theme.accent), _v$1 = rgb(theme.bgUser), _v$10 = rgb(theme.text);
      _v$0 !== _p$.e && _$setAttribute(_el$10, "color", _p$.e = _v$0);
      _v$1 !== _p$.t && _$setAttribute(_el$11, "backgroundcolor", _p$.t = _v$1);
      _v$10 !== _p$.a && _$setAttribute(_el$12, "color", _p$.a = _v$10);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$1;
  })();
}
function AssistantMessage(props) {
  const bg = () => props.error ? rgb(theme.bgError) : rgb(theme.bgBot);
  const textColor = () => props.error ? rgb(theme.error) : rgb(theme.text);
  const label = () => props.error ? "Error" : "Assistant";
  const labelColor = () => props.error ? rgb(theme.error) : rgb(theme.accentGr);
  return (() => {
    var _el$13 = _tmpl$7(), _el$14 = _el$13.firstChild, _el$15 = _el$14.firstChild, _el$17 = _el$14.nextSibling;
    _$insert(_el$15, label);
    _$insert(_el$14, _$createComponent(Show, {
      get when() {
        return props.streaming;
      },
      get children() {
        var _el$16 = _tmpl$5();
        _$effect(() => _$setAttribute(_el$16, "color", rgb(theme.textDim)));
        return _el$16;
      }
    }), null);
    _$insert(_el$17, _$createComponent(Show, {
      get when() {
        return props.text.length > 0;
      },
      get fallback() {
        return (() => {
          var _el$19 = _tmpl$8();
          _$effect(() => _$setAttribute(_el$19, "color", rgb(theme.textDim)));
          return _el$19;
        })();
      },
      get children() {
        var _el$18 = _tmpl$6();
        _$insert(_el$18, () => props.text);
        _$effect(() => _$setAttribute(_el$18, "color", textColor()));
        return _el$18;
      }
    }));
    _$effect((_p$) => {
      var _v$11 = labelColor(), _v$12 = bg();
      _v$11 !== _p$.e && _$setAttribute(_el$15, "color", _p$.e = _v$11);
      _v$12 !== _p$.t && _$setAttribute(_el$17, "backgroundcolor", _p$.t = _v$12);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$13;
  })();
}
function MessageList() {
  const dims = useTerminalDimensions();
  const listHeight = createMemo(() => dims().height - 4);
  return (() => {
    var _el$20 = _tmpl$9(), _el$21 = _el$20.firstChild, _el$22 = _el$21.firstChild;
    _$setAttribute(_el$20, "verticalscrollbaroptions", {
      visible: true
    });
    _$insert(_el$21, _$createComponent(Show, {
      get when() {
        return state.messages.length > 0;
      },
      get fallback() {
        return (() => {
          var _el$23 = _tmpl$0(), _el$24 = _el$23.firstChild;
          _$effect(() => _$setAttribute(_el$24, "color", rgb(theme.textMute)));
          return _el$23;
        })();
      },
      get children() {
        return _$createComponent(For, {
          get each() {
            return state.messages;
          },
          children: (msg) => _$createComponent(Show, {
            get when() {
              return msg.role === "user";
            },
            get fallback() {
              return _$createComponent(AssistantMessage, {
                get text() {
                  return msg.text;
                },
                get streaming() {
                  return msg.streaming;
                },
                get error() {
                  return msg.error;
                }
              });
            },
            get children() {
              return _$createComponent(UserMessage, {
                get text() {
                  return msg.text;
                }
              });
            }
          })
        });
      }
    }), _el$22);
    _$effect((_p$) => {
      var _v$13 = dims().width, _v$14 = listHeight(), _v$15 = dims().width;
      _v$13 !== _p$.e && _$setAttribute(_el$20, "width", _p$.e = _v$13);
      _v$14 !== _p$.t && _$setAttribute(_el$20, "height", _p$.t = _v$14);
      _v$15 !== _p$.a && _$setAttribute(_el$21, "width", _p$.a = _v$15);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$20;
  })();
}
function InputBar(props) {
  const dims = useTerminalDimensions();
  return (() => {
    var _el$25 = _tmpl$13(), _el$26 = _el$25.firstChild, _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling, _el$30 = _el$26.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.nextSibling, _el$34 = _el$33.nextSibling;
    _el$28.addEventListener("submit", (v) => {
      if (v.trim()) props.onSubmit(v.trim());
    });
    _el$28.addEventListener("change", (v, cursor) => {
      batch(() => {
        setState("input", v);
        setState("cursorPos", cursor);
      });
    });
    _$insert(_el$26, _$createComponent(Show, {
      get when() {
        return state.isStreaming;
      },
      get children() {
        var _el$29 = _tmpl$1();
        _$effect(() => _$setAttribute(_el$29, "color", rgb(theme.textDim)));
        return _el$29;
      }
    }), null);
    _$insert(_el$30, _$createComponent(Show, {
      get when() {
        return state.isStreaming;
      },
      get children() {
        return [(() => {
          var _el$35 = _tmpl$10();
          _$effect(() => _$setAttribute(_el$35, "color", rgb(theme.textDim)));
          return _el$35;
        })(), (() => {
          var _el$36 = _tmpl$11();
          _$effect(() => _$setAttribute(_el$36, "color", rgb(theme.textMute)));
          return _el$36;
        })(), (() => {
          var _el$37 = _tmpl$12();
          _$effect(() => _$setAttribute(_el$37, "color", rgb(theme.textDim)));
          return _el$37;
        })()];
      }
    }), null);
    _$effect((_p$) => {
      var _v$16 = dims().width, _v$17 = rgb(theme.border), _v$18 = dims().width, _v$19 = rgb(theme.bgInput), _v$20 = rgb(theme.accent), _v$21 = rgb(theme.text), _v$22 = rgb(theme.bgInput), _v$23 = state.cursorPos, _v$24 = rgb(theme.textMute), _v$25 = state.isStreaming, _v$26 = dims().width, _v$27 = rgb(theme.textMute), _v$28 = rgb(theme.textDim), _v$29 = rgb(theme.textMute), _v$30 = rgb(theme.textDim);
      _v$16 !== _p$.e && _$setAttribute(_el$25, "width", _p$.e = _v$16);
      _v$17 !== _p$.t && _$setAttribute(_el$25, "bordercolor", _p$.t = _v$17);
      _v$18 !== _p$.a && _$setAttribute(_el$26, "width", _p$.a = _v$18);
      _v$19 !== _p$.o && _$setAttribute(_el$26, "backgroundcolor", _p$.o = _v$19);
      _v$20 !== _p$.i && _$setAttribute(_el$27, "color", _p$.i = _v$20);
      _v$21 !== _p$.n && _$setAttribute(_el$28, "color", _p$.n = _v$21);
      _v$22 !== _p$.s && _$setAttribute(_el$28, "backgroundcolor", _p$.s = _v$22);
      _v$23 !== _p$.h && _$setAttribute(_el$28, "cursorindex", _p$.h = _v$23);
      _v$24 !== _p$.r && _$setAttribute(_el$28, "placeholdercolor", _p$.r = _v$24);
      _v$25 !== _p$.d && (_el$28.disabled = _p$.d = _v$25);
      _v$26 !== _p$.l && _$setAttribute(_el$30, "width", _p$.l = _v$26);
      _v$27 !== _p$.u && _$setAttribute(_el$31, "color", _p$.u = _v$27);
      _v$28 !== _p$.c && _$setAttribute(_el$32, "color", _p$.c = _v$28);
      _v$29 !== _p$.w && _$setAttribute(_el$33, "color", _p$.w = _v$29);
      _v$30 !== _p$.m && _$setAttribute(_el$34, "color", _p$.m = _v$30);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0,
      r: void 0,
      d: void 0,
      l: void 0,
      u: void 0,
      c: void 0,
      w: void 0,
      m: void 0
    });
    _$effect(() => _el$28.value = state.input);
    return _el$25;
  })();
}
var MAIN_PALETTE = ["Switch model", "Switch agent", "Exit"];
function CommandPalette(props) {
  return _$createComponent(Show, {
    get when() {
      return state.paletteOpen;
    },
    get children() {
      var _el$38 = _tmpl$14(), _el$39 = _el$38.firstChild, _el$40 = _el$39.firstChild, _el$41 = _el$39.nextSibling, _el$42 = _el$41.firstChild;
      _$insert(_el$38, _$createComponent(For, {
        get each() {
          return state.paletteItems;
        },
        children: (item, i) => {
          const selected = () => i() === state.paletteIndex;
          return (() => {
            var _el$43 = _tmpl$15(), _el$44 = _el$43.firstChild;
            _$insert(_el$44, () => selected() ? "\u203A " : "  ", null);
            _$insert(_el$44, item, null);
            _$effect((_p$) => {
              var _v$36 = selected() ? rgb(theme.bgSel) : rgb(theme.bgPalette), _v$37 = selected() ? rgb(theme.text) : rgb(theme.textDim);
              _v$36 !== _p$.e && _$setAttribute(_el$43, "backgroundcolor", _p$.e = _v$36);
              _v$37 !== _p$.t && _$setAttribute(_el$44, "color", _p$.t = _v$37);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$43;
          })();
        }
      }), _el$41);
      _$effect((_p$) => {
        var _v$31 = rgb(theme.bgPalette), _v$32 = rgb(theme.borderFocus), _v$33 = rgb(theme.bgHeader), _v$34 = rgb(theme.accent), _v$35 = rgb(theme.textMute);
        _v$31 !== _p$.e && _$setAttribute(_el$38, "backgroundcolor", _p$.e = _v$31);
        _v$32 !== _p$.t && _$setAttribute(_el$38, "bordercolor", _p$.t = _v$32);
        _v$33 !== _p$.a && _$setAttribute(_el$39, "backgroundcolor", _p$.a = _v$33);
        _v$34 !== _p$.o && _$setAttribute(_el$40, "color", _p$.o = _v$34);
        _v$35 !== _p$.i && _$setAttribute(_el$42, "color", _p$.i = _v$35);
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0,
        o: void 0,
        i: void 0
      });
      return _el$38;
    }
  });
}
function App(props) {
  let abortCtrl = null;
  async function submitMessage(text) {
    setState("input", "");
    setState("cursorPos", 0);
    addUserMessage(text);
    const aid = startAssistantMessage();
    abortCtrl = new AbortController();
    try {
      let got = false;
      await props.http.streamPost(`/projects/${props.pid}/super-agent/chat/stream`, {
        prompt: text,
        model: state.model,
        previousMessages: []
      }, (ev) => {
        if (ev.type === "chunk" && typeof ev.chunk === "string") {
          appendChunk(aid, ev.chunk);
          got = true;
        } else if (ev.type === "event" && typeof ev.text === "string") {
          appendChunk(aid, ev.text);
          got = true;
        }
      });
      if (!got) {
        const r = await props.http.post(`/projects/${props.pid}/super-agent/chat`, {
          prompt: text,
          model: state.model
        });
        if (r?.text) appendChunk(aid, r.text);
      }
      finalizeAssistantMessage(aid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markError(aid, msg);
    } finally {
      abortCtrl = null;
    }
  }
  function openPalette() {
    batch(() => {
      setState("paletteOpen", true);
      setState("paletteMode", "main");
      setState("paletteItems", [...MAIN_PALETTE]);
      setState("paletteIndex", 0);
    });
  }
  function closePalette() {
    setState("paletteOpen", false);
  }
  async function handlePaletteSelect(item) {
    if (state.paletteMode === "main") {
      if (item === "Exit") {
        closePalette();
        props.handle.close();
        return;
      }
      if (item === "Switch model") {
        try {
          const engines = await props.http.get("/engines");
          const models = (engines ?? []).map((e) => e.id ?? e.name ?? "?");
          batch(() => {
            setState("paletteMode", "model");
            setState("paletteItems", models.length ? models : ["No models found"]);
            setState("paletteIndex", 0);
          });
        } catch {
          closePalette();
        }
        return;
      }
      if (item === "Switch agent") {
        try {
          const agents = await props.http.get(`/projects/${props.pid}/agents`);
          const names = (agents ?? []).map((a) => a.slug ?? a.name ?? "?");
          batch(() => {
            setState("paletteMode", "agent");
            setState("paletteItems", names.length ? names : ["No agents found"]);
            setState("paletteIndex", 0);
          });
        } catch {
          closePalette();
        }
        return;
      }
    } else if (state.paletteMode === "model") {
      setState("model", item);
      closePalette();
    } else if (state.paletteMode === "agent") {
      setState("agent", item);
      closePalette();
    }
  }
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      props.handle.close();
      return;
    }
    if (key.ctrl && key.name === "x" && state.isStreaming) {
      abortCtrl?.abort();
      return;
    }
    if (key.ctrl && key.name === "k") {
      if (state.paletteOpen) closePalette();
      else openPalette();
      return;
    }
    if (state.paletteOpen) {
      if (key.name === "down" || key.ctrl && key.name === "n") {
        setState("paletteIndex", (i) => Math.min(i + 1, state.paletteItems.length - 1));
      } else if (key.name === "up" || key.ctrl && key.name === "p") {
        setState("paletteIndex", (i) => Math.max(i - 1, 0));
      } else if (key.name === "return" || key.name === "enter") {
        const sel = state.paletteItems[state.paletteIndex];
        if (sel) handlePaletteSelect(sel);
      } else if (key.name === "escape") {
        closePalette();
      }
    }
  }, {
    passive: true
  });
  onMount(() => {
  });
  onCleanup(() => {
    abortCtrl?.abort();
  });
  return (() => {
    var _el$45 = _tmpl$16();
    _$insert(_el$45, _$createComponent(Header, {}), null);
    _$insert(_el$45, _$createComponent(MessageList, {}), null);
    _$insert(_el$45, _$createComponent(InputBar, {
      onSubmit: submitMessage,
      get onClose() {
        return props.handle.close;
      },
      onPalette: openPalette
    }), null);
    _$insert(_el$45, _$createComponent(CommandPalette, {
      onSelect: handlePaletteSelect,
      onClose: closePalette
    }), null);
    return _el$45;
  })();
}

// src/tui/launch.ts
import { createComponent } from "solid-js";
async function launchTui(opts) {
  setState("agent", opts.agent ?? "super-agent");
  setState("model", opts.model ?? "claude-3-5-sonnet");
  setState("projectName", opts.projectName ?? "");
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 60,
    useMouse: false,
    openConsoleOnError: false,
    gatherStats: false
  });
  return new Promise((resolve) => {
    const handle = {
      close() {
        renderer.destroy();
        resolve();
      }
    };
    render(
      () => createComponent(App, { pid: opts.pid, http: opts.http, handle }),
      renderer
    );
  });
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("launch.js")) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : void 0;
  };
  const pid = get("--pid") ?? "";
  const agent = get("--agent");
  const model = get("--model");
  if (!pid) {
    process.stderr.write("launch.js requires --pid <projectId>\n");
    process.exit(1);
  }
  const { http: http2 } = await Promise.resolve().then(() => (init_http(), http_exports));
  await launchTui({ pid, agent, model, http: http2 });
  process.exit(0);
}
export {
  launchTui
};
