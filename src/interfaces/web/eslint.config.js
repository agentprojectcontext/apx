// ESLint flat config for the web panel.
//
// The panel is its own pnpm workspace, and the root eslint.config.js ignores it
// with the note "own pnpm workspace with its own strict tsc gate". That gate is
// real but it is a TYPE checker: it proved the 47k lines of TS/TSX were typed
// and nothing more. tsconfig.json even sets `noUnusedLocals: false` and
// `noUnusedParameters: false`, so a dead import survived every gate the repo
// had. Meanwhile the class of bug this app actually hits — a stale closure in
// a streaming chat reducer, a hook called after an early return — is invisible
// to tsc by construction.
//
// So: the backend's rules are build errors (see the root config's layer guard);
// these are the panel's equivalent.
//
// SEVERITY POLICY — the same split the root config uses, and the same one the
// TUI ratchet uses for vendored code:
//
//   error  → catches a BUG. rules-of-hooks is a crash ("rendered more hooks
//            than during the previous render"); an unused variable is a
//            half-finished refactor. These must be zero, always.
//   warn   → a real smell that needs per-site judgment to resolve, where a
//            blanket fix would be a refactor rather than a repair.
//            exhaustive-deps is upstream's own default severity. no-explicit-any
//            is deliberately LOWERED from typescript-eslint's recommended, and
//            this is the reason: 24 of them existed the day linting was turned
//            on, and clearing them is typing work, not guardrail work.
//
// A warning is not a free pass — scripts/lint-web.js caps the count and the
// cap may only fall. That is the same deal tsconfig.cli.json struck with the
// TUI: get the check running first, then ratchet strictness up.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "public/**",
      // Playwright specs run against a live daemon and have their own tsconfig
      // and globals; they are gated by `pnpm e2e`, not by this config.
      "e2e/**",
      "scripts/**",
      "test-results/**",
      "*.config.js",
      "*.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    // An eslint-disable that no longer suppresses anything is a comment
    // claiming a problem exists where none does — usually left behind when the
    // code it guarded was rewritten. Report them.
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // `_`-prefixed is the documented "intentionally ignored" escape, matching
      // the root config so the two halves of the repo read the same way.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],

      // Lowered to warn on purpose — see the severity policy above. Capped by
      // scripts/lint-web.js.
      "@typescript-eslint/no-explicit-any": "warn",

    },
  },
);
