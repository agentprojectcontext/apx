import { test } from "node:test";
import assert from "node:assert/strict";
import { isApiPath, isKnownSpaRoute } from "#host/daemon/api/web.js";

// The SPA fallback serves index.html for every non-API, extension-less GET so
// React Router can resolve client-side paths. Two predicates drive it:
//   - isApiPath:      real API surfaces that must never be swallowed.
//   - isKnownSpaRoute: client routes the app can render → HTTP 200; everything
//                      else still gets the shell but with HTTP 404.
// These must stay in sync with API_PREFIXES (api.js) and the <Routes> registry
// in src/interfaces/web/src/App.tsx respectively.

test("isApiPath matches API prefixes and their subpaths", () => {
  for (const p of ["/health", "/projects", "/admin/web-token", "/sessions/1", "/mcp"]) {
    assert.equal(isApiPath(p), true, `${p} should be an API path`);
  }
});

test("isApiPath does not match SPA or unknown paths", () => {
  // /settings is a SPA route, not an API one — must NOT be treated as API even
  // though "/sessions" shares no prefix with it.
  for (const p of ["/", "/settings", "/settingsasdas", "/p/0/tasks", "/healthz"]) {
    assert.equal(isApiPath(p), false, `${p} should not be an API path`);
  }
});

test("isKnownSpaRoute matches every client route in App.tsx", () => {
  const known = [
    "/",
    "/settings",
    "/settings/engines",
    "/m/voice",
    "/m/desktop/x",
    "/m/deck",
    "/m/code/anything",
    "/p/0",
    "/p/12/tasks",
  ];
  for (const p of known) {
    assert.equal(isKnownSpaRoute(p), true, `${p} should be a known SPA route (200)`);
  }
});

test("isKnownSpaRoute rejects unknown routes so they 404", () => {
  // The reported regression: a typo'd path that visually 404s must also 404 at
  // the HTTP level.
  const unknown = ["/settingsasdas", "/m/nope", "/p", "/random", "/foo/bar"];
  for (const p of unknown) {
    assert.equal(isKnownSpaRoute(p), false, `${p} should be unknown (404)`);
  }
});
