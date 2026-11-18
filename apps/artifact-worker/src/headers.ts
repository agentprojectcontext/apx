const viewerPolicy =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const runnerPolicy =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";

export function secureResponse(response: Response, path: string, origin?: string) {
  const result = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    ...(response.webSocket ? { webSocket: response.webSocket } : {}),
  });
  result.headers.delete("set-cookie");
  result.headers.delete("access-control-allow-origin");
  result.headers.set("referrer-policy", "no-referrer");
  result.headers.set("x-content-type-options", "nosniff");
  result.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  const policy = origin
    ? viewerPolicy.replace("connect-src 'self'", `connect-src 'self' ${origin.replace(/^http/, "ws")}`)
    : viewerPolicy;
  result.headers.set("content-security-policy", path === "/runner.html" ? runnerPolicy : policy);
  if (path.startsWith("/assets/") && response.ok)
    result.headers.set("cache-control", "public, max-age=31536000, immutable");
  else result.headers.set("cache-control", "no-store");
  return result;
}

export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "public_artifact_unavailable";
  const status =
    message === "sign_in_required"
      ? 401
      : message === "public_artifact_access_denied"
        ? 403
        : message === "public_artifact_missing"
          ? 404
          : message === "public_artifact_changed"
            ? 409
            : message === "public_artifact_limit" || message === "public_artifact_rate_limited"
              ? 429
              : message === "public_artifact_too_large"
                ? 413
                : message === "invalid_public_copy"
                  ? 400
                  : 503;
  const safe = status === 503 ? "public_artifact_unavailable" : message;
  return Response.json({ error: safe }, { status, headers: status === 429 ? { "retry-after": "60" } : {} });
}
