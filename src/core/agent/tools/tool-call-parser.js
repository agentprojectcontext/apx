// Pseudo-tool-call parser.
//
// Some models — qwen2.5:14b under Ollama is the canonical offender — emit
// "tool calls as text" instead of using the structured `tool_calls` field of
// the chat API. The output looks like:
//
//   <tool_call>
//   {"name": "list_agents", "arguments": {"project": "X"}}
//   </tool_call>
//   <tool_call>
//   {"name": "send_telegram", "arguments": {"text": "..."}}
//   </tool_call>
//
// or sometimes prefixed with `_icall()` or wrapped in fenced code blocks.
//
// `extractPseudoToolCalls(text)` finds those patterns and returns an array of
// `{ id, function: { name, arguments } }` objects shaped like real Ollama
// tool_calls — so the agent loop can treat them identically.
//
// `cleanTextOfPseudoToolCalls(text)` returns the input text minus the
// pseudo-tool-call blocks, so the loop never sends them as plain text to the
// user when the model fell back to this mode.

let counter = 0;
function nextId() {
  return `pseudo_${Date.now().toString(36)}_${counter++}`;
}

// Find a balanced JSON object starting at index `i` of `s`. Returns
// { ok: true, end: <index after closing brace> } or { ok: false }.
function readBalancedJson(s, i) {
  if (s[i] !== "{") return { ok: false };
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let p = i; p < s.length; p++) {
    const c = s[p];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (c === "\\") escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { ok: true, end: p + 1 };
    }
  }
  return { ok: false };
}

// Walk the text looking for `{` characters that start an object containing
// keys "name" and "arguments". Tolerant: accepts whatever wrapper text comes
// before/after.
export function extractPseudoToolCalls(text) {
  if (!text || typeof text !== "string") return [];

  // First pass: the Llama-3.3 (via Groq / OpenRouter) "dotted function"
  // format: <function.NAME({...JSON...})</function>. The model emits this
  // when it tries to do structured tool calling without proper SDK support.
  // We translate each match into a regular pseudo-tool-call entry; the
  // run-agent loop then treats them identically.
  const llamaCalls = extractLlamaDottedFunctionCalls(text);

  // DeepSeek (and some OpenAI-compatible gateways) dump native tool markup
  // as prose instead of filling `tool_calls`. The wire shape looks like:
  //
  //   <||DSML||tool_calls>
  //   <||DSML||invoke name="read_file">
  //   <||DSML||parameter name="path" string="true">notes.md</||DSML||parameter>
  //   </||DSML||invoke>
  //   </||DSML||tool_calls>
  //
  // Without this pass the loop treats the blob as the final answer, the
  // files never get read, and the operator sees XML in the routine preview.
  const dsmlCalls = extractDsmlToolCalls(text);

  // `[tool call: NAME] {…json…}` — APX's own internal transcription of a tool
  // call, which used to be written into Gemini history when a turn had no
  // thought signature to replay. Models copied the format out of their own
  // history and started writing calls instead of making them, and the line
  // was delivered to the user verbatim. The history no longer contains it,
  // but a model that already learned the shape (or any model that invents it)
  // must have the call EXECUTED rather than printed.
  const bracketCalls = extractBracketToolCalls(text);

  // Second pass: balanced `{name, arguments}` JSON anywhere in the text.
  const jsonCalls = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const balanced = readBalancedJson(text, i);
    if (!balanced.ok) continue;
    const candidate = text.slice(i, balanced.end);
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.name === "string" &&
      "arguments" in parsed &&
      typeof parsed.arguments === "object" &&
      parsed.arguments !== null &&
      !Array.isArray(parsed.arguments)
    ) {
      // Skip JSON that is actually the args object inside a wrapper we already
      // captured — otherwise we'd double-fire the tool.
      const insideLlamaWrap =
        llamaCalls.some((lc) => lc._rawStart <= i && balanced.end <= lc._rawEnd) ||
        dsmlCalls.some((dc) => dc._rawStart <= i && balanced.end <= dc._rawEnd) ||
        bracketCalls.some((bc) => bc._rawStart <= i && balanced.end <= bc._rawEnd);
      if (insideLlamaWrap) {
        i = balanced.end - 1;
        continue;
      }
      jsonCalls.push({
        id: nextId(),
        function: { name: parsed.name, arguments: parsed.arguments },
        _pseudo: true,
        _raw: candidate,
      });
      i = balanced.end - 1;
    }
  }

  // Strip internal markers used to dedupe against JSON pass.
  return [
    ...llamaCalls.map(({ _rawStart, _rawEnd, ...rest }) => rest),
    ...dsmlCalls.map(({ _rawStart, _rawEnd, ...rest }) => rest),
    ...bracketCalls.map(({ _rawStart, _rawEnd, ...rest }) => rest),
    ...jsonCalls,
  ];
}

