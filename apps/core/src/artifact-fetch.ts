// surfaces.fetch: an artifact's HTTP call through the core, so a credential is injected here and never lives in its
// HTML. Only origins the artifact declares (`connect`) are reached, redirects included.
import { badRequest, CallError, unavailable } from "./errors.ts";

export const FETCH_DEADLINE_MS = 30_000;
export const FETCH_BODY_MAX = 2_000_000;
const MAX_REDIRECTS = 3;
/** Request headers the page may not set: the core's own transport decides them. */
const BLOCKED_REQUEST = new Set(["host", "cookie", "content-length", "connection", "transfer-encoding", "keep-alive"]);
const BLOCKED_RESPONSE = new Set(["set-cookie", "set-cookie2"]);

export type ArtifactFetchRequest = {
  url: string;
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  secret?: { name: string; in: "bearer" | "header" | "query" | "form"; param?: string | undefined } | undefined;
};
export type ArtifactFetchTarget = { name: string; project_id?: string | undefined; connect?: string[] | undefined };

/** The full secret name for `name` (a key or `artifact.<artifact>.<key>`), refused when it is another's. */
export function artifactSecretName(artifact: string, name: string): string {
  const prefix = `artifact.${artifact}.`;
  const full = name.startsWith("artifact.") ? name : prefix + name;
  if (!full.startsWith(prefix) || !/^[a-z0-9][a-z0-9_-]*$/.test(full.slice(prefix.length)))
    throw badRequest(`"${name}" is not one of this artifact's secrets (they are named ${prefix}<key>)`);
  return full;
}

/** Every way an echoed value may come back, longest first, so none is left half replaced. */
function redactor(value: string | undefined): (s: string) => string {
  if (!value) return (s) => s;
  const forms = [...new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])].sort(
    (x, y) => y.length - x.length,
  );
  return (s) => forms.reduce((out, f) => out.split(f).join("[secret]"), s);
}

async function readCapped(res: Response, signal: AbortSignal): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    if (signal.aborted) throw signal.reason;
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > FETCH_BODY_MAX) {
      await reader.cancel();
      throw badRequest(`the response is over ${FETCH_BODY_MAX} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function artifactFetch(
  target: ArtifactFetchTarget,
  req: ArtifactFetchRequest,
  /** Resolves `secret://name`, a project's own value first (secrets.resolveIn). */
  resolveSecret: (ref: string, projectId: string | undefined) => string | undefined,
  /** Where each secret key was first sent; a secret goes nowhere else (trust on first use). */
  pins: { get(key: string): string | undefined; set(key: string, origin: string): void },
  fetcher: typeof fetch = fetch,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const allowed = new Set(target.connect ?? []);
  const inConnect = (u: URL) => allowed.has(u.origin);
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw badRequest(`not a URL: ${req.url}`);
  }
  if (!inConnect(url))
    throw badRequest(`${url.origin} is not among the origins this artifact connects to (its connect list)`);

  let value: string | undefined;
  let key: string | undefined;
  if (req.secret) {
    const full = artifactSecretName(target.name, req.secret.name);
    key = full.slice(`artifact.${target.name}.`.length);
    const pinned = pins.get(key);
    if (pinned && pinned !== url.origin)
      throw badRequest(`this secret is pinned to ${pinned}; the owner can reset it from the artifact's Memory dialog`);
    value = resolveSecret(`secret://${full}`, target.project_id);
    if (value === undefined) throw badRequest(`the secret ${full} is not set`);
    if (req.secret.in !== "bearer" && !req.secret.param) throw badRequest(`secret.param names the ${req.secret.in}`);
  }
  const redact = redactor(value);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) if (!BLOCKED_REQUEST.has(k.toLowerCase())) headers.set(k, v);
  let body = req.body;
  const method = (req.method ?? "GET").toUpperCase();
  if (value !== undefined && req.secret) {
    const param = req.secret.param as string;
    if (req.secret.in === "bearer") headers.set("authorization", `Bearer ${value}`);
    else if (req.secret.in === "header") headers.set(param, value);
    else if (req.secret.in === "form") {
      const form = new URLSearchParams(body ?? "");
      form.set(param, value);
      body = form.toString();
      if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded");
    }
  }
  const withQuery = (u: URL) => {
    if (value === undefined || req.secret?.in !== "query") return u;
    const q = new URL(u);
    q.searchParams.set(req.secret.param as string, value);
    return q;
  };

  const signal = AbortSignal.timeout(FETCH_DEADLINE_MS);
  try {
    let current = url;
    let currentMethod = method;
    for (let hop = 0; ; hop++) {
      const res = await fetcher(withQuery(current), {
        method: currentMethod,
        headers,
        ...(body !== undefined && currentMethod !== "GET" && currentMethod !== "HEAD" ? { body } : {}),
        redirect: "manual",
        signal,
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location && hop < MAX_REDIRECTS) {
        const next = new URL(location, current);
        if (!inConnect(next)) throw badRequest(`redirected to ${next.origin}, which this artifact does not connect to`);
        // A secret never follows a redirect to another origin: it stays where it is pinned.
        if (value !== undefined && next.origin !== url.origin)
          throw badRequest(`redirected to ${next.origin}; a secret is only sent to ${url.origin}`);
        await res.body?.cancel();
        if (res.status === 303) currentMethod = "GET";
        current = next;
        continue;
      }
      if (key !== undefined && res.status < 400) pins.set(key, url.origin);
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (!BLOCKED_RESPONSE.has(k)) out[k] = redact(v);
      });
      return { status: res.status, headers: out, body: redact(await readCapped(res, signal)) };
    }
  } catch (e) {
    if (e instanceof CallError) throw e;
    if (signal.aborted) throw unavailable(`no answer from ${url.origin} within ${FETCH_DEADLINE_MS / 1000} s`);
    throw unavailable(redact(`fetch to ${url.origin} failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}
