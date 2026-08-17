// The single mount point for every daemon data route.
//
// Before this existed, routes lived at the root and three separate hand-written
// prefix lists had to agree on which of them were "API" (the SPA fallback in
// web.js, the auth allowlist in shared.js, and the vite dev proxy). They drifted.
// Now the answer is structural: a path is an API path iff it starts with /api.
//
// Kept in its own module so both the daemon and the route modules can import it
// without pulling in express or any route registration.
export const API_PREFIX = "/api";

/** True for /api and anything below it. */
export function isApiPath(p) {
  return p === API_PREFIX || p.startsWith(API_PREFIX + "/");
}

/** Prefix a root-relative route path with the API mount point. */
export function apiPath(p) {
  return `${API_PREFIX}${p.startsWith("/") ? p : `/${p}`}`;
}
