// Typed wrapper around the APX HTTP client (src/cli/http.js).
// We use dynamic import since the base client is plain JS ESM.

export interface StreamEvent {
  type: "event" | "chunk" | "final" | "error";
  [key: string]: unknown;
}

type HttpModule = {
  get(path: string, opts?: RequestInit): Promise<unknown>;
  post(path: string, body: unknown, opts?: RequestInit): Promise<unknown>;
  put(path: string, body: unknown, opts?: RequestInit): Promise<unknown>;
  patch(path: string, body: unknown, opts?: RequestInit): Promise<unknown>;
  delete(path: string, opts?: RequestInit): Promise<unknown>;
  streamPost(
    path: string,
    body: unknown,
    onEvent: (ev: StreamEvent) => void,
    opts?: RequestInit,
  ): Promise<unknown>;
  baseUrl(): string;
  ping(timeoutMs?: number): Promise<boolean>;
  createAbortController(): AbortController;
};

let _http: HttpModule | null = null;

export async function getHttp(): Promise<HttpModule> {
  if (!_http) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – plain JS outside rootDir; HttpModule above provides typing
    const m = (await import("../cli/http.js")) as { http: HttpModule };
    _http = m.http;
  }
  return _http;
}
