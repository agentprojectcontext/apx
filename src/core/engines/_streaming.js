// Shared streaming primitives for engine adapters.
//
// Every cloud chat API that supports streaming sends a sequence of newline
// terminated lines: SSE for OpenAI / Anthropic / Groq / OpenRouter, JSONL for
// Ollama / Gemini. Adapters used to inline the same TextDecoder loop —
// `streamLines` collapses that into one place; `streamSseDataEvents` walks
// the SSE-flavoured form on top of it (`data: <json>` lines).

/**
 * Yield complete newline-terminated lines from a streaming `fetch` Response.
 * Handles chunk boundaries falling mid-line and never yields empty trailing
 * tokens. The caller decides what each line means (raw JSON, SSE `data:` row,
 * etc.).
 */
export async function* streamLines(response) {
  if (!response || !response.body) return;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of response.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      // Yield even empty lines — SSE uses them as event boundaries.
      yield line;
    }
  }
  // Flush whatever the decoder left buffered + the trailing partial line, if any.
  buf += decoder.decode();
  if (buf.length > 0) yield buf;
}

/**
 * Walk an SSE stream and yield the parsed JSON body of each `data: <json>`
 * row. Skips `data: [DONE]` and rows whose body isn't valid JSON. Lines that
 * don't start with `data: ` (comments, event names, blank separators) are
 * ignored — adapters that need those should use streamLines directly.
 */
export async function* streamSseDataEvents(response) {
  for await (const line of streamLines(response)) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    let evt;
    try { evt = JSON.parse(raw); } catch { continue; }
    yield evt;
  }
}

/**
 * Walk a newline-delimited JSON stream (Ollama-style) and yield each parsed
 * object. Empty lines and invalid JSON are skipped.
 */
export async function* streamJsonLines(response) {
  for await (const line of streamLines(response)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    yield obj;
  }
}