// DeepSeek DSML markup. Tags use one or two pipes (`|DSML|` / `||DSML||`).
// Each invoke becomes one pseudo-tool-call; parameter bodies stay strings
// unless they parse as JSON (so `{"a":1}` still arrives as an object).
export function extractDsmlToolCalls(text) {
  if (!text || typeof text !== "string" || !/DSML/i.test(text)) return [];
  const out = [];
  const openRe = /<\|{1,2}DSML\|{1,2}invoke\s+name="([^"]+)"\s*>/gi;
  let m;
  while ((m = openRe.exec(text)) !== null) {
    const name = m[1];
    const start = m.index;
    const afterOpen = start + m[0].length;
    const closeRe = /<\/\|{1,2}DSML\|{1,2}invoke>/i;
    const closeMatch = closeRe.exec(text.slice(afterOpen));
    const innerEnd = closeMatch ? afterOpen + closeMatch.index : text.length;
    const end = closeMatch ? innerEnd + closeMatch[0].length : innerEnd;
    const inner = text.slice(afterOpen, innerEnd);
    const args = {};
    const paramRe =
      /<\|{1,2}DSML\|{1,2}parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|{1,2}DSML\|{1,2}parameter>/gi;
    let p;
    while ((p = paramRe.exec(inner)) !== null) {
      args[p[1]] = coerceDsmlValue(p[2].trim());
    }
    out.push({
      id: nextId(),
      type: "function",
      function: { name, arguments: args },
      _pseudo: true,
      _raw: text.slice(start, end),
      _rawStart: start,
      _rawEnd: end,
    });
    openRe.lastIndex = end;
  }
  return out;
}

function coerceDsmlValue(raw) {
  if (raw === "") return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try { return JSON.parse(raw); } catch { /* keep the string */ }
  }
  return raw;
}

// Parse `[tool call: NAME] {…}` — see the note in extractPseudoToolCalls.
// `_raw` spans the bracket AND its argument object so the whole line is
// removed from the visible text, not just the JSON half.
function extractBracketToolCalls(text) {
  const out = [];
  const re = /\[tool[ _]call:\s*([a-zA-Z_][a-zA-Z0-9_]*)\]\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const argsStart = m.index + m[0].length;
    let args = {};
    let end = argsStart;
    if (text[argsStart] === "{") {
      const balanced = readBalancedJson(text, argsStart);
      if (balanced.ok) {
        try {
          const parsed = JSON.parse(text.slice(argsStart, balanced.end));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
        } catch { /* keep {} — a malformed arg blob still beats printing it */ }
        end = balanced.end;
      }
    }
    out.push({
      id: nextId(),
      function: { name: m[1], arguments: args },
      _pseudo: true,
      _raw: text.slice(m.index, end),
      _rawStart: m.index,
      _rawEnd: end,
    });
    re.lastIndex = end;
  }
  return out;
}

