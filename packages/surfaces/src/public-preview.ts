const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const WRAPPER_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const scriptValue = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

// This function travels alone inside the frame: every value it uses must be local or a browser global.
function offlineState(initial: Record<string, unknown>) {
  const clone = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const data = Object.assign(Object.create(null) as Record<string, unknown>, initial);
  const listeners = new Set<(value: unknown, origin: string) => void>();
  const state = {
    persistent: false,
    all: () => clone(data),
    get: (key: string, fallback?: unknown) => (Object.hasOwn(data, key) ? clone(data[key]) : fallback),
    patch: (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) continue;
        if (value === null || value === undefined) delete data[key];
        else data[key] = clone(value);
      }
      for (const listener of listeners) listener(clone(data), "local");
    },
    set: (key: string, value: unknown) => state.patch({ [key]: value }),
    remove: (key: string) => state.patch({ [key]: null }),
    on: (listener: (value: unknown, origin: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  Object.assign(window, { apx: { host: "apx", state, sendPrompt: () => false } });
}

/** A nested, opaque preview: the wrapper also blocks the page navigating itself to a network URL. */
export function publicPreviewDocument(html: string, state: Record<string, unknown> = {}): string {
  const child = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><script>(${offlineState.toString()})(${scriptValue(state)});</script></head><body>${html}</body></html>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${WRAPPER_POLICY}"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style></head><body><iframe id="copy" title="Artifact page" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script>document.getElementById("copy").srcdoc=${scriptValue(child)};</script></body></html>`;
}
