// ESLint flat config.
//
// The repo shipped ~49k lines of untyped JS with no linter at all, so the
// architecture rules in AGENTS.md were prose that nothing enforced. The most
// valuable rule here is not style — it is the layer guard below, which turns
// "core -> adapter -> surface" into a build error. Before this, four live
// imports inverted the layering and nobody found out.
//
// Implementation note: the layer guard uses AST selectors, not
// `no-restricted-imports` globs. Those globs are matched with minimatch, which
// treats a leading `#` as a comment marker — so `#host/**` silently matches
// nothing and the rule looks like it passes. Selectors match the import source
// exactly and also cover `export … from` and dynamic `import()`.
import js from "@eslint/js";

/** Every syntax form that can pull a module in. */
const IMPORT_FORMS = [
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "ImportExpression",
];

function forbidImports(aliasRe, message) {
  return IMPORT_FORMS.map((form) => ({
    selector: `${form}[source.value=/^${aliasRe}\\u002f/]`,
    message,
  }));
}

// Targets the actual anti-pattern — rebuilding an APX-owned path — rather than
// os.homedir() in general. Reaching the user's home for a *foreign* tool's
// directory (~/.claude, ~/.cursor, ~/.cache/huggingface) or for tilde expansion
// is legitimate and stays allowed.
const NO_HOMEDIR = {
  selector:
    'CallExpression[callee.property.name=/^(join|resolve)$/] > ' +
    'CallExpression[callee.property.name="homedir"] + Literal[value=".apx"]',
  message:
    "Do not rebuild ~/.apx paths from os.homedir() — import the constant from " +
    "#core/config/paths.js (APX_HOME, CONFIG_PATH, TOKEN_PATH, LOG_DIR, TTS_TMP_DIR, …), " +
    "or call apxHome() when the value must follow a mid-run environment change. " +
    "AGENTS.md rule 13.",
};

const CORE_LAYER = forbidImports(
  "#(host|interfaces)",
  "core/ must not import from host/ or interfaces/ (AGENTS.md rule 8: core -> adapter -> surface). " +
    "If core needs it, the code is misfiled — move it into core/ rather than importing upward."
);

const HOST_LAYER = forbidImports(
  "#interfaces",
  "host/ must not import from interfaces/ (AGENTS.md rule 8). The daemon cannot depend on the CLI — " +
    "extract the shared logic into core/ and have both adapters call it."
);

// Express 4 does not await handlers: an async handler that rejects outside a
// try/catch becomes an unhandled rejection and takes the daemon down (AGENTS.md
// rule 15; see api/shared.js asyncRoute). Forbid passing a bare async function
// to a route/middleware registration — wrap it in asyncRoute() instead, which
// routes the rejection into errorMiddleware as a 500.
const ROUTE_METHODS = "/^(get|post|put|delete|patch|all|use)$/";
const ASYNC_ROUTE_MSG =
  "Async route handlers must be wrapped in asyncRoute() from api/shared.js — " +
  "a rejection in a bare async handler is an unhandled rejection that kills " +
  "the daemon. AGENTS.md rule 15.";
const ASYNC_ROUTE = [
  {
    selector:
      `CallExpression[callee.property.name=${ROUTE_METHODS}] > ` +
      "ArrowFunctionExpression[async=true]",
    message: ASYNC_ROUTE_MSG,
  },
  {
    selector:
      `CallExpression[callee.property.name=${ROUTE_METHODS}] > ` +
      "FunctionExpression[async=true]",
    message: ASYNC_ROUTE_MSG,
  },
];

// Node/web globals available in this runtime. Listed explicitly because the
// backend is plain ESM with no tsconfig lib to infer them from.
const RUNTIME_GLOBALS = Object.fromEntries(
  [
    "console", "process", "Buffer", "URL", "URLSearchParams",
    "TextEncoder", "TextDecoder", "AbortController", "AbortSignal",
    "fetch", "Headers", "Request", "Response", "FormData", "Blob", "File",
    "ReadableStream", "WritableStream", "TransformStream", "MessageChannel",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "setImmediate", "clearImmediate", "queueMicrotask",
    "structuredClone", "performance", "crypto", "Event", "EventTarget",
    "__dirname", "__filename", "module", "require", "exports", "global",
    "WebSocket", "navigator", "Intl",
  ].map((g) => [g, "readonly"])
);