// Parse the dotted-function format emitted by some Llama instructions:
//
//   <function.send_telegram({"text": "hi"})</function>
//   <function.list_projects({})</function>
//
// We accept missing closing tags (model sometimes truncates) and tolerate
// whitespace between the name, the parens, and the args object.
function extractLlamaDottedFunctionCalls(text) {
  const out = [];
  const re = /<function\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*(\{)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const argsStart = m.index + m[0].length - 1; // position of the `{`
    const balanced = readBalancedJson(text, argsStart);
    if (!balanced.ok) continue;
    const argsBlob = text.slice(argsStart, balanced.end);
    let args;
    try {
      args = JSON.parse(argsBlob);
    } catch {
      continue;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;

    // Find the end of the wrapper: optional ")", optional "</function>".
    let cursor = balanced.end;
    if (text[cursor] === ")") cursor++;
    const tail = text.slice(cursor, cursor + 16);
    const closeMatch = tail.match(/^\s*<\/function>/i);
    if (closeMatch) cursor += closeMatch[0].length;

    out.push({
      id: nextId(),
      function: { name, arguments: args },
      _pseudo: true,
      _raw: text.slice(m.index, cursor),
      _rawStart: m.index,
      _rawEnd: cursor,
    });
    // Advance regex past the closing brace so we don't double-match.
    re.lastIndex = cursor;
  }
  return out;
}

// Remove the parts of `text` that match pseudo-tool-call blocks plus any
// trivial wrappers (<tool_call>, ```tool_use, _icall(), etc.) that often sit
// around them. Used to clean up final answers that the model emitted with
// leftover textual tool-call gunk.
/**
 * The bare `tool_name({...json...})` form.
 *
 * WHERE THIS COMES FROM, and why it is not hypothetical: APX renders past tool
 * results into model context as `[tool result: <name>] <body>`
 * (stores/messages.js). A weaker model reads that pattern in its own history
 * and imitates it in PROSE — gemini-3.5-flash produced
 *
 *   [tool result: create_task] create_task({"project":"apx","title":"…"})
 *
 * and then told the user the task was filed. It was not. That is the worst
 * failure mode available: a confident false confirmation, with nothing on disk.
 *
 * GATED ON KNOWN TOOL NAMES, deliberately. The other two passes key off
 * unambiguous markers (`<function.` or a `{name, arguments}` pair); a bare
 * `foo({...})` is ordinary prose about code. Without the allow-list, a model
 * EXPLAINING `create_task({...})` in an answer would silently create a task.
 * So: no known names, no matches.
 *
 * @param {string} text
 * @param {Iterable<string>} knownNames  tool names callable on this turn
 */
export function extractBareFunctionCalls(text, knownNames) {
  const allowed = new Set(knownNames || []);
  if (!text || typeof text !== "string" || allowed.size === 0) return [];

  const out = [];
  // `name(` where name is a plausible identifier. The `[tool result: x] `
  // prefix the model copies is left for the cleaner to strip.
  const re = /(^|[^A-Za-z0-9_.])([a-z][a-z0-9_]{2,63})\s*\(\s*(?=\{)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[2];
    if (!allowed.has(name)) continue;
    // The '{' the regex already looked ahead to.
    const i = text.indexOf("{", m.index + m[0].length - 1);
    if (i < 0) continue;
    const balanced = readBalancedJson(text, i);
    if (!balanced.ok) continue;
    let args;
    try {
      args = JSON.parse(text.slice(i, balanced.end));
    } catch {
      continue;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;

    // Include the closing paren in the raw span when it is there, so the
    // cleaner removes the whole call rather than leaving a dangling `)`.
    let end = balanced.end;
    const after = text.slice(end).match(/^\s*\)/);
    if (after) end += after[0].length;

    const rawStart = m.index + (m[1] ? m[1].length : 0);
    out.push({
      id: nextId(),
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
      _raw: text.slice(rawStart, end),
    });
  }
  return out;
}
export function cleanTextOfPseudoToolCalls(text, knownNames) {
  if (!text || typeof text !== "string") return text;

  // Strip explicit XML-like fences first
  let out = text.replace(/<\/?tool_call>/gi, "");
  out = out.replace(/<\/?tool_use>/gi, "");
  out = out.replace(/_icall\(\s*\)/g, "");
  out = out.replace(/```tool_(?:call|use)\s*([\s\S]*?)```/gi, "");

  // The Llama "dotted-function" wrapper. Drop the whole block — both the
  // opening `<function.NAME(` and the trailing `)</function>` — so the user
  // never sees the wire format. Greedy on balanced braces would be wrong
  // (model might emit JSON later in the same message), so we use the same
  // extractor we built for the call-parsing pass and remove its raw spans.
  for (const call of extractPseudoToolCalls(out)) {
    if (call._raw) out = out.replace(call._raw, "");
  }
  // The bare `name({...})` form, and the `[tool result: name]` prefix the
  // model copies out of its own transcript.
  for (const call of extractBareFunctionCalls(out, knownNames)) {
    if (call._raw) out = out.replace(call._raw, "");
  }
  out = out.replace(/\[tool result:\s*[^\]]+\]\s*/gi, "");
  // …and the history annotation the message store substitutes for a stale
  // answer (`sanitizeAssistantForContext`). It describes a turn; it is never
  // something to say to the user.
  out = out.replace(/\[omitted:[^\]]*\]\s*/gi, "");
  // Some models emit a stray `</function>` after the args without the
  // opening tag — sweep those too.
  out = out.replace(/<\/?function(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?>/gi, "");
  // Leftover DSML wrappers after the invoke spans were removed.
  out = out.replace(/<\/?\|{1,2}DSML\|{1,2}[^>]*>/gi, "");

  // Tidy up whitespace & blank lines
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
