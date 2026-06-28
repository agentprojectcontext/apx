// Typed HTTP client against the APX daemon. All requests carry the bearer
// token loaded once on first paint (see useTokenBootstrap). Same-origin:
// when the daemon serves the SPA, requests land on the same port; in
// `vite dev` the proxy redirects to 7430.

let token: string | null = null;

export function setToken(t: string | null) { token = t; }
export function getToken(): string | null  { return token; }

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(path, {
    ...init,
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    let parsed: unknown = null;
    try {
      parsed = await res.json();
      detail = (parsed as { error?: string })?.error || JSON.stringify(parsed);
    } catch {
      detail = await res.text();
    }
    throw new HttpError(res.status, `${method} ${path} → ${res.status}: ${detail}`, parsed);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// GET that also surfaces the total-row count for server-side pagination. The
// daemon returns the full count in the X-Total-Count header (the body keeps its
// normal shape); we fall back to the payload length when the header is absent
// (e.g. an older daemon) so pagination degrades gracefully instead of breaking.
async function getWithTotal<T>(path: string): Promise<{ data: T; total: number }> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(path, { method: "GET", headers });
  if (!res.ok) {
    let detail = "";
    let parsed: unknown = null;
    try {
      parsed = await res.json();
      detail = (parsed as { error?: string })?.error || JSON.stringify(parsed);
    } catch {
      detail = await res.text();
    }
    throw new HttpError(res.status, `GET ${path} → ${res.status}: ${detail}`, parsed);
  }
  const data = (await res.json()) as T;
  const header = res.headers.get("X-Total-Count");
  const total =
    header != null && header !== ""
      ? parseInt(header, 10)
      : Array.isArray(data)
        ? data.length
        : 0;
  return { data, total };
}

export const http = {
  get:   <T>(p: string)              => request<T>("GET", p),
  getWithTotal,
  post:  <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  put:   <T>(p: string, b?: unknown) => request<T>("PUT", p, b),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b),
  del:   <T>(p: string)              => request<T>("DELETE", p),
};

/** NDJSON streaming helper — one line per event. */
export async function streamNdjson<E = unknown>(
  path: string,
  body: unknown,
  onEvent: (ev: E) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new HttpError(res.status, `POST ${path} → ${res.status}: ${text || "stream failed"}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i = buf.indexOf("\n");
    while (i >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try { onEvent(JSON.parse(line) as E); }
        catch { /* ignore malformed line */ }
      }
      i = buf.indexOf("\n");
    }
  }
  if (buf.trim()) {
    try { onEvent(JSON.parse(buf.trim()) as E); } catch { /* ignore */ }
  }
}