// DOM globals for browser execution contexts (the Electron renderers, the
// mascot window, and Puppeteer page.evaluate() callbacks). Kept as one list so
// every browser-context block below shares the same surface.
const BROWSER_GLOBALS = Object.fromEntries(
  [
    "window", "document", "location", "history", "localStorage",
    "sessionStorage", "requestAnimationFrame", "cancelAnimationFrame",
    "MediaRecorder", "MediaStream", "Audio", "AudioContext",
    "ResizeObserver", "MutationObserver", "IntersectionObserver",
    "getComputedStyle", "HTMLElement", "Element", "Node", "DOMParser",
    "alert", "confirm", "prompt", "CustomEvent", "KeyboardEvent",
  ].map((g) => [g, "readonly"])
);

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "tmp/**",
      "qa/**",
      "spec/**",
      ".claude/**",
      "docs/**",
      // Own pnpm workspace with its own strict tsc gate.
      "src/interfaces/web/**",
      // Vendored OpenCode fork (TypeScript), gated by scripts/typecheck-tui.js.
      "src/interfaces/tui/**",
      "*.html",
    ],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: RUNTIME_GLOBALS,
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      // An unused import is usually a leftover from a half-finished refactor.
      // `_`-prefixed names are the documented "intentionally ignored" escape.
      "no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      // Empty non-catch blocks are always a mistake. Empty *catch* blocks are
      // often legitimate best-effort cleanup here, so they are allowed rather
      // than banned wholesale — see docs-internal/repair-and-refactoring-code.
      // (A planned ratchet script for them was never built; if one lands,
      // reference it here.)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // ANSI escapes in regexes are intentional: the CLI strips terminal
      // colour codes out of captured output.
      "no-control-regex": "off",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-console": "off",
    },
  },

  // ---- Layer guard: core knows nothing about how it is served ----
  {
    files: ["src/core/**/*.js"],
    ignores: ["src/core/config/paths.js", "src/core/logging.js"],
    rules: { "no-restricted-syntax": ["error", ...CORE_LAYER, NO_HOMEDIR] },
  },
  {
    files: ["src/core/config/paths.js", "src/core/logging.js"],
    rules: { "no-restricted-syntax": ["error", ...CORE_LAYER] },
  },

  // ---- Layer guard: the daemon is an adapter, never a surface consumer ----
  {
    files: ["src/host/**/*.js"],
    rules: {
      "no-restricted-syntax": ["error", ...HOST_LAYER, NO_HOMEDIR, ...ASYNC_ROUTE],
    },
  },

  // Surfaces may import anything below them, but still must not re-derive paths.
  {
    files: ["src/interfaces/**/*.js"],
    rules: { "no-restricted-syntax": ["error", NO_HOMEDIR] },
  },

  // The Electron main process is deliberately standalone: it is CommonJS
  // (`require`) inside an ESM package, and it has to boot under launchd with a
  // minimal PATH. Pulling it onto the ESM core graph for three path constants
  // would risk a boot-critical path to remove three duplicated strings. If it
  // ever becomes ESM, drop this exemption and import from #core/config/paths.js.
  {
    files: ["src/interfaces/desktop/main.js"],
    rules: { "no-restricted-syntax": "off" },
  },

  // Browser execution contexts: the Electron renderer runs in a page, and the
  // callbacks handed to Puppeteer's page.evaluate() are serialized and run in
  // the remote page — both legitimately see DOM globals.
  {
    files: [
      "src/interfaces/desktop/renderer.js",
      "src/interfaces/desktop/preload.js",
      "src/interfaces/desktop/mascot.js",
      "src/core/http-tools/browser.js",
    ],
    languageOptions: {
      globals: { ...RUNTIME_GLOBALS, ...BROWSER_GLOBALS },
    },
  },

  // Auto-generated vanilla mirror of the web blob presets, loaded as a plain
  // <script> in the mascot window: its top-level consts ARE the page's globals,
  // consumed by the sibling mascot.js (see its `/* global BLOB_PRESETS … */`).
  // It is a classic script, not a module — parsed as such. no-unused-vars still
  // flags top-level lexical consts even in scripts, and this file can't carry a
  // hand-written annotation (the generator would overwrite it), so the rule is
  // turned off here; the file only ever holds those two exported globals.
  {
    files: ["src/interfaces/desktop/mascot-blobs.js"],
    languageOptions: { sourceType: "script" },
    rules: { "no-unused-vars": "off" },
  },

  // Tests and scripts verify the seams, so they may reach anywhere.
  {
    files: ["tests/**/*.js", "scripts/**/*.js"],
    rules: {
      "no-restricted-syntax": "off",
      "no-unused-vars": [
        "error",
        { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-regex-spaces": "off",
    },
  },
];
